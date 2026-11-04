/**
 * Unit tests for reaper/mcp_fxstate_lib.lua, run in real Lua 5.4 (wasmoon) against the fake ReaScript API
 * (__fixtures__/fake_reaper.lua), whose tracks keep the chunk text they are given. Assertions live in the Lua
 * snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_fxstate_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');

const factory = new LuaFactory();

// A track the way REAPER writes it: Vital (VST3, 3 data lines), ReaEQ (VST2), then an item.
const PRELUDE = `
local state_long = string.rep("QUJD", 200) -- 800 chars: wraps into 3 lines of at most 280
CHUNK = table.concat({
  "<TRACK", 'NAME "Synth"', "TRACKID {11111111-1111-1111-1111-111111111111}",
  "<FXCHAIN", "WNDRECT 0 0 0 0", "SHOW 0", "LASTSEL 0", "DOCKED 0",
  "BYPASS 0 0 0",
  '<VST "VST3i: Vital (Vital Audio)" Vital.vst3 0 "" 1854596000{56535456697461766974616C00000000} ""',
  "HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB=",
  string.sub(state_long, 1, 280), string.sub(state_long, 281, 560), string.sub(state_long, 561),
  ">",
  "FLOATPOS 0 0 0 0",
  "FXID {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}",
  "WAK 0 0",
  "BYPASS 0 0 0",
  '<VST "VST: ReaEQ (Cockos)" reaeq.dll 0 "" 1919247729',
  "ZmFrZQ==",
  ">",
  "FXID {BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}",
  "WAK 0 0",
  ">",
  "<ITEM", "POSITION 0", ">",
  ">",
}, "\\n") .. "\\n"

function new_ctx(files)
  return {
    plan = plan, dir = "/bridge/",
    read = function(p) return files[p] end,
    write = function(p, t) files[p] = t; return true end,
  }
end
function fresh(chunk) return new_fake{ tracks = { { name = "Synth", chunk = chunk or CHUNK } } } end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(
      `fx = load(LIB_SRC, "mcp_fxstate_lib.lua")()\nplan = load(PLAN_SRC, "mcp_plan_lib.lua")()\n${PRELUDE}\n${snippet}`,
    );
  } finally {
    lua.global.close();
  }
}

describe('mcp_fxstate_lib.lua (wasmoon)', () => {
  it('get: writes the header line and the joined state to the named file and names the FX', async () => {
    await runLua(`
      local api, files = fresh(), {}
      local r, err = fx.get_fx_state(api, { trackIndex = 0, fxIndex = 0, outFile = "/bridge/fxstate_abc.out" }, new_ctx(files))
      assert(r, tostring(err))
      assert(r.name == "VST3i: Vital (Vital Audio)" and r.format == "vst3")
      local header, state = files["/bridge/fxstate_abc.out"]:match("^([^\\n]+)\\n([^\\n]+)\\n$")
      assert(header == "HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB64HDRB=", "header line")
      assert(state == string.rep("QUJD", 200), "state lines joined: " .. #state)
      assert(api.writes == 0, "reading changes nothing")
    `);
  });

  it('get: refuses a plugin that is not a VST3, naming it, and an index past the chain, counting the FX', async () => {
    await runLua(`
      local api, files = fresh(), {}
      local r, err = fx.get_fx_state(api, { trackIndex = 0, fxIndex = 1, outFile = "/bridge/fxstate_abc.out" }, new_ctx(files))
      assert(r == nil and err:find("ReaEQ", 1, true) and err:find("not a VST3", 1, true), tostring(err))
      r, err = fx.get_fx_state(api, { trackIndex = 0, fxIndex = 5, outFile = "/bridge/fxstate_abc.out" }, new_ctx(files))
      assert(r == nil and err:find("FX 5 not found", 1, true) and err:find("has 2 FX", 1, true), tostring(err))
      assert(next(files) == nil, "nothing written")
    `);
  });

  it('refuses any file outside the bridge folder or not named fxstate_*, for both directions', async () => {
    await runLua(`
      local api, files = fresh(), { ["/etc/secret"] = "AAAA\\nBBBB\\n" }
      for _, bad in ipairs({ "/etc/passwd", "/bridge/../etc/x.out", "/bridge/other.out", "/bridge/fxstate_a/b.out", "fxstate_abc.out", 7 }) do
        local r, err = fx.get_fx_state(api, { trackIndex = 0, fxIndex = 0, outFile = bad }, new_ctx(files))
        assert(r == nil and err:find("fxstate_", 1, true), tostring(bad) .. ": " .. tostring(err))
        r, err = fx.set_fx_state(api, { trackIndex = 0, fxIndex = 0, inFile = bad }, new_ctx(files))
        assert(r == nil and err:find("fxstate_", 1, true), tostring(bad) .. ": " .. tostring(err))
      end
      assert(api.writes == 0)
    `);
  });

  it('set: swaps only that FX\'s data, wraps the state, renews only its FXID, keeps items and the other FX, one undo point', async () => {
    await runLua(`
      local api = fresh()
      local files = { ["/bridge/fxstate_in1.in"] = "NEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDR==\\n" .. string.rep("WFla", 300) .. "\\n" }
      local r, err = fx.set_fx_state(api, { trackIndex = 0, fxIndex = 0, inFile = "/bridge/fxstate_in1.in" }, new_ctx(files))
      assert(r, tostring(err))
      assert(r.name == "VST3i: Vital (Vital Audio)")
      local c = api.tracks[1].chunk
      assert(c:find("NEWHDRNEWHDR", 1, true) and not c:find("HDRB64HDRB64", 1, true), "header replaced")
      assert(not c:find("QUJDQUJD", 1, true), "old state gone")
      for line in c:gmatch("[^\\n]+") do assert(#line <= 280 or line:find("^<VST"), "line too long: " .. #line) end
      local joined = {}
      for line in c:gmatch("WFla[%w+/=]*") do joined[#joined + 1] = line end
      assert(table.concat(joined) == string.rep("WFla", 300), "new state, in order")
      assert(not c:find("AAAAAAAA-AAAA", 1, true), "Vital got a new FXID")
      assert(c:find("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB", 1, true), "the other FX keeps its FXID")
      assert(c:find("ZmFrZQ==", 1, true), "the other FX keeps its data")
      assert(c:find("<ITEM\\nPOSITION 0\\n>", 1, true), "items untouched")
      assert(c:find("FLOATPOS 0 0 0 0\\nFXID {", 1, true) and c:find("WAK 0 0", 1, true), "FX lines around the new FXID kept")
      assert(#api.undo == 1 and api.undo[1] == "MCP: Set FX state (VST3i: Vital (Vital Audio))", tostring(api.undo[1]))
    `);
  });

  it('set then get returns exactly what was set', async () => {
    await runLua(`
      local api = fresh()
      local files = { ["/bridge/fxstate_in2.in"] = "NEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDR==\\n" .. string.rep("WFla", 300) .. "\\n" }
      assert(fx.set_fx_state(api, { trackIndex = 0, fxIndex = 0, inFile = "/bridge/fxstate_in2.in" }, new_ctx(files)))
      assert(fx.get_fx_state(api, { trackIndex = 0, fxIndex = 0, outFile = "/bridge/fxstate_o2.out" }, new_ctx(files)))
      assert(files["/bridge/fxstate_o2.out"] == files["/bridge/fxstate_in2.in"])
    `);
  });

  it('set: refuses, changing nothing, for a wrong expected name, a missing or malformed file, and a non-VST3 target', async () => {
    await runLua(`
      local api = fresh()
      local good = "NEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDRNEWHDR==\\n" .. string.rep("WFla", 30) .. "\\n"
      local files = { ["/bridge/fxstate_ok.in"] = good, ["/bridge/fxstate_bad.in"] = "not base64!\\nAAAA\\n", ["/bridge/fxstate_one.in"] = "AAAA\\n" }
      local before = api.tracks[1].chunk
      local function refused(params, needle)
        local r, err = fx.set_fx_state(api, params, new_ctx(files))
        assert(r == nil and err:find(needle, 1, true), needle .. " <- " .. tostring(err))
      end
      refused({ trackIndex = 0, fxIndex = 0, inFile = "/bridge/fxstate_ok.in", expectName = "Pro-Q" }, "not 'Pro-Q'")
      refused({ trackIndex = 0, fxIndex = 0, inFile = "/bridge/fxstate_none.in" }, "could not read")
      refused({ trackIndex = 0, fxIndex = 0, inFile = "/bridge/fxstate_bad.in" }, "two base64 lines")
      refused({ trackIndex = 0, fxIndex = 0, inFile = "/bridge/fxstate_one.in" }, "two base64 lines")
      refused({ trackIndex = 0, fxIndex = 1, inFile = "/bridge/fxstate_ok.in" }, "not a VST3")
      refused({ trackIndex = 9, fxIndex = 0, inFile = "/bridge/fxstate_ok.in" }, "not found")
      assert(api.tracks[1].chunk == before and api.writes == 0 and #api.undo == 0, "nothing changed")
    `);
  });

  it('refuses a track whose chain holds an FX container (indexes would not match), and a track with no FX', async () => {
    await runLua(`
      local with_container = CHUNK:gsub('<VST "VST: ReaEQ', '<CONTAINER Container 0 0\\n>\\n<VST "VST: ReaEQ', 1)
      local api = fresh(with_container)
      local r, err = fx.get_fx_state(api, { trackIndex = 0, fxIndex = 0, outFile = "/bridge/fxstate_c.out" }, new_ctx({}))
      assert(r == nil and err:find("containers", 1, true), tostring(err))
      api = fresh('<TRACK\\nNAME "Empty"\\n>\\n')
      r, err = fx.get_fx_state(api, { trackIndex = 0, fxIndex = 0, outFile = "/bridge/fxstate_c.out" }, new_ctx({}))
      assert(r == nil and err:find("no FX chain", 1, true), tostring(err))
    `);
  });
});
