import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LuaFactory } from 'wasmoon';

// Runs the bridge's real json_encode (sliced out of mcp_bridge.lua) under
// wasmoon and parses its output the way bridge.ts does.

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');

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
});
