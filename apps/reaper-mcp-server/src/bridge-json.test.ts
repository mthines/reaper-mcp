import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LuaFactory } from 'wasmoon';

// Runs the bridge's real json_encode (sliced out of mcp_bridge.lua) under
// wasmoon and parses its output the way bridge.ts does.

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');
const SNAPSHOT_LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_snapshot_lib.lua'), 'utf8');

// The fallback string decoder (extract_json_string), sliced out of a Lua file.
function decoderSource(src: string): string {
  const start = src.indexOf('local function extract_json_string');
  const endMarker = '  return nil, i';
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('extract_json_string not found');
  return src.slice(start, src.indexOf('end', end + endMarker.length) + 3);
}

function encoderSource(): string {
  const start = BRIDGE_SRC.indexOf('local JSON_ESCAPES');
  const endMarker = '  return encode_value(obj)\nend';
  const end = BRIDGE_SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('json_encode not found in mcp_bridge.lua');
  return BRIDGE_SRC.slice(start, end + endMarker.length);
}

async function encode(build: string): Promise<string> {
  const lua = await new LuaFactory().createEngine();
  try {
    return await lua.doString(`${encoderSource()}\nreturn json_encode(${build})`);
  } finally {
    lua.global.close();
  }
}

describe('mcp_bridge.lua json_encode', () => {
  it('emits valid JSON for names with control characters', async () => {
    const out = await encode(
      `{ name = "Tab\\tName", cr = "a\\rb", nl = "x\\ny", bell = "\\7ding", del = "z\\127", nul = "a\\0b" }`,
    );
    expect(JSON.parse(out)).toEqual({
      name: 'Tab\tName', cr: 'a\rb', nl: 'x\ny', bell: '\x07ding', del: 'z\x7f', nul: 'a\0b',
    });
  });

  it('keeps quotes, backslashes and UTF-8 intact', async () => {
    const out = await encode(`{ "Quote \\"Lead\\" Vox", "Back\\\\slash", "Ærø 🥁" }`);
    expect(JSON.parse(out)).toEqual(['Quote "Lead" Vox', 'Back\\slash', 'Ærø 🥁']);
  });

  it('escapes object keys too', async () => {
    const out = await encode(`{ ["we\\"ird\\tkey"] = 1 }`);
    expect(JSON.parse(out)).toEqual({ 'we"ird\tkey': 1 });
  });

  it.each([
    ['mcp_bridge.lua', () => BRIDGE_SRC],
    ['mcp_snapshot_lib.lua', () => SNAPSHOT_LIB_SRC],
  ])('round-trips control characters through the %s decoder (snapshot restore)', async (_name, src) => {
    const lua = await new LuaFactory().createEngine();
    try {
      const ok = await lua.doString(`${encoderSource()}\n${decoderSource(src())}
        local names = { "Tab\\tName", "a\\rb", "x\\ny", "\\7bell", "z\\127", "a\\0b", "f\\fb\\b", 'Q \\"x\\" \\\\ /', "Ærø 🥁" }
        for _, n in ipairs(names) do
          local json = json_encode({ n })
          local back = extract_json_string(json, 3)
          if back ~= n then return "mismatch: " .. json end
        end
        return "ok"`);
      expect(ok).toBe('ok');
    } finally {
      lua.global.close();
    }
  });
});

// The fallback command decoder (no CF_Json_Parse — SWS doesn't ship one).
function commandDecoderSource(): string {
  const start = BRIDGE_SRC.indexOf('local function extract_json_string');
  const end = BRIDGE_SRC.indexOf('-- JSON forbids raw control characters');
  if (start < 0 || end < 0) throw new Error('command decoder not found in mcp_bridge.lua');
  return BRIDGE_SRC.slice(start, end);
}

async function decode(snippet: string): Promise<unknown> {
  const lua = await new LuaFactory().createEngine();
  try {
    return JSON.parse(await lua.doString(`reaper = {}\n${commandDecoderSource()}\n${encoderSource()}\n${snippet}`));
  } finally {
    lua.global.close();
  }
}

describe('mcp_bridge.lua fallback command decoder', () => {
  it('keeps every param when a string holds braces or brackets', async () => {
    const cmd = JSON.stringify({
      id: '1', type: 'set_project_settings',
      params: { notes: 'Bridge } then { and ] [', title: 'Song', bpm: 120 },
    });
    expect(await decode(`return json_encode(json_decode(${JSON.stringify(cmd)}))`)).toEqual(JSON.parse(cmd));
  });

  it('reads array params whose strings hold brackets', async () => {
    const cmd = JSON.stringify({ params: { items: [{ n: 'x]' }, { n: '{y' }], after: 5 } });
    const out = await decode(`local o = json_decode(${JSON.stringify(cmd)})
      return json_encode({ items = json_decode_array(o.params.items), after = o.params.after })`);
    expect(out).toEqual({ items: [{ n: 'x]' }, { n: '{y' }], after: 5 });
  });

  it('parses numbers with exponents', async () => {
    const cmd = '{"params":{"a":1e-7,"b":-2.5E+3,"c":42}}';
    const out = (await decode(`return json_encode(json_decode(${JSON.stringify(cmd)}))`)) as { params: Record<string, number> };
    expect(out.params.a).toBeCloseTo(1e-7, 12);
    expect(out.params.b).toBe(-2500);
    expect(out.params.c).toBe(42);
  });
});
