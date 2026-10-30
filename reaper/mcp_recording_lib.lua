-- mcp_recording_lib.lua — record setup (arm, input, monitoring, record mode)
-- and fixed lanes with comping.
--
-- Pure logic: every function takes the ReaScript API as `api`, so it runs
-- under a fake API in unit tests. Loaded by mcp_bridge.lua with dofile.
-- Every write validates all of its input first: a refused call changes nothing.

local M = {}

-- Global record mode: one of three toggle actions.
M.RECORD_MODES = { normal = 40252, time_selection = 40076, selected_items = 40253 }

-- I_RECMODE values by name (REAPER 7).
M.TRACK_MODES = {
  input = 0, stereo_out = 1, none = 2, stereo_out_latency = 3, midi_out = 4,
  mono_out = 5, mono_out_latency = 6, midi_overdub = 7, midi_replace = 8,
  midi_touch_replace = 9, multichannel_out = 10, multichannel_out_latency = 11,
  input_mono = 12, input_stereo = 13, input_multichannel = 14, input_midi = 15,
  midi_latch_replace = 16,
}
local MODE_NAME = {}
for k, v in pairs(M.TRACK_MODES) do MODE_NAME[v] = k end

M.MONITOR = { off = 0, on = 1, auto = 2 }
local MONITOR_NAME = { [0] = "off", [1] = "on", [2] = "auto" }

local MAX_TRACKS = 64
local MAX_LANES = 64
local MAX_LANE_ITEMS = 100
local MAX_RANGES = 200
local MIDI_ALL, MIDI_VKB = 63, 62

local function int(v) return math.floor((tonumber(v) or 0) + 0.5) end
local function round3(v) return v and math.floor(v * 1000 + 0.5) / 1000 or nil end
local function secs(v) return string.format("%g", round3(v)) end

local function track_name(api, tr)
  local _, name = api.GetTrackName(tr)
  return name or ""
end

local function track_index(api, tr)
  return int(api.GetMediaTrackInfo_Value(tr, "IP_TRACKNUMBER")) - 1
end

-- Resolve a user track ref to a real (non-master) track.
local function resolve(api, ref, resolve_track, what)
  local res, err = resolve_track(api, ref, {})
  if not res then return nil, (what and (what .. ": ") or "") .. err end
  if not res.track or res.track == api.GetMasterTrack(0) then
    return nil, (what and (what .. ": ") or "") .. "the master track cannot record or hold lanes"
  end
  return res.track
end

-- =============================================================================
-- Record inputs
-- =============================================================================

local function midi_device_name(api, dev)
  if dev == MIDI_ALL then return "all MIDI inputs" end
  if dev == MIDI_VKB then return "virtual MIDI keyboard" end
  local ok, name = api.GetMIDIInputName(dev, "")
  return ok and name or ("MIDI device " .. dev)
end

-- I_RECINPUT → { kind, ... , label }
function M.decode_input(api, v)
  v = int(v)
  if v < 0 then return { kind = "none", label = "No input" } end
  if v & 4096 ~= 0 then
    local channel = v & 31
    local device = (v >> 5) & 63
    local dev_label = device == MIDI_ALL and "all" or device == MIDI_VKB and "vkb" or device
    return {
      kind = "midi", device = dev_label, channel = channel,
      label = "MIDI: " .. midi_device_name(api, device) .. (channel == 0 and ", all channels" or (", channel " .. channel)),
    }
  end
  local start = (v & 1023) + 1
  local width = (v & 2048 ~= 0) and "multichannel" or (v & 1024 ~= 0) and "stereo" or "mono"
  local label = width == "stereo" and ("In " .. start .. "/" .. (start + 1)) or ("In " .. start)
  if width == "multichannel" then label = label .. " (multichannel)" end
  if api.GetInputChannelName and start <= (api.GetNumAudioInputs() or 0) then
    local name = api.GetInputChannelName(start - 1)
    if name and name ~= "" and width == "mono" then label = label .. " · " .. name end
  end
  return { kind = "audio", channel = start, width = width, label = label }
end

