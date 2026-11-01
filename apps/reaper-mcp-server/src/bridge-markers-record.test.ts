/**
 * handlers.delete_marker / delete_region and handlers.record, run in real Lua 5.4 via wasmoon against a fake
 * `reaper` whose DeleteProjectMarker checks its arguments the way REAPER does: (proj, markrgnindexnumber, isrgn).
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

async function run(setup: string, names: string[], check: string): Promise<void> {
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`handlers = {}\n${setup}`);
    for (const name of names) await lua.doString(handler(name));
    await lua.doString(check);
  } finally {
    lua.global.close();
  }
}

const FAKE_MARKERS = `
  -- markers 3 and 4, region 1 (REAPER's own numbers, not positions in the list)
  markers = { { num = 3, isrgn = false }, { num = 4, isrgn = false }, { num = 1, isrgn = true } }
  reaper = {
    Undo_BeginBlock = function() end,
    Undo_EndBlock = function() end,
    DeleteProjectMarker = function(proj, num, isrgn)
      if type(num) ~= "number" then error("bad argument #2 to 'DeleteProjectMarker' (number expected, got " .. type(num) .. ")") end
      if type(isrgn) ~= "boolean" then error("bad argument #3 to 'DeleteProjectMarker' (boolean expected, got " .. type(isrgn) .. ")") end
      for i, m in ipairs(markers) do
        if m.num == num and m.isrgn == isrgn then table.remove(markers, i) return true end
      end
      return false
    end,
  }
  function has(num, isrgn)
    for _, m in ipairs(markers) do if m.num == num and m.isrgn == isrgn then return true end end
    return false
  end
`;

describe('delete_marker / delete_region', () => {
  it('deletes a marker by its number and leaves the region with the same number', async () => {
    await run(FAKE_MARKERS, ['delete_marker'], `
      local r, err = handlers.delete_marker({ markerIndex = 4 })
      assert(r, err)
      assert(not has(4, false), "marker 4 deleted")
      assert(has(3, false) and has(1, true), "the others kept")
    `);
  });

  it('deletes a region by its number and leaves the markers', async () => {
    await run(FAKE_MARKERS, ['delete_region'], `
      local r, err = handlers.delete_region({ regionIndex = 1 })
      assert(r, err)
      assert(not has(1, true), "region 1 deleted")
      assert(has(3, false) and has(4, false), "markers kept")
    `);
  });

  it('refuses an unknown number and changes nothing', async () => {
    await run(FAKE_MARKERS, ['delete_marker', 'delete_region'], `
      local r, err = handlers.delete_marker({ markerIndex = 9 })
      assert(r == nil and err:find("Marker 9 not found"), tostring(err))
      r, err = handlers.delete_region({ regionIndex = 3 })
      assert(r == nil and err:find("Region 3 not found"), tostring(err))
      assert(#markers == 3, "nothing deleted")
    `);
  });
});

const FAKE_TRANSPORT = `
  armed = { [0] = 0, [1] = 0 }
  ran = {}
  reaper = {
    CountTracks = function() return 2 end,
    GetTrack = function(_, i) return i end,
    GetMediaTrackInfo_Value = function(tr, key) assert(key == "I_RECARM") return armed[tr] end,
    Main_OnCommand = function(id) ran[#ran + 1] = id end,
  }
`;

describe('record', () => {
  it('refuses when no track is armed, without starting REAPER’s record (which would open a blocking dialog)', async () => {
    await run(FAKE_TRANSPORT, ['record'], `
      local r, err = handlers.record({})
      assert(r == nil and err:find("No track is armed"), tostring(err))
      assert(#ran == 0, "record action not run")
    `);
  });

  it('starts recording when a track is armed', async () => {
    await run(FAKE_TRANSPORT, ['record'], `
      armed[1] = 1
      local r, err = handlers.record({})
      assert(r and r.success, err)
      assert(ran[1] == 1013, "Transport: Record")
    `);
  });
});
