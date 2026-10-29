/**
 * handlers.add_fx (position → TrackFX_AddByName's `instantiate`) and
 * handlers.set_envelope_properties (BR_EnvSetProperties' full argument list), run in
 * real Lua 5.4 via wasmoon against a fake `reaper` table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const BRIDGE_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');

function handler(name: string): string {
  const start = BRIDGE_SRC.indexOf(`function handlers.${name}(`);
  const end = BRIDGE_SRC.indexOf('\nend\n', start);
  expect(start).toBeGreaterThan(-1);
  return BRIDGE_SRC.slice(start, end + 5);
}

async function run(setup: string, name: string, check: string): Promise<void> {
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`handlers = {}\n${setup}`);
    await lua.doString(handler(name));
    await lua.doString(check);
  } finally {
    lua.global.close();
  }
}

const FAKE_FX = `
  calls = {}
  reaper = {
    GetTrack = function(_, i) if i == 0 then return "TR" end end,
    Undo_BeginBlock = function() end,
    Undo_EndBlock = function() end,
    -- Like REAPER: 0 only looks up an existing instance, so a new FX is "not found".
    TrackFX_AddByName = function(_, name, _, inst)
      calls[#calls + 1] = inst
      if inst == 0 then return -1 end
      if inst <= -1000 then return -1000 - inst end
      return 3
    end,
    TrackFX_GetFXName = function() return true, "JS: Tone Generator" end,
  }
`;

describe('add_fx position', () => {
  it('inserts at slot n via -1000 - n, and appends without a position', async () => {
    await run(FAKE_FX, 'add_fx', `
      local r, err = handlers.add_fx({ trackIndex = 0, fxName = "JS: Tone Generator", position = 0 })
      assert(r, err)
      assert(calls[1] == -1000, "position 0 -> -1000, got " .. tostring(calls[1]))
      assert(r.fxIndex == 0, "inserted at slot 0")
      r = handlers.add_fx({ trackIndex = 0, fxName = "ReaEQ", position = 2 })
      assert(calls[2] == -1002 and r.fxIndex == 2, "position 2 -> -1002")
      r = handlers.add_fx({ trackIndex = 0, fxName = "ReaEQ" })
      assert(calls[3] == -1 and r.fxIndex == 3, "no position appends")
      r = handlers.add_fx({ trackIndex = 0, fxName = "ReaEQ", position = -1 })
      assert(calls[4] == -1, "-1 appends")
    `);
  });
});

const FAKE_ENV = (props: string) => `
  set_args = nil
  reaper = {
    GetTrack = function(_, i) if i == 0 then return "TR" end end,
    CountTrackEnvelopes = function() return 1 end,
    GetTrackEnvelope = function() return "ENV" end,
    GetEnvelopeName = function() return true, "Volume" end,
    Undo_BeginBlock = function() end,
    Undo_EndBlock = function() end,
    TrackList_AdjustWindows = function() end,
    UpdateArrange = function() end,
    BR_EnvAlloc = function() return "BR" end,
    BR_EnvFree = function() end,
    -- active, visible, armed, inLane, laneHeight, defaultShape, min, max, center, type,
    -- faderScaling[, automationItemsOptions]
    BR_EnvGetProperties = function()
      if set_args then return set_args[2], set_args[3], set_args[4] end
      return ${props}
    end,
    -- SWS checks the count like this: fewer than 8 arguments raises.
    BR_EnvSetProperties = function(...)
      local n = select("#", ...)
      if n < 8 then error("'reaper.BR_EnvSetProperties': expected 8 arguments minimum") end
      set_args = { ... }
      set_args.n = n
    end,
  }
`;

describe('set_envelope_properties via SWS', () => {
  it('passes every property back and lets false switch a property off', async () => {
    await run(FAKE_ENV('true, true, false, true, 80, 2, 0, 2, 1, 0, true, -1'), 'set_envelope_properties', `
      local r, err = handlers.set_envelope_properties({ trackIndex = 0, envelopeIndex = 0, active = false, armed = true })
      assert(r, err)
      assert(set_args.n == 9, "envelope + 8 args, got " .. set_args.n)
      assert(set_args[2] == false, "active=false is applied")
      assert(set_args[3] == true, "visible kept")
      assert(set_args[4] == true, "armed=true applied")
      assert(set_args[5] == true and set_args[6] == 80 and set_args[7] == 2, "lane, height, shape kept")
      assert(set_args[8] == true and set_args[9] == -1, "faderScaling and automationItemsOptions kept")
      assert(r.active == false and r.visible == true and r.armed == true, "re-read result")
    `);
  });

  it('omits automationItemsOptions when an older SWS does not return it', async () => {
    await run(FAKE_ENV('true, false, false, false, 0, 0, 0, 1, 0.5, 1, false'), 'set_envelope_properties', `
      local r, err = handlers.set_envelope_properties({ trackIndex = 0, envelopeIndex = 0, visible = true })
      assert(r, err)
      assert(set_args.n == 8, "envelope + 7 args, got " .. set_args.n)
      assert(set_args[3] == true and set_args[8] == false, "visible set, faderScaling kept")
    `);
  });
});