-- { kind = "audio", channel = 1-based, stereo = bool } | { kind = "midi", device = n | "all" | "vkb", channel = 0..16 }
-- | { kind = "none" } → I_RECINPUT, warnings
local function encode_input(api, spec, what)
  if type(spec) ~= "table" then return nil, what .. ": input must be an object" end
  if spec.kind == "none" then return -1 end
  if spec.kind == "audio" then
    local ch = tonumber(spec.channel)
    if not ch or ch < 1 or ch ~= math.floor(ch) then return nil, what .. ": input.channel must be a whole number from 1" end
    local stereo = spec.stereo == true
    local count = api.GetNumAudioInputs() or 0
    local last = ch + (stereo and 1 or 0)
    local warn
    if count == 0 then
      warn = what .. ": the audio device reports no inputs (is it open?), so input " .. ch .. " is set unchecked"
    elseif last > count then
      return nil, what .. ": input " .. (stereo and (ch .. "/" .. last) or tostring(ch)) .. " does not exist (the audio device has " .. count .. " inputs)"
    end
    return (int(ch) - 1) | (stereo and 1024 or 0), warn
  end
  if spec.kind == "midi" then
    local dev = spec.device
    if dev == nil or dev == "all" then dev = MIDI_ALL
    elseif dev == "vkb" then dev = MIDI_VKB
    else
      dev = tonumber(dev)
      if not dev or dev < 0 or dev > 61 or dev ~= math.floor(dev) then
        return nil, what .. ": input.device must be a MIDI input index (0-61), \"all\" or \"vkb\""
      end
      local ok = api.GetMIDIInputName(int(dev), "")
      if not ok then return nil, what .. ": MIDI input " .. dev .. " does not exist (get_record_setup lists them)" end
    end
    local channel = tonumber(spec.channel or 0)
    if not channel or channel < 0 or channel > 16 or channel ~= math.floor(channel) then
      return nil, what .. ": input.channel must be 0 (all) to 16 for MIDI"
    end
    return 4096 | int(channel) | (int(dev) << 5)
  end
  return nil, what .. ": input.kind must be audio, midi or none"
end

local function record_state(api, tr)
  local mode = int(api.GetMediaTrackInfo_Value(tr, "I_RECMODE"))
  local monitor = int(api.GetMediaTrackInfo_Value(tr, "I_RECMON"))
  return {
    index = track_index(api, tr),
    name = track_name(api, tr),
    armed = api.GetMediaTrackInfo_Value(tr, "I_RECARM") ~= 0,
    input = M.decode_input(api, api.GetMediaTrackInfo_Value(tr, "I_RECINPUT")),
    monitor = MONITOR_NAME[monitor] or monitor,
    monitorItems = api.GetMediaTrackInfo_Value(tr, "I_RECMONITEMS") ~= 0,
    mode = MODE_NAME[mode] or mode,
    inputFx = api.TrackFX_GetRecCount and api.TrackFX_GetRecCount(tr) or 0,
  }
end
M.record_state = record_state

local function global_mode(api)
  if api.GetToggleCommandState(M.RECORD_MODES.time_selection) == 1 then return "time_selection" end
  if api.GetToggleCommandState(M.RECORD_MODES.selected_items) == 1 then return "selected_items" end
  return "normal"
end

local function time_selection(api)
  local s, e = api.GetSet_LoopTimeRange(false, false, 0, 0, false)
  if type(s) == "number" and type(e) == "number" and e > s then return { start = round3(s), ["end"] = round3(e) } end
  return nil
end

local function record_path(api)
  local _, path = api.GetSetProjectInfo_String(0, "RECORD_PATH", "", false)
  return path or ""
end

