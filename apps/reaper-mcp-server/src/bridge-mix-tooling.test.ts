/**
 * handlers.set_track_property (record arm, phase, input, playback offset),
 * handlers.render_track_to_wav (master = whole mix, no solo) and
 * handlers.remove_mcp_meters, run in real Lua 5.4 via wasmoon against a fake `reaper`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const BRIDGE_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');
const LUFS_JSFX = readFileSync(join(__dirname, '../../../reaper/mcp_lufs_meter.jsfx'), 'utf8');

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

const FAKE_TRACK_INFO = `
  info = { I_PLAY_OFFSET_FLAG = 3 }
  from_db = function(db) return 10 ^ (db / 20) end
  reaper = {
    GetTrack = function(_, i) if i == 0 then return "TR" end end,
    Undo_BeginBlock = function() end,
    Undo_EndBlock = function() end,
    SetMediaTrackInfo_Value = function(_, key, v) info[key] = v end,
    GetMediaTrackInfo_Value = function(_, key) return info[key] or 0 end,
  }
`;

describe('set_track_property', () => {
  it('sets record arm, phase and input, which the tool advertises', async () => {
    await run(FAKE_TRACK_INFO, 'set_track_property', `
      for _, p in ipairs({ {"recordArm", "I_RECARM", 1}, {"phase", "B_PHASE", 1}, {"input", "I_RECINPUT", 1024} }) do
        local r, err = handlers.set_track_property({ trackIndex = 0, property = p[1], value = p[3] })
        assert(r, err)
        assert(info[p[2]] == p[3], p[1] .. " -> " .. p[2])
      end
    `);
  });

  it('sets playOffsetMs in seconds and clears the bypass and samples flags', async () => {
    await run(FAKE_TRACK_INFO, 'set_track_property', `
      local r, err = handlers.set_track_property({ trackIndex = 0, property = "playOffsetMs", value = -0.84 })
      assert(r, err)
      assert(math.abs(info.D_PLAY_OFFSET - (-0.00084)) < 1e-12, "ms -> s, got " .. tostring(info.D_PLAY_OFFSET))
      assert(info.I_PLAY_OFFSET_FLAG == 0, "flags &1 (bypass) and &2 (samples) cleared")
    `);
  });

  it('still refuses an unknown property', async () => {
    await run(FAKE_TRACK_INFO, 'set_track_property', `
      local r, err = handlers.set_track_property({ trackIndex = 0, property = "width", value = 1 })
      assert(r == nil and err:find("Unknown property"))
    `);
  });
});

const FAKE_RENDER = `
  solo = { [0] = 1, [1] = 0 }
  rendered = false
  written = {}
  reaper = {
    GetTrack = function(_, i) if i == 0 or i == 1 then return "T" .. i end end,
    GetMasterTrack = function() return "MASTER" end,
    CountTracks = function() return 2 end,
    GetTempPath = function() return "/tmp" end,
    GetSetMediaTrackInfo_String = function() return true, "Kick" end,
    GetSetProjectInfo_String = function(_, key, v, set) return true, "" end,
    GetSetProjectInfo = function() return 0 end,
    GetMediaTrackInfo_Value = function(t) return solo[tonumber(t:sub(2))] or 0 end,
    SetMediaTrackInfo_Value = function(t, _, v)
      if not rendered then written[t] = v end
      if t ~= "MASTER" then solo[tonumber(t:sub(2))] = v end
    end,
    Main_OnCommand = function() rendered = true end,
    ShowConsoleMsg = function() end,
  }
  io = { open = function() return { read = function() return "RIFF" end, close = function() end } end }
  os = { remove = function() end, time = os.time }
`;

describe('render_track_to_wav master', () => {
  it('renders -1 as the whole mix: every solo cleared, none set, then restored', async () => {
    await run(FAKE_RENDER, 'render_track_to_wav', `
      local r, err = handlers.render_track_to_wav({ trackIndex = -1, startTime = 0, endTime = 5, commandId = "abc" })
      assert(r, err)
      assert(r.trackName == "MASTER", "name " .. tostring(r.trackName))
      assert(written.T0 == 0 and written.T1 == 0, "all solos cleared during the render")
      assert(written.MASTER == nil, "master is never soloed")
      assert(solo[0] == 1, "user's solo restored")
    `);
  });

  it('still solos a normal track', async () => {
    await run(FAKE_RENDER, 'render_track_to_wav', `
      local r, err = handlers.render_track_to_wav({ trackIndex = 1, startTime = 0, endTime = 5, commandId = "abc" })
      assert(r, err)
      assert(written.T1 == 1, "target soloed")
    `);
  });
});

const FAKE_METERS = `
  MCP_FX_PREFIX = "MCP "
  container_cache = {}
  chains = {
    T0 = { "ReaEQ", "MCP Meters", "JS: MCP LUFS Meter", "JS: MCP MIDI Emitter" },
  }
  reaper = {
    GetTrack = function(_, i) if i == 0 then return "T0" end end,
    Undo_BeginBlock = function() end,
    Undo_EndBlock = function() end,
    TrackFX_GetCount = function(t) return #chains[t] end,
    TrackFX_GetFXName = function(t, i) return true, chains[t][i + 1] end,
    TrackFX_Delete = function(t, i) table.remove(chains[t], i + 1) end,
  }
`;

describe('render_track_to_wav offset report', () => {
  it('reports the playback offset in ms (samples mode converted) and the polarity', async () => {
    await run(FAKE_RENDER + `
      local base = reaper.GetMediaTrackInfo_Value
      local extra = { I_PLAY_OFFSET_FLAG = 2, D_PLAY_OFFSET = 441, B_PHASE = 1 }
      reaper.GetMediaTrackInfo_Value = function(t, key) return extra[key] or base(t, key) end
    `, 'render_track_to_wav', `
      local r, err = handlers.render_track_to_wav({ trackIndex = 1, startTime = 0, endTime = 5, commandId = "abc" })
      assert(r, err)
      assert(math.abs(r.playOffsetMs - 10) < 1e-9, "441 samples at 44.1k = 10 ms, got " .. tostring(r.playOffsetMs))
      assert(r.phaseInverted == true)
    `);
  });
});

describe('remove_mcp_meters', () => {
  it('deletes the MCP Meters container and loose meters, keeps other FX and the MIDI emitter', async () => {
    await run(FAKE_METERS, 'remove_mcp_meters', `
      local r, err = handlers.remove_mcp_meters({ trackIndices = { 0, 5 } })
      assert(r, err)
      assert(#chains.T0 == 2 and chains.T0[1] == "ReaEQ" and chains.T0[2] == "JS: MCP MIDI Emitter",
        "left: " .. table.concat(chains.T0, ", "))
      assert(r.tracks[1].removed == 2)
      assert(r.tracks[2].found == false, "unknown track reported, not an error")
    `);
  });
});

describe('MCP LUFS meter', () => {
  it('sums the channel mean squares (BS.1770) instead of averaging them', () => {
    expect(LUFS_JSFX).not.toMatch(/\(\s*(buf_size|mom_samples|integrated_count)\s*\*\s*2\s*\)/);
    expect(LUFS_JSFX).toMatch(/integrated_sum \/ integrated_count/);
  });
});
