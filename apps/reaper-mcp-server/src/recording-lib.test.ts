/**
 * Unit tests for reaper/mcp_recording_lib.lua, run in real Lua 5.4 (wasmoon)
 * against a small fake of the record and fixed-lane API (below).
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_recording_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');

const factory = new LuaFactory();

// Tracks hold `vals` (I_RECARM, I_RECINPUT, I_FREEMODE, C_LANEPLAYS:n, …) and
// items; items hold vals and takes and round-trip through a state chunk.
const FAKE = `
function fake(spec)
  spec = spec or {}
  local api = { undo = {}, writes = 0, toggles = { [40252] = 1, [40076] = 0, [40253] = 0 } }
  local guid_n = 0
  local function guid() guid_n = guid_n + 1; return string.format("{G%04d}", guid_n) end
  local function write() api.writes = api.writes + 1; if api.in_block then api.dirty = true end end
  local master = { name = "MASTER", vals = {}, items = {}, names = {} }
  local tracks = {}
  local function new_item(tr, v)
    local it = { track = tr, guid = guid(), vals = { D_POSITION = v.pos or 0, D_LENGTH = v.len or 1, I_FIXEDLANE = v.lane or 0,
      D_FADEINLEN = v.fin or 0, D_FADEOUTLEN = v.fout or 0, B_UISEL = 0 }, takes = {} }
    it.takes[1] = { name = v.name or "take", guid = guid(), vals = { D_STARTOFFS = v.offs or 0, D_PLAYRATE = v.rate or 1 } }
    tr.items[#tr.items + 1] = it
    return it
  end
  for _, t in ipairs(spec.tracks or {}) do
    local tr = { name = t.name, guid = guid(), vals = {}, items = {}, names = {} }
    for k, v in pairs(t.vals or {}) do tr.vals[k] = v end
    tracks[#tracks + 1] = tr
    for _, v in ipairs(t.items or {}) do new_item(tr, v) end
  end
  api.tracks = tracks
  api.CountTracks = function() return #tracks end
  api.GetTrack = function(_, i) return tracks[i + 1] end
  api.GetMasterTrack = function() return master end
  api.GetTrackName = function(tr) return true, tr.name end
  api.GetTrackGUID = function(tr) return tr.guid end
  api.GetMediaTrackInfo_Value = function(tr, k)
    if k == "IP_TRACKNUMBER" then
      for i, t in ipairs(tracks) do if t == tr then return i end end
      return -1
    end
    if k == "I_NUMFIXEDLANES" then return tr.vals[k] or 1 end
    if k:match("^C_LANEPLAYS:") then return tr.vals[k] or (k == "C_LANEPLAYS:0" and 1 or 0) end
    if k == "I_RECINPUT" then return tr.vals[k] or 0 end
    return tr.vals[k] or 0
  end
  api.SetMediaTrackInfo_Value = function(tr, k, v)
    write()
    if k == "I_FREEMODE" and v ~= 2 then for _, it in ipairs(tr.items) do it.vals.I_FIXEDLANE = 0 end end
    if k:match("^C_LANEPLAYS:") and v == 1 then
      for key in pairs(tr.vals) do if key:match("^C_LANEPLAYS:") then tr.vals[key] = 0 end end
      for n = 0, 63 do if tr.vals["C_LANEPLAYS:" .. n] == nil then tr.vals["C_LANEPLAYS:" .. n] = 0 end end
    end
    tr.vals[k] = v
    return true
  end
  api.GetSetMediaTrackInfo_String = function(tr, k, v, set)
    local n = k:match("^P_LANENAME:(%d+)")
    if set then write(); tr.names[n] = v; return true, v end
    return true, tr.names[n] or tostring(tonumber(n) + 1)
  end
  api.TrackFX_GetRecCount = function(tr) return tr.vals.recfx or 0 end
  -- Inputs
  api.GetNumAudioInputs = function() return spec.audio_inputs or 8 end
  api.GetInputChannelName = function(i) return "Input " .. (i + 1) end
  api.GetNumMIDIInputs = function() return 130 end
  api.GetMIDIInputName = function(i)
    local name = (spec.midi or { [0] = "IAC Bus 1" })[i]
    if name then return true, name end
    return false, ""
  end
  -- Project, record mode, time selection
  api.record_path = "media"
  api.GetSetProjectInfo_String = function(_, k, v, set)
    if set then write(); api.record_path = v end
    return true, api.record_path
  end
  api.GetProjectPath = function() return "/proj" end
  api.GetToggleCommandState = function(id) return api.toggles[id] or -1 end
  api.Main_OnCommand = function(id)
    write()
    for k in pairs(api.toggles) do api.toggles[k] = 0 end
    api.toggles[id] = 1
  end
  api.sel = { 0, 0 }
  api.GetSet_LoopTimeRange = function(set, _, s, e)
    if set then write(); api.sel = { s, e } end
    return api.sel[1], api.sel[2]
  end
  -- Items
  api.CountTrackMediaItems = function(tr) return #tr.items end
  api.GetTrackMediaItem = function(tr, i) return tr.items[i + 1] end
  api.GetMediaItemInfo_Value = function(it, k) return it.vals[k] or 0 end
  api.SetMediaItemInfo_Value = function(it, k, v) write(); it.vals[k] = v; return true end
  api.GetActiveTake = function(it) return it.takes[1] end
  api.GetTakeName = function(t) return t.name end
  api.TakeIsMIDI = function() return false end
  api.CountTakes = function(it) return #it.takes end
  api.GetTake = function(it, i) return it.takes[i + 1] end
  api.GetMediaItemTakeInfo_Value = function(t, k) return t.vals[k] or 0 end
  api.SetMediaItemTakeInfo_Value = function(t, k, v) write(); t.vals[k] = v; return true end
  api.AddMediaItemToTrack = function(tr) write(); return new_item(tr, {}) end
  api.GetItemStateChunk = function(it)
    local t = it.takes[1]
    return true, table.concat({ "<ITEM", "POSITION " .. it.vals.D_POSITION, "LENGTH " .. it.vals.D_LENGTH,
      "FIXEDLANE " .. it.vals.I_FIXEDLANE, "IGUID " .. it.guid, "NAME " .. t.name, "GUID " .. t.guid,
      "SOFFS " .. t.vals.D_STARTOFFS, "PLAYRATE " .. t.vals.D_PLAYRATE, ">" }, "\\n")
  end
  api.SetItemStateChunk = function(it, chunk)
    write()
    local t = it.takes[1]
    for line in chunk:gmatch("[^\\n]+") do
      local k, v = line:match("^(%S+) (.*)$")
      if k == "POSITION" then it.vals.D_POSITION = tonumber(v)
      elseif k == "LENGTH" then it.vals.D_LENGTH = tonumber(v)
      elseif k == "FIXEDLANE" then it.vals.I_FIXEDLANE = tonumber(v)
      elseif k == "IGUID" then it.guid = v
      elseif k == "GUID" then t.guid = v
      elseif k == "NAME" then t.name = v
      elseif k == "SOFFS" then t.vals.D_STARTOFFS = tonumber(v)
      elseif k == "PLAYRATE" then t.vals.D_PLAYRATE = tonumber(v) end
    end
    return true
  end
  api.PreventUIRefresh = function() end
  api.UpdateArrange = function() end
  api.Undo_BeginBlock = function() api.in_block = true; api.dirty = false end
  api.Undo_EndBlock = function(label) api.in_block = false; if api.dirty then api.undo[#api.undo + 1] = label end end
  api.Undo_CanUndo2 = function() return api.undo[#api.undo] end
  api.Undo_DoUndo2 = function() api.undone = table.remove(api.undo) end
  return api
end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(
      `rec = load(LIB_SRC, "mcp_recording_lib.lua")()\nplan = load(PLAN_SRC, "mcp_plan_lib.lua")()\n${FAKE}\nR = plan.resolve_track\n${snippet}`,
    );
  } finally {
    lua.global.close();
  }
}

// Three takes of a vocal, one per lane, 10–20 s.
const TAKES = `{ tracks = {
  { name = "Vox", vals = { I_FREEMODE = 2, I_NUMFIXEDLANES = 3 }, items = {
    { pos = 10, len = 10, lane = 0, name = "Take 1" },
    { pos = 10, len = 10, lane = 1, name = "Take 2", offs = 2 },
    { pos = 10, len = 4, lane = 2, name = "Take 3a" },
    { pos = 16, len = 4, lane = 2, name = "Take 3b" },
  } },
  { name = "Gtr" },
} }`;

describe('mcp_recording_lib.lua (wasmoon)', () => {
  it('get_record_setup lists armed tracks with readable inputs and the inputs that exist', async () => {
    await runLua(`
      local api = fake{ midi = { [0] = "IAC Bus 1", [3] = "Keystation" }, tracks = {
        { name = "Vox", vals = { I_RECARM = 1, I_RECINPUT = 1026, I_RECMON = 2 } },
        { name = "Keys", vals = { I_RECARM = 1, I_RECINPUT = 6112, I_RECMODE = 7 } },
        { name = "Bass", vals = { I_RECINPUT = 0 } },
      } }
      local r = rec.get_record_setup(api, {})
      assert(r.mode == "normal" and r.recordPath == "media" and r.armedCount == 2, "mode/path/count")
      assert(#r.tracks == 2 and r.tracks[1].name == "Vox", "only armed tracks")
      local vox, keys = r.tracks[1], r.tracks[2]
      assert(vox.input.kind == "audio" and vox.input.channel == 3 and vox.input.width == "stereo" and vox.input.label == "In 3/4", vox.input.label)
      assert(vox.monitor == "auto" and vox.mode == "input")
      assert(keys.input.kind == "midi" and keys.input.device == "all" and keys.input.channel == 0, keys.input.label)
      assert(keys.mode == "midi_overdub")
      assert(#r.inputs.audio == 8 and #r.inputs.midi == 2 and r.inputs.midi[2].device == 3 and r.inputs.midi[2].name == "Keystation")
      local all = rec.get_record_setup(api, { all = true })
      assert(#all.tracks == 3 and all.armedCount == 2, "all lists every track and still counts only the armed ones: " .. tostring(all.armedCount))
    `);
  });

  it('set_track_record arms, routes and monitors several tracks in one undo point', async () => {
    await runLua(`
      local api = fake{ tracks = { { name = "Vox" }, { name = "Keys" } } }
      local r = assert(rec.set_track_record(api, {
        { track = "Vox", arm = true, input = { kind = "audio", channel = 3, stereo = true }, monitor = "auto" },
        { track = 1, arm = true, input = { kind = "midi", device = 0, channel = 2 }, mode = "midi_overdub" },
      }, R))
      assert(#api.undo == 1 and api.undo[1] == "MCP: Set track record", "one undo point")
      assert(r.tracks[1].armed and r.tracks[1].input.label == "In 3/4" and r.tracks[1].monitor == "auto")
      assert(r.tracks[2].input.kind == "midi" and r.tracks[2].input.device == 0 and r.tracks[2].input.channel == 2)
      assert(r.tracks[2].mode == "midi_overdub" and r.warnings == nil)
    `);
  });

  it('set_track_record refuses a missing input and changes nothing', async () => {
    await runLua(`
      local api = fake{ audio_inputs = 2, tracks = { { name = "Vox" }, { name = "Keys" } } }
      local r, err = rec.set_track_record(api, {
        { track = "Vox", arm = true },
        { track = "Keys", input = { kind = "audio", channel = 2, stereo = true } },
      }, R)
      assert(r == nil and err:find("2/3 does not exist") and err:find("nothing changed"), err)
      assert(api.writes == 0 and #api.undo == 0, "nothing written")
      local _, e2 = rec.set_track_record(api, { { track = "Keys", input = { kind = "midi", device = 7 } } }, R)
      assert(e2:find("MIDI input 7 does not exist"), e2)
      local _, e3 = rec.set_track_record(api, { { track = "Nope", arm = true } }, R)
      assert(e3:find("not found"), e3)
      local _, e4 = rec.set_track_record(api, { { track = "master", arm = true } }, R)
      assert(e4:find("master"), e4)
      assert(api.writes == 0, "still nothing written")
    `);
  });

  it('set_track_record warns when a MIDI mode meets an audio input, or an armed track has no input', async () => {
    await runLua(`
      local api = fake{ tracks = { { name = "Vox" }, { name = "Gtr" } } }
      local r = assert(rec.set_track_record(api, {
        { track = "Vox", arm = true, mode = "midi_replace" },
        { track = "Gtr", arm = true, input = { kind = "none" } },
      }, R))
      assert(#r.warnings == 2 and r.warnings[1]:find("MIDI record mode") and r.warnings[2]:find("silence"), table.concat(r.warnings, "|"))
    `);
  });

  it('set_record_mode switches to auto-punch with a punch range and a record path', async () => {
    await runLua(`
      local api = fake{}
      local r = assert(rec.set_record_mode(api, { mode = "time_selection", punchStart = 12, punchEnd = 20.5, recordPath = "takes" }))
      assert(r.mode == "time_selection" and r.punch.start == 12 and r.punch["end"] == 20.5 and r.recordPath == "takes")
      assert(#api.undo == 1, "one undo point")
      local _, err = rec.set_record_mode(api, { mode = "normal", punchStart = 1, punchEnd = 2 })
      assert(err:find("needs mode time_selection"), err)
      local _, e2 = rec.set_record_mode(api, { punchStart = 5, punchEnd = 4 })
      assert(e2:find("after punchStart"), e2)
      assert(rec.get_record_setup(api, {}).mode == "time_selection", "refusals changed nothing")
    `);
  });

  it('set_record_mode reports a mode switch REAPER did not make as an error and leaves the punch range and path alone', async () => {
    await runLua(`
      local api = fake{}
      api.Main_OnCommand = function() end -- the toggle action does nothing
      local before = { api.GetSet_LoopTimeRange(false, false, 0, 0, false) }
      local r, err = rec.set_record_mode(api, { mode = "time_selection", punchStart = 12, punchEnd = 20, recordPath = "Takes" })
      assert(r == nil and err:find("did not switch the record mode to time_selection %(it reads normal%)"), tostring(err))
      local s, e = api.GetSet_LoopTimeRange(false, false, 0, 0, false)
      assert(s == before[1] and e == before[2], "the time selection is left as it was")
      local _, path = api.GetSetProjectInfo_String(0, "RECORD_PATH", "", false)
      assert(path ~= "Takes", "the record path is left as it was")
      assert(#api.undo == 0, "no undo point")
    `);
  });

  it('get_track_lanes groups items by lane with names and play state', async () => {
    await runLua(`
      local api = fake${TAKES}
      local r = assert(rec.get_track_lanes(api, { track = "Vox" }, R))
      assert(r.fixedLanes and r.laneCount == 3 and #r.lanes == 3)
      assert(r.lanes[1].plays == "exclusive" and r.lanes[2].plays == "off" and r.lanes[2].name == "2")
      assert(#r.lanes[3].items == 2 and r.lanes[3].items[2].name == "Take 3b" and r.lanes[3].items[2].position == 16)
      local g = rec.get_track_lanes(api, { track = "Gtr" }, R)
      assert(not g.fixedLanes and g.laneCount == 1 and #g.lanes[1].items == 0)
    `);
  });

  it('set_track_lanes names lanes, layers two and refuses dropping a lane with items', async () => {
    await runLua(`
      local api = fake${TAKES}
      local r = assert(rec.set_track_lanes(api, { track = "Vox", names = { { lane = 0, name = "Verse A" } }, play = { 0, 2 } }, R))
      assert(r.lanes[1].name == "Verse A" and r.lanes[1].plays == "layered" and r.lanes[2].plays == "off" and r.lanes[3].plays == "layered")
      assert(#api.undo == 1)
      local before = api.writes
      local _, err = rec.set_track_lanes(api, { track = "Vox", laneCount = 2 }, R)
      assert(err:find("lane 2 still has items"), err)
      local _, e2 = rec.set_track_lanes(api, { track = "Vox", play = 5 }, R)
      assert(e2:find("lane 5 does not exist"), e2)
      local _, e3 = rec.set_track_lanes(api, { track = "Gtr", play = 0 }, R)
      assert(e3:find("needs fixed lanes"), e3)
      assert(api.writes == before, "refusals wrote nothing")
    `);
  });

  it('set_track_lanes warns that turning fixed lanes off collapses the takes', async () => {
    await runLua(`
      local api = fake${TAKES}
      local r = assert(rec.set_track_lanes(api, { track = "Vox", fixedLanes = false }, R))
      assert(not r.fixedLanes and #r.lanes[1].items == 4, "every item on one lane")
      assert(r.warnings and r.warnings[1]:find("all play"), "collapse warning")
      local on = assert(rec.set_track_lanes(api, { track = "Gtr", fixedLanes = true, laneCount = 4 }, R))
      assert(on.fixedLanes and on.laneCount == 4)
    `);
  });

  it('comp_lanes builds a crossfaded comp lane from ranges of the takes and plays it alone', async () => {
    await runLua(`
      local api = fake${TAKES}
      local r = assert(rec.comp_lanes(api, { track = "Vox", crossfadeMs = 20, ranges = {
        { start = 13, ["end"] = 17, lane = 1 },
        { start = 10, ["end"] = 13, lane = 0 },
        { start = 17, ["end"] = 20, lane = 2 },
      } }, R))
      assert(r.compLane == 3 and r.laneCount == 4 and r.lanes[4].name == "Comp", "new lane named Comp")
      for n = 1, 3 do assert(r.lanes[n].plays == "off", "source lane " .. n .. " muted") end
      assert(r.lanes[4].plays == "exclusive", "comp plays alone")
      local items = r.lanes[4].items
      assert(#items == 3 and #r.segments == 3, "one item per segment")
      assert(items[1].position == 10 and math.abs(items[1].length - 3.02) < 1e-6, "first overlaps the next by the crossfade")
      assert(items[2].position == 13 and items[2].name == "Take 2")
      assert(items[3].position == 17 and items[3].name == "Take 3b")
      local tr = api.tracks[1]
      local mid = tr.items[#tr.items - 1]
      -- Take 2 starts 2 s into its source; the segment starts 3 s into the item.
      assert(math.abs(mid.takes[1].vals.D_STARTOFFS - 5) < 1e-9, "source offset follows the trim")
      assert(math.abs(mid.vals.D_FADEINLEN - 0.02) < 1e-9 and math.abs(mid.vals.D_FADEOUTLEN - 0.02) < 1e-9, "crossfades")
      local guids = {}
      for _, it in ipairs(tr.items) do assert(not guids[it.guid], "unique item GUIDs"); guids[it.guid] = true end
      assert(#api.undo == 1 and api.undo[1] == "MCP: Comp lanes")
    `);
  });

  it('comp_lanes keeps a short part audible: a crossfade never covers more than half of it', async () => {
    await runLua(`
      local api = fake${TAKES}
      local r = assert(rec.comp_lanes(api, { track = "Vox", crossfadeMs = 200, ranges = {
        { start = 10, ["end"] = 13, lane = 0 },
        { start = 13, ["end"] = 13.1, lane = 1 },
      } }, R))
      local items = r.lanes[4].items
      assert(math.abs(items[1].length - 3.05) < 1e-6, "the first overlaps the 100 ms part by 50 ms, not 200: " .. items[1].length)
    `);
  });

  it('comp_lanes refuses a range with no audio on its lane, or overlapping ranges, and changes nothing', async () => {
    await runLua(`
      local api = fake${TAKES}
      local _, err = rec.comp_lanes(api, { track = "Vox", ranges = { { start = 12, ["end"] = 18, lane = 2 } } }, R)
      assert(err:find("lane 2 has no audio from 14 s to 16 s"), err)
      local _, e2 = rec.comp_lanes(api, { track = "Vox", ranges = { { start = 10, ["end"] = 15, lane = 0 }, { start = 14, ["end"] = 18, lane = 1 } } }, R)
      assert(e2:find("overlap"), e2)
      local _, e3 = rec.comp_lanes(api, { track = "Gtr", ranges = { { start = 0, ["end"] = 1, lane = 0 } } }, R)
      assert(e3:find("no fixed lanes"), e3)
      assert(api.writes == 0 and #api.tracks[1].items == 4, "nothing written")
    `);
  });

  it('comp_lanes undoes a comp that fails half way', async () => {
    await runLua(`
      local api = fake${TAKES}
      local n = 0
      local real = api.SetItemStateChunk
      api.SetItemStateChunk = function(...) n = n + 1; if n == 2 then error("disk full") end; return real(...) end
      local r, err = rec.comp_lanes(api, { track = "Vox", ranges = { { start = 10, ["end"] = 13, lane = 0 }, { start = 13, ["end"] = 20, lane = 1 } } }, R)
      assert(r == nil and err:find("undone") and err:find("disk full"), err)
      assert(api.undone == "MCP: Comp lanes", "the partial comp was undone")
    `);
  });
});