local function inputs(api)
  local audio, midi = {}, {}
  local n_audio = api.GetNumAudioInputs() or 0
  for i = 0, math.min(n_audio, MAX_LANES) - 1 do
    audio[#audio + 1] = { channel = i + 1, name = api.GetInputChannelName(i) or ("Input " .. (i + 1)) }
  end
  for i = 0, math.min(api.GetNumMIDIInputs() or 0, MIDI_VKB) - 1 do
    local ok, name = api.GetMIDIInputName(i, "")
    if ok then midi[#midi + 1] = { device = i, name = name } end
  end
  return { audioCount = n_audio, audio = audio, audioMore = math.max(0, n_audio - #audio), midi = midi }
end

--- The global record mode, punch range (time_selection mode) and record path
function M.global_state(api)
  local mode = global_mode(api)
  return { mode = mode, punch = mode == "time_selection" and time_selection(api) or nil, recordPath = record_path(api) }
end

--- get_record_setup: global mode, punch range, record path, the armed tracks
--- (or every track with `all`) and the inputs that exist.
function M.get_record_setup(api, params)
  params = params or {}
  local tracks, total = {}, api.CountTracks(0)
  local listed, armed = 0, 0
  for i = 0, total - 1 do
    local tr = api.GetTrack(0, i)
    local is_armed = api.GetMediaTrackInfo_Value(tr, "I_RECARM") ~= 0
    if is_armed then armed = armed + 1 end
    if params.all or is_armed then
      listed = listed + 1
      if #tracks < MAX_TRACKS then tracks[#tracks + 1] = record_state(api, tr) end
    end
  end
  local mode = global_mode(api)
  local path = record_path(api)
  return {
    mode = mode,
    punch = mode == "time_selection" and time_selection(api) or nil,
    recordPath = path,
    projectPath = api.GetProjectPath and api.GetProjectPath("") or nil,
    armedCount = armed,
    tracks = tracks,
    tracksMore = math.max(0, listed - #tracks),
    inputs = inputs(api),
  }
end

--- set_track_record: per-track arm, input, monitoring, record mode and
--- monitor-items, all validated before the first write; one undo point.
function M.set_track_record(api, updates, resolve_track)
  if type(updates) ~= "table" or #updates == 0 then return nil, "tracks must be a non-empty array" end
  if #updates > MAX_TRACKS then return nil, "at most " .. MAX_TRACKS .. " tracks per call" end
  local plan, warnings, seen = {}, {}, {}
  for k, u in ipairs(updates) do
    local what = "tracks[" .. (k - 1) .. "]"
    if type(u) ~= "table" then return nil, what .. " must be an object" end
    local tr, err = resolve(api, u.track, resolve_track, what)
    if not tr then return nil, err .. " — nothing changed" end
    if seen[tr] then return nil, what .. ": track listed twice — nothing changed" end
    seen[tr] = true
    local p = { track = tr, sets = {} }
    if u.arm ~= nil then p.sets[#p.sets + 1] = { "I_RECARM", u.arm and 1 or 0 } end
    if u.input ~= nil then
      local v, warn = encode_input(api, u.input, what)
      if not v then return nil, warn .. " — nothing changed" end
      if warn then warnings[#warnings + 1] = warn end
      p.sets[#p.sets + 1] = { "I_RECINPUT", v }
    end
    if u.monitor ~= nil then
      local v = M.MONITOR[u.monitor]
      if not v then return nil, what .. ": monitor must be off, on or auto — nothing changed" end
      p.sets[#p.sets + 1] = { "I_RECMON", v }
    end
    if u.mode ~= nil then
      local v = M.TRACK_MODES[u.mode]
      if not v then return nil, what .. ": unknown record mode '" .. tostring(u.mode) .. "' — nothing changed" end
      p.sets[#p.sets + 1] = { "I_RECMODE", v }
    end
    if u.monitorItems ~= nil then p.sets[#p.sets + 1] = { "I_RECMONITEMS", u.monitorItems and 1 or 0 } end
    if #p.sets == 0 then return nil, what .. ": nothing to set (arm, input, monitor, mode or monitorItems) — nothing changed" end
    plan[k] = p
  end

  api.Undo_BeginBlock()
  for _, p in ipairs(plan) do
    for _, s in ipairs(p.sets) do api.SetMediaTrackInfo_Value(p.track, s[1], s[2]) end
  end
  api.Undo_EndBlock("MCP: Set track record", -1)

  local out = {}
  for k, p in ipairs(plan) do
    out[k] = record_state(api, p.track)
    -- MIDI mode on an audio input (or the reverse) records nothing useful.
    local midi_mode = out[k].mode == "midi_overdub" or out[k].mode == "midi_replace" or out[k].mode == "midi_touch_replace"
      or out[k].mode == "midi_latch_replace" or out[k].mode == "input_midi"
    if midi_mode and out[k].input.kind == "audio" then
      warnings[#warnings + 1] = out[k].name .. ": a MIDI record mode with an audio input records nothing"
    end
    if out[k].armed and out[k].input.kind == "none" and out[k].mode == "input" then
      warnings[#warnings + 1] = out[k].name .. ": armed with no input — it records silence"
    end
  end
  return { tracks = out, warnings = #warnings > 0 and warnings or nil }
end

--- set_record_mode: global record mode, optional punch range (as the time
--- selection) and record path.
function M.set_record_mode(api, params)
  params = params or {}
  local mode = params.mode
  if mode ~= nil and not M.RECORD_MODES[mode] then
    return nil, "mode must be normal, time_selection or selected_items — nothing changed"
  end
  local ps, pe = tonumber(params.punchStart), tonumber(params.punchEnd)
  if (ps == nil) ~= (pe == nil) then return nil, "give both punchStart and punchEnd — nothing changed" end
  if ps then
    if ps < 0 or pe <= ps then return nil, "punchEnd must be after punchStart (seconds, from 0) — nothing changed" end
    if (mode or global_mode(api)) ~= "time_selection" then
      return nil, "a punch range needs mode time_selection — nothing changed"
    end
  end
  local path = params.recordPath
  if path ~= nil and (type(path) ~= "string" or path:match("^%s*$")) then
    return nil, "recordPath must be a non-empty folder name or path — nothing changed"
  end
  if mode == nil and ps == nil and path == nil then return nil, "nothing to set (mode, punchStart/punchEnd or recordPath)" end

  api.Undo_BeginBlock()
  if mode and global_mode(api) ~= mode then api.Main_OnCommand(M.RECORD_MODES[mode], 0) end
  if ps then api.GetSet_LoopTimeRange(true, false, ps, pe, false) end
  if path then api.GetSetProjectInfo_String(0, "RECORD_PATH", path, true) end
  api.Undo_EndBlock("MCP: Set record mode", -1)

  local now = global_mode(api)
  return {
    mode = now,
    punch = now == "selected_items" and nil or (now == "time_selection" and time_selection(api) or nil),
    recordPath = record_path(api),
    warnings = (now == "time_selection" and not time_selection(api))
      and { "time_selection mode with no time selection records nothing until one is set" } or nil,
  }
end

-- =============================================================================
-- Fixed lanes
-- =============================================================================

local function fixed(api, tr) return int(api.GetMediaTrackInfo_Value(tr, "I_FREEMODE")) == 2 end
local function lane_count(api, tr) return math.max(1, int(api.GetMediaTrackInfo_Value(tr, "I_NUMFIXEDLANES"))) end
local function lane_name(api, tr, n)
  local _, name = api.GetSetMediaTrackInfo_String(tr, "P_LANENAME:" .. n, "", false)
  return name or ""
end
local PLAYS = { [0] = "off", [1] = "exclusive", [2] = "layered" }

local function item_info(api, it, k)
  local take = api.GetActiveTake(it)
  local name = take and api.GetTakeName(take) or ""
  return {
    index = k,
    position = round3(api.GetMediaItemInfo_Value(it, "D_POSITION")),
    length = round3(api.GetMediaItemInfo_Value(it, "D_LENGTH")),
    name = name,
    midi = take ~= nil and api.TakeIsMIDI(take) or false,
  }
end

--- The track's lanes: name, play state and items (capped per lane).
function M.lanes_state(api, tr)
  local on = fixed(api, tr)
  local count = on and lane_count(api, tr) or 1
  local lanes = {}
  for n = 0, count - 1 do
    local plays = on and int(api.GetMediaTrackInfo_Value(tr, "C_LANEPLAYS:" .. n)) or 1
    lanes[n + 1] = { lane = n, name = on and lane_name(api, tr, n) or "", plays = PLAYS[plays] or plays, items = {}, itemsMore = 0 }
  end
  for k = 0, api.CountTrackMediaItems(tr) - 1 do
    local it = api.GetTrackMediaItem(tr, k)
    local n = on and int(api.GetMediaItemInfo_Value(it, "I_FIXEDLANE")) or 0
    local lane = lanes[n + 1]
    if lane then
      if #lane.items < MAX_LANE_ITEMS then lane.items[#lane.items + 1] = item_info(api, it, k)
      else lane.itemsMore = lane.itemsMore + 1 end
    end
  end
  return { index = track_index(api, tr), name = track_name(api, tr), fixedLanes = on, laneCount = count, lanes = lanes }
end

function M.get_track_lanes(api, params, resolve_track)
  local tr, err = resolve(api, params.track, resolve_track)
  if not tr then return nil, err end
  return M.lanes_state(api, tr)
end

local function highest_used_lane(api, tr)
  local top = 0
  for k = 0, api.CountTrackMediaItems(tr) - 1 do
    top = math.max(top, int(api.GetMediaItemInfo_Value(api.GetTrackMediaItem(tr, k), "I_FIXEDLANE")))
  end
  return top
end

local function lanes_with_items(api, tr)
  local used = {}
  for k = 0, api.CountTrackMediaItems(tr) - 1 do
    used[int(api.GetMediaItemInfo_Value(api.GetTrackMediaItem(tr, k), "I_FIXEDLANE"))] = true
  end
  local n = 0
  for _ in pairs(used) do n = n + 1 end
  return n
end

--- set_track_lanes: fixed lanes on/off, lane count, names and which lanes play.
--- `play` is a lane number (plays alone) or an array of lanes (layered).
function M.set_track_lanes(api, params, resolve_track)
  local tr, err = resolve(api, params.track, resolve_track)
  if not tr then return nil, err end
  local was_on = fixed(api, tr)
  local on = params.fixedLanes == nil and was_on or params.fixedLanes == true
  local warnings = {}
  local count = on and (was_on and lane_count(api, tr) or 1) or 1

  local want_count = params.laneCount ~= nil and tonumber(params.laneCount) or nil
  if params.laneCount ~= nil then
    if not want_count or want_count < 1 or want_count > MAX_LANES or want_count ~= math.floor(want_count) then
      return nil, "laneCount must be 1-" .. MAX_LANES .. " — nothing changed"
    end
    if not on then return nil, "laneCount needs fixed lanes (set fixedLanes: true) — nothing changed" end
    local top = was_on and highest_used_lane(api, tr) or 0
    if want_count <= top then
      return nil, "lane " .. top .. " still has items: laneCount must be at least " .. (top + 1) .. " — nothing changed"
    end
    count = int(want_count)
  end

  local names = params.names
  if names ~= nil then
    if type(names) ~= "table" then return nil, "names must be an array of { lane, name } — nothing changed" end
    if not on then return nil, "lane names need fixed lanes (set fixedLanes: true) — nothing changed" end
    for k, n in ipairs(names) do
      local lane = type(n) == "table" and tonumber(n.lane)
      if not lane or lane < 0 or lane >= count or type(n.name) ~= "string" then
        return nil, "names[" .. (k - 1) .. "]: lane must be 0-" .. (count - 1) .. " with a string name — nothing changed"
      end
    end
  end

  local play
  if params.play ~= nil then
    if not on then return nil, "play needs fixed lanes (set fixedLanes: true) — nothing changed" end
    local list = type(params.play) == "table" and params.play or { params.play }
    if #list == 0 then return nil, "play must be a lane number or a non-empty array of lanes — nothing changed" end
    play = {}
    for _, n in ipairs(list) do
      local lane = tonumber(n)
      if not lane or lane < 0 or lane >= count or lane ~= math.floor(lane) then
        return nil, "play: lane " .. tostring(n) .. " does not exist (lanes 0-" .. (count - 1) .. ") — nothing changed"
      end
      play[int(lane)] = true
    end
    play.layered = type(params.play) == "table"
  end

  if params.fixedLanes == nil and params.laneCount == nil and names == nil and play == nil then
    return nil, "nothing to set (fixedLanes, laneCount, names or play)"
  end
  if was_on and not on and lanes_with_items(api, tr) > 1 then
    warnings[#warnings + 1] = "fixed lanes off: the items of every lane now sit on one lane and all play — undo_project brings the lanes back"
  end

  api.Undo_BeginBlock()
  if on ~= was_on then api.SetMediaTrackInfo_Value(tr, "I_FREEMODE", on and 2 or 0) end
  if on and want_count then api.SetMediaTrackInfo_Value(tr, "I_NUMFIXEDLANES", count) end
  for _, n in ipairs(names or {}) do api.GetSetMediaTrackInfo_String(tr, "P_LANENAME:" .. int(n.lane), n.name, true) end
  if play then
    for n = 0, count - 1 do
      api.SetMediaTrackInfo_Value(tr, "C_LANEPLAYS:" .. n, play[n] and (play.layered and 2 or 1) or 0)
    end
  end
  api.Undo_EndBlock("MCP: Set track lanes", -1)
  if api.UpdateArrange then api.UpdateArrange() end

  local out = M.lanes_state(api, tr)
  out.warnings = #warnings > 0 and warnings or nil
  return out
end

-- =============================================================================
-- Comping
-- =============================================================================

-- A copy of `src` (via its state chunk, GUIDs stripped so REAPER makes new
-- ones) trimmed to [from, to] on `lane`.
local function copy_segment(api, tr, src, from, to, lane)
  local ok, chunk = api.GetItemStateChunk(src, "", false)
  if not ok then error("could not read an item on the source lane", 0) end
  local lines = {}
  for line in (chunk .. "\n"):gmatch("(.-)\r?\n") do
    if not (line:match("^%s*IGUID ") or line:match("^%s*GUID ") or line:match("^%s*POOLEDEVTS ")) then
      lines[#lines + 1] = line
    end
  end
  local it = api.AddMediaItemToTrack(tr)
  api.SetItemStateChunk(it, table.concat(lines, "\n"), false)
  local pos = api.GetMediaItemInfo_Value(src, "D_POSITION")
  for t = 0, api.CountTakes(it) - 1 do
    local take = api.GetTake(it, t)
    local rate = api.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")
    local offs = api.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
    api.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", offs + (from - pos) * (rate > 0 and rate or 1))
  end
  api.SetMediaItemInfo_Value(it, "D_POSITION", from)
  api.SetMediaItemInfo_Value(it, "D_LENGTH", to - from)
  api.SetMediaItemInfo_Value(it, "I_FIXEDLANE", lane)
  api.SetMediaItemInfo_Value(it, "B_UISEL", 0)
  return it
end

--- comp_lanes: build a comp on a new lane from time ranges of the source
--- lanes, crossfaded at each switch, and play it alone.
function M.comp_lanes(api, params, resolve_track)
  local tr, err = resolve(api, params.track, resolve_track)
  if not tr then return nil, err end
  if not fixed(api, tr) then return nil, "the track has no fixed lanes (set_track_lanes fixedLanes: true, or record in lanes first)" end
  local count = lane_count(api, tr)
  if count >= MAX_LANES then return nil, "the track already has " .. count .. " lanes (max " .. MAX_LANES .. ")" end
  local ranges = params.ranges
  if type(ranges) ~= "table" or #ranges == 0 then return nil, "ranges must be a non-empty array of { start, end, lane }" end
  if #ranges > MAX_RANGES then return nil, "at most " .. MAX_RANGES .. " ranges per comp" end
  local xf = tonumber(params.crossfadeMs or 10)
  if not xf or xf < 0 or xf > 500 then return nil, "crossfadeMs must be 0-500" end
  xf = xf / 1000

  -- Items per lane, sorted by position.
  local by_lane = {}
  for k = 0, api.CountTrackMediaItems(tr) - 1 do
    local it = api.GetTrackMediaItem(tr, k)
    local n = int(api.GetMediaItemInfo_Value(it, "I_FIXEDLANE"))
    local pos = api.GetMediaItemInfo_Value(it, "D_POSITION")
    by_lane[n] = by_lane[n] or {}
    table.insert(by_lane[n], { item = it, s = pos, e = pos + api.GetMediaItemInfo_Value(it, "D_LENGTH") })
  end
  for _, list in pairs(by_lane) do table.sort(list, function(a, b) return a.s < b.s end) end

  local rs = {}
  for k, r in ipairs(ranges) do
    local what = "ranges[" .. (k - 1) .. "]"
    local s, e, lane = type(r) == "table" and tonumber(r.start), type(r) == "table" and tonumber(r["end"]), type(r) == "table" and tonumber(r.lane)
    if not s or not e or not lane then return nil, what .. " needs start, end (seconds) and lane — nothing changed" end
    if s < 0 or e <= s then return nil, what .. ": end must be after start — nothing changed" end
    if lane < 0 or lane >= count or lane ~= math.floor(lane) then
      return nil, what .. ": lane " .. lane .. " does not exist (lanes 0-" .. (count - 1) .. ") — nothing changed"
    end
    rs[#rs + 1] = { s = s, e = e, lane = int(lane), k = k - 1 }
  end
  table.sort(rs, function(a, b) return a.s < b.s end)
  for i = 2, #rs do
    if rs[i].s < rs[i - 1].e - 1e-9 then
      return nil, "ranges[" .. rs[i - 1].k .. "] and ranges[" .. rs[i].k .. "] overlap — nothing changed"
    end
  end

  -- Each range must be covered by audio on its lane, with no gap.
  local segments = {}
  for _, r in ipairs(rs) do
    local at = r.s
    for _, src in ipairs(by_lane[r.lane] or {}) do
      if src.e > at + 1e-9 and src.s < r.e - 1e-9 then
        if src.s > at + 1e-6 then break end
        local to = math.min(src.e, r.e)
        segments[#segments + 1] = { src = src, s = at, e = to, lane = r.lane }
        at = to
        if at >= r.e - 1e-9 then break end
      end
    end
    if at < r.e - 1e-6 then
      local gap_end = r.e
      for _, src in ipairs(by_lane[r.lane] or {}) do
        if src.s > at + 1e-6 then gap_end = math.min(gap_end, src.s); break end
      end
      return nil, "lane " .. r.lane .. " has no audio from " .. secs(at) .. " s to " .. secs(gap_end) .. " s (ranges[" .. r.k .. "]) — nothing changed"
    end
  end

  local comp_lane = count
  local label = "MCP: Comp lanes"
  api.Undo_BeginBlock()
  api.PreventUIRefresh(1)
  local ok, res = pcall(function()
    api.SetMediaTrackInfo_Value(tr, "I_NUMFIXEDLANES", count + 1)
    api.GetSetMediaTrackInfo_String(tr, "P_LANENAME:" .. comp_lane, type(params.name) == "string" and params.name ~= "" and params.name or "Comp", true)
    local made = {}
    for i, seg in ipairs(segments) do
      local nxt, prev = segments[i + 1], segments[i - 1]
      local joins_next = nxt and math.abs(nxt.s - seg.e) < 1e-6
      local joins_prev = prev and math.abs(prev.e - seg.s) < 1e-6
      -- Overlap the next segment by the crossfade, as far as this source item reaches.
      local tail = joins_next and math.min(xf, seg.src.e - seg.e) or 0
      local it = copy_segment(api, tr, seg.src.item, seg.s, seg.e + tail, comp_lane)
      local keep_in = math.abs(seg.s - seg.src.s) < 1e-6 and api.GetMediaItemInfo_Value(seg.src.item, "D_FADEINLEN") or 0
      local keep_out = math.abs(seg.e - seg.src.e) < 1e-6 and api.GetMediaItemInfo_Value(seg.src.item, "D_FADEOUTLEN") or 0
      local fade_in = joins_prev and (made[i - 1] and made[i - 1].tail or 0) or keep_in
      api.SetMediaItemInfo_Value(it, "D_FADEINLEN", fade_in)
      api.SetMediaItemInfo_Value(it, "D_FADEOUTLEN", joins_next and tail or keep_out)
      made[i] = { item = it, tail = tail, s = round3(seg.s), e = round3(seg.e), lane = seg.lane, fadeMs = round3(tail * 1000) }
    end
    for n = 0, count do api.SetMediaTrackInfo_Value(tr, "C_LANEPLAYS:" .. n, n == comp_lane and 1 or 0) end
    return made
  end)
  api.PreventUIRefresh(-1)
  api.Undo_EndBlock(label, -1)
  if not ok then
    if api.Undo_CanUndo2(0) == label then api.Undo_DoUndo2(0) end
    return nil, "comp failed and was undone: " .. tostring(res)
  end
  if api.UpdateArrange then api.UpdateArrange() end

  local out = M.lanes_state(api, tr)
  out.compLane = comp_lane
  out.segments = {}
  for i, m in ipairs(res) do out.segments[i] = { start = m.s, ["end"] = m.e, lane = m.lane, crossfadeMs = m.fadeMs } end
  return out
end

return M
