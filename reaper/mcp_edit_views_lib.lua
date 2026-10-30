-- Edit views for the MCP Bridge status page: what a write changed and what a listing showed, kept on the
-- command's log entry (`r`). Writes read the state they touch before the handler runs (M.before) and again
-- after (M.summary); listings summarise their response. Every list is capped so one entry stays a few KB.
-- Pure Lua over an injected API (M.init), loaded by mcp_bridge.lua and tested through it in wasmoon.
local M = {}

local api, ctx

--- ctx: { api, to_db, json_decode, json_decode_array, get_midi_notes, get_midi_take, get_midi_cc, resolve_track }
function M.init(c)
  ctx = c
  api = c.api
end

local function round2(v)
  if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then return nil end
  return math.floor(v * 100 + 0.5) / 100
end
local EDIT_MAX_ROWS = 32
local EDIT_MAX_POINTS = 200
local EDIT_MAX_NOTES = 256
local EDIT_MAX_MARKS = 64

local function round3(v)
  if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then return nil end
  return math.floor(v * 1000 + 0.5) / 1000
end

-- Arrays in params arrive as JSON strings
local function decode_param_list(v)
  if type(v) == "table" then return v end
  if type(v) ~= "string" then return nil end
  for _, decode in ipairs({ ctx.json_decode, ctx.json_decode_array }) do
    local ok, val = pcall(decode, v)
    if ok and type(val) == "table" then return val end
  end
  return nil
end

local function track_named(idx)
  idx = tonumber(idx)
  if idx == nil then return nil end
  local tr = idx == -1 and api.GetMasterTrack(0) or api.GetTrack(0, idx)
  if not tr then return nil end
  if idx == -1 then return tr, "Master" end
  local _, name = api.GetTrackName(tr)
  return tr, name or ("Track " .. (idx + 1))
end

-- Track properties: [info key, scale] (db = volume in dB, pan = −1..1, bool = on/off)
local TRACK_PROPS = {
  volume = { "D_VOL", "db" }, pan = { "D_PAN", "pan" }, mute = { "B_MUTE", "bool" },
  solo = { "I_SOLO", "bool" }, recordArm = { "I_RECARM", "bool" }, phase = { "B_PHASE", "bool" },
}

local function track_targets(params, cmd_type)
  local out = {}
  if cmd_type == "set_track_property" then
    out[1] = { track = params.trackIndex, prop = params.property }
  else
    for _, t in ipairs(decode_param_list(params.tracks) or {}) do
      for prop in pairs(TRACK_PROPS) do
        if t[prop] ~= nil and #out < EDIT_MAX_ROWS then out[#out + 1] = { track = t.trackIndex, prop = prop } end
      end
    end
  end
  return out
end

local function read_track_values(targets)
  local out = {}
  for i, t in ipairs(targets) do
    local spec = TRACK_PROPS[t.prop]
    local tr, name = track_named(t.track)
    if spec and tr then
      local v = api.GetMediaTrackInfo_Value(tr, spec[1])
      if spec[2] == "db" then v = ctx.to_db(v) elseif spec[2] == "bool" then v = v ~= 0 and 1 or 0 end
      out[i] = { t = name, p = t.prop, v = round2(v) or -150, s = spec[2] }
    end
  end
  return out
end

local function fx_targets(params, cmd_type)
  if cmd_type == "set_fx_parameter" then return { { track = params.trackIndex, fx = params.fxIndex, param = params.paramIndex } } end
  local out = {}
  for _, u in ipairs(decode_param_list(params.updates) or {}) do
    if #out < EDIT_MAX_ROWS then out[#out + 1] = { track = u.trackIndex, fx = u.fxIndex, param = u.paramIndex } end
  end
  return out
end

local function read_fx_values(targets)
  local out = {}
  for i, t in ipairs(targets) do
    local tr, name = track_named(t.track)
    local fx, p = tonumber(t.fx), tonumber(t.param)
    if tr and fx and p then
      local _, fx_name = api.TrackFX_GetFXName(tr, fx)
      local _, p_name = api.TrackFX_GetParamName(tr, fx, p)
      local _, text = api.TrackFX_GetFormattedParamValue(tr, fx, p)
      out[i] = {
        t = name .. " · " .. (fx_name or ("FX " .. (fx + 1))), p = p_name or ("Param " .. (p + 1)),
        v = round3(api.TrackFX_GetParamNormalized(tr, fx, p)), x = text, s = "norm",
      }
    end
  end
  return out
end

-- Rows of before → after for the same targets
local function change_rows(before, after)
  local rows = {}
  for i, b in pairs(after) do
    local a = before and before[i]
    rows[#rows + 1] = { i = i, t = b.t, p = b.p, s = b.s, a = a and a.v, b = b.v, at = a and a.x, bt = b.x }
  end
  table.sort(rows, function(x, y) return x.i < y.i end)
  for _, r in ipairs(rows) do r.i = nil end
  return { rows = rows }
end

-- Envelopes: values in the unit the envelope reads in
local function env_of(params)
  local tr = api.GetTrack(0, tonumber(params.trackIndex) or -2)
  local ei = tonumber(params.envelopeIndex)
  if not tr or not ei then return nil end
  return api.GetTrackEnvelope(tr, ei)
end

local function env_unit(env)
  local _, name = api.GetEnvelopeName(env)
  local n = (name or ""):lower()
  if n:find("volume") then return name, "dB" end
  if n:find("pan") or n:find("width") then return name, "pan" end
  if n:find("mute") then return name, "mute" end
  return name, "raw"
end

local function env_points(env)
  local _, unit = env_unit(env)
  local mode = api.GetEnvelopeScalingMode and api.GetEnvelopeScalingMode(env) or 0
  local pts = {}
  for i = 0, api.CountEnvelopePoints(env) - 1 do
    local _, time, value, shape = api.GetEnvelopePoint(env, i)
    local v = value
    if unit == "dB" then
      local amp = api.ScaleFromEnvelopeMode and api.ScaleFromEnvelopeMode(mode, value) or value
      v = amp > 0 and 20 * math.log(amp, 10) or -150
    end
    pts[#pts + 1] = { round3(time) or 0, round2(v) or 0, shape or 0 }
  end
  return pts
end

-- The points inside [from, to] plus one on each side, so the curve reaches the edges
local function points_in(pts, from, to)
  local first, last
  for i, p in ipairs(pts) do
    if p[1] >= from and p[1] <= to then first = first or i; last = i end
  end
  if not first then
    for i, p in ipairs(pts) do if p[1] < from then first = i end end
    first = first or 1
    last = math.min(#pts, first + 1)
  end
  local out = {}
  for i = math.max(1, first - 1), math.min(#pts, last + 1) do
    if #out < EDIT_MAX_POINTS then out[#out + 1] = pts[i] end
  end
  return out
end

local function envelope_view(cmd_type, params, data, before)
  local env = env_of(params)
  if not env then return nil end
  local name, unit = env_unit(env)
  local after = env_points(env)
  local from, to
  local function span(t) if t then from = math.min(from or t, t); to = math.max(to or t, t) end end
  if cmd_type == "insert_envelope_point" then span(tonumber(params.time))
  elseif cmd_type == "insert_envelope_points" then
    for _, p in ipairs(decode_param_list(params.points) or {}) do span(tonumber(p.time)) end
  elseif cmd_type == "remove_envelope_points" then span(tonumber(params.timeStart)); span(tonumber(params.timeEnd))
  elseif cmd_type == "delete_envelope_point" then
    local p = before and before[(tonumber(params.pointIndex) or -1) + 1]
    span(p and p[1])
  elseif type(data) == "table" and type(data.points) == "table" then
    for _, p in ipairs(data.points) do span(p.time) end
  end
  if not from then
    for _, p in ipairs(after) do span(p[1]) end
    for _, p in ipairs(before or {}) do span(p[1]) end
  end
  from, to = from or 0, to or 0
  local pad = math.max(to - from, 4) * 0.25
  from, to = math.max(0, from - pad), to + pad
  local r = { env = name, unit = unit, from = round2(from), to = round2(to), pts = points_in(after, from, to), count = #after }
  if before then r.was = points_in(before, from, to) end
  return r
end

-- MIDI: notes as [pitch, start, length, velocity, flag] in beats from the item start; flag 1 = new or changed
local function midi_notes(params)
  local ok, data = pcall(ctx.get_midi_notes, { trackIndex = params.trackIndex, itemIndex = params.itemIndex })
  if not ok or type(data) ~= "table" or type(data.notes) ~= "table" then return nil end
  local notes = {}
  for _, n in ipairs(data.notes) do
    notes[#notes + 1] = { n.pitch, round3(n.startPosition) or 0, round3(n.duration) or 0, n.velocity }
  end
  return notes
end

local function note_key(n) return n[1] .. ":" .. n[2] .. ":" .. n[3] .. ":" .. n[4] end

local function midi_view(params, before)
  local after = midi_notes(params)
  if not after then return nil end
  local _, item = ctx.get_midi_take(params)
  local r = { total = #after }
  if item then
    local pos = api.GetMediaItemInfo_Value(item, "D_POSITION")
    local len = api.GetMediaItemInfo_Value(item, "D_LENGTH")
    r.beats = round3(api.TimeMap2_timeToQN(0, pos + len) - api.TimeMap2_timeToQN(0, pos))
    local num, den = api.TimeMap_GetTimeSigAtTime(0, pos)
    r.ts = { num or 4, den or 4 }
  end
  local had = {}
  for _, n in ipairs(before or {}) do had[note_key(n)] = true end
  local has = {}
  r.notes = {}
  for _, n in ipairs(after) do
    has[note_key(n)] = true
    if #r.notes < EDIT_MAX_NOTES then
      r.notes[#r.notes + 1] = { n[1], n[2], n[3], n[4], (before and not had[note_key(n)]) and 1 or 0 }
    end
  end
  r.more = #after - #r.notes
  if before then
    r.gone = {}
    for _, n in ipairs(before) do
      if not has[note_key(n)] and #r.gone < EDIT_MAX_ROWS then r.gone[#r.gone + 1] = n end
    end
  end
  return r
end

-- MIDI CC as an automation lane: one controller's values (0-127) over the item, in beats, held until the next event.
-- The controller is the call's ccNumber, the deleted event's, or the item's busiest one.
local CC_NAMES = { [1] = "Mod wheel", [2] = "Breath", [4] = "Foot", [7] = "Volume", [10] = "Pan", [11] = "Expression", [64] = "Sustain", [74] = "Brightness" }
local CC_COMMANDS = { get_midi_cc = true, insert_midi_cc = true, delete_midi_cc = true }

local function cc_events(params)
  if not ctx.get_midi_cc then return nil end
  local ok, data = pcall(ctx.get_midi_cc, { trackIndex = params.trackIndex, itemIndex = params.itemIndex })
  if not ok or type(data) ~= "table" or type(data.events) ~= "table" then return nil end
  return data.events
end

local function cc_view(cmd_type, params, before)
  local events = cc_events(params) or {}
  local cc = tonumber(params.ccNumber)
  if not cc and cmd_type == "delete_midi_cc" then
    for _, e in ipairs(before or {}) do if e.ccIndex == tonumber(params.ccIndex) then cc = e.ccNumber end end
  end
  if not cc then
    local counts, best = {}, 0
    for _, e in ipairs(events) do
      counts[e.ccNumber] = (counts[e.ccNumber] or 0) + 1
      if counts[e.ccNumber] > best then best, cc = counts[e.ccNumber], e.ccNumber end
    end
  end
  if not cc then return nil end
  local function lane(list)
    local pts = {}
    for _, e in ipairs(list or {}) do
      if e.ccNumber == cc and #pts < EDIT_MAX_POINTS then pts[#pts + 1] = { round3(e.position) or 0, e.value, 1 } end
    end
    table.sort(pts, function(a, b) return a[1] < b[1] end)
    return pts
  end
  local pts, was = lane(events), before and lane(before) or nil
  local from, to = 0, 4
  for _, p in ipairs(pts) do to = math.max(to, p[1]) end
  for _, p in ipairs(was or {}) do to = math.max(to, p[1]) end
  local name = "CC " .. cc .. (CC_NAMES[cc] and (" · " .. CC_NAMES[cc]) or "")
  local others = {}
  for _, e in ipairs(events) do if e.ccNumber ~= cc then others[e.ccNumber] = true end end
  local more = 0
  for _ in pairs(others) do more = more + 1 end
  local r = { env = name, unit = "cc", beats = 1, from = 0, to = round2(math.ceil(to + 1)), pts = pts, count = #pts }
  if more > 0 then r.otherCcs = more end
  if before then r.was = was end
  return r
end

local function midi_stats_view(data)
  if type(data) ~= "table" or type(data.pitchStats) ~= "table" then return nil end
  local gun = {}
  for _, g in ipairs(data.machineGunWarnings or {}) do gun[g.pitch] = g.maxConsecutive end
  local pitches = {}
  for _, p in ipairs(data.pitchStats) do
    if #pitches < EDIT_MAX_ROWS then
      pitches[#pitches + 1] = { p.pitch, p.count, p.minVelocity, p.maxVelocity, p.avgVelocity, gun[p.pitch] or 0 }
    end
  end
  return { total = data.totalNotes, beats = data.durationBeats, pitches = pitches, hist = data.velocityHistogram }
end

-- Timeline: regions [start, end, name, color, index], markers [pos, name, color, index], tempo [pos, bpm, num, den, linear]
local function hex_color(native)
  native = tonumber(native) or 0
  if native == 0 or not api.ColorFromNative then return "" end
  local r, g, b = api.ColorFromNative(native & 0xFFFFFF)
  return string.format("#%02x%02x%02x", r or 0, g or 0, b or 0)
end

-- A track from an index, "master", a name or "{GUID}" (the same resolution the structure tools use)
local function track_ref(ref)
  if ref == nil then return nil end
  if type(ref) == "number" or (type(ref) == "string" and ref:match("^%-?%d+$")) then
    local tr = track_named(ref)
    if tr then return tr end
  end
  return ctx.resolve_track and ctx.resolve_track(ref) or nil
end

local function name_of(tr)
  if not tr then return nil end
  if api.GetMasterTrack and tr == api.GetMasterTrack(0) then return "Master" end
  local _, name = api.GetTrackName(tr)
  return name or "Track"
end

-- A stable short id for diffing before and after (GUIDs survive moves and renames)
local function short_id(guid)
  return type(guid) == "string" and guid:gsub("[{}]", ""):sub(1, 8) or ""
end

-- FX chain: [name, flags (B bypassed, O offline), id, preset]
local function fx_chain(tr)
  local out = {}
  for i = 0, math.min(api.TrackFX_GetCount(tr) or 0, EDIT_MAX_ROWS) - 1 do
    local _, name = api.TrackFX_GetFXName(tr, i)
    local enabled = not api.TrackFX_GetEnabled or api.TrackFX_GetEnabled(tr, i) ~= false
    local offline = api.TrackFX_GetOffline and api.TrackFX_GetOffline(tr, i) == true
    local preset = ""
    if api.TrackFX_GetPreset then
      local _, p = api.TrackFX_GetPreset(tr, i)
      preset = type(p) == "string" and p or ""
    end
    out[#out + 1] = { name or ("FX " .. (i + 1)), (enabled and "" or "B") .. (offline and "O" or ""), short_id(api.TrackFX_GetFXGUID(tr, i)), preset }
  end
  return out
end

local FX_CHAIN_COMMANDS = {
  add_fx = true, remove_fx = true, move_fx = true, copy_fx = true, set_fx_enabled = true, set_fx_offline = true,
  setup_fx_chain = true, load_fx_chain = true, rename_fx = true, set_fx_preset = true, get_track_properties = true,
}

-- The tracks an FX command touches: its track, and the other track of a move/copy
local function fx_tracks(params)
  local out = {}
  for _, ref in ipairs({ params.trackIndex, params.toTrackIndex }) do
    local tr = track_ref(ref)
    if tr and #out < 2 and (out[1] == nil or out[1] ~= tr) then out[#out + 1] = tr end
  end
  return out
end

local function fx_chains(params)
  local out = {}
  for i, tr in ipairs(fx_tracks(params)) do out[i] = fx_chain(tr) end
  return out
end

local function fx_chain_view(params, before)
  local chains = {}
  for i, tr in ipairs(fx_tracks(params)) do
    chains[i] = { t = name_of(tr), fx = fx_chain(tr), was = before and before[i] or nil }
  end
  return #chains > 0 and { chains = chains } or nil
end

-- Media items of a track, in the timeline's item shape
local function track_items(tr)
  local out = {}
  for i = 0, math.min(api.CountTrackMediaItems(tr) or 0, EDIT_MAX_MARKS) - 1 do
    local it = api.GetTrackMediaItem(tr, i)
    local take = api.GetActiveTake and api.GetActiveTake(it)
    out[#out + 1] = {
      round2(api.GetMediaItemInfo_Value(it, "D_POSITION")) or 0, round2(api.GetMediaItemInfo_Value(it, "D_LENGTH")) or 0,
      round2(api.GetMediaItemInfo_Value(it, "D_FADEINLEN")) or 0, round2(api.GetMediaItemInfo_Value(it, "D_FADEOUTLEN")) or 0,
      (take and api.TakeIsMIDI and api.TakeIsMIDI(take)) and 1 or 0, api.GetMediaItemInfo_Value(it, "B_MUTE") ~= 0 and 1 or 0,
    }
  end
  return out
end

local ITEM_COMMANDS = {
  move_media_item = true, split_media_item = true, trim_media_item = true, delete_media_item = true,
  set_media_item_properties = true, set_media_items_properties = true, set_item_fades = true, insert_audio_file = true,
  list_midi_items = true,
}

-- Up to four tracks an item command touches, by index
local function item_tracks(params)
  local out, seen = {}, {}
  local function add(idx)
    idx = tonumber(idx)
    if idx and not seen[idx] and #out < 4 and api.GetTrack(0, idx) then seen[idx] = true; out[#out + 1] = idx end
  end
  add(params.trackIndex)
  add(params.newTrackIndex)
  for _, it in ipairs(decode_param_list(params.items) or {}) do if type(it) == "table" then add(it.trackIndex) end end
  return out
end

local function item_lanes(params)
  local out = {}
  for i, idx in ipairs(item_tracks(params)) do out[i] = track_items(api.GetTrack(0, idx)) end
  return out
end

-- Time selection [start, end] (nil when empty) and edit cursor
local function time_state()
  local s, e = api.GetSet_LoopTimeRange(false, false, 0, 0, false)
  local sel = (type(s) == "number" and type(e) == "number" and e > s) and { round2(s), round2(e) } or nil
  return { sel = sel, cur = round2(api.GetCursorPosition and api.GetCursorPosition() or 0) or 0 }
end
local TIME_COMMANDS = { set_time_selection = true, get_time_selection = true, set_cursor_position = true }

-- Routing: [kind (s send, r receive, h hardware), other end, volume dB, pan, flags (M muted)]
local function routes_of(tr)
  local out = {}
  for _, cat in ipairs({ { 0, "s" }, { -1, "r" }, { 1, "h" } }) do
    for i = 0, (api.GetTrackNumSends(tr, cat[1]) or 0) - 1 do
      if #out < EDIT_MAX_ROWS then
        local other
        if cat[2] == "h" then
          local dst = math.floor(api.GetTrackSendInfo_Value(tr, 1, i, "I_DSTCHAN") or 0)
          local ch = (dst & 0x3FF) + 1
          other = (dst & 1024) ~= 0 and ("Out " .. ch) or ("Out " .. ch .. "/" .. (ch + 1))
        else
          other = name_of(api.GetTrackSendInfo_Value(tr, cat[1], i, cat[2] == "s" and "P_DESTTRACK" or "P_SRCTRACK")) or "?"
        end
        out[#out + 1] = {
          cat[2], other, round2(ctx.to_db(api.GetTrackSendInfo_Value(tr, cat[1], i, "D_VOL"))) or -150,
          round2(api.GetTrackSendInfo_Value(tr, cat[1], i, "D_PAN")) or 0,
          api.GetTrackSendInfo_Value(tr, cat[1], i, "B_MUTE") ~= 0 and "M" or "",
        }
      end
    end
  end
  return out
end

local ROUTING_COMMANDS = { get_track_routing = true, add_send = true, set_send = true, remove_send = true, add_hardware_output = true }
local function routing_track(params)
  return track_ref(params.trackIndex) or track_ref(params.track) or track_ref(params.from)
end

-- Structure edits redraw the mixer with the ids before and after, so the page can mark added, removed and moved tracks
local STRUCTURE_COMMANDS = { add_track = true, delete_track = true, move_track = true, set_track_folder = true, set_track_info = true }

-- get_fx_parameters: the first parameters of the FX as bars with the plugin's readout
local function fx_param_rows(params)
  local tr = track_ref(params.trackIndex)
  local fx = tonumber(params.fxIndex)
  if not tr or not fx or not api.TrackFX_GetNumParams then return nil end
  local n = api.TrackFX_GetNumParams(tr, fx) or 0
  local _, fx_name = api.TrackFX_GetFXName(tr, fx)
  local rows = {}
  for p = 0, math.min(n, EDIT_MAX_ROWS) - 1 do
    local _, p_name = api.TrackFX_GetParamName(tr, fx, p)
    local _, text = api.TrackFX_GetFormattedParamValue(tr, fx, p)
    rows[#rows + 1] = { t = fx_name or ("FX " .. (fx + 1)), p = p_name or ("Param " .. (p + 1)), s = "norm", b = round3(api.TrackFX_GetParamNormalized(tr, fx, p)), bt = text }
  end
  return { rows = rows, more = math.max(0, n - #rows) }
end

local function timeline_snapshot()
  local regions, markers, tempo = {}, {}, {}
  local _, nm, nr = api.CountProjectMarkers(0)
  for i = 0, (nm or 0) + (nr or 0) - 1 do
    local _, isrgn, pos, rend, name, idx, color = api.EnumProjectMarkers3(0, i)
    if isrgn and #regions < EDIT_MAX_MARKS then
      regions[#regions + 1] = { round2(pos) or 0, round2(rend) or 0, name or "", hex_color(color), idx }
    elseif not isrgn and #markers < EDIT_MAX_MARKS then
      markers[#markers + 1] = { round2(pos) or 0, name or "", hex_color(color), idx }
    end
  end
  for i = 0, (api.CountTempoTimeSigMarkers(0) or 0) - 1 do
    local _, pos, _, _, bpm, num, den, lin = api.GetTempoTimeSigMarker(0, i)
    if #tempo < EDIT_MAX_MARKS then tempo[#tempo + 1] = { round2(pos) or 0, round2(bpm) or 0, num or -1, den or -1, lin and 1 or 0 } end
  end
  if #tempo == 0 then
    local num, den = api.TimeMap_GetTimeSigAtTime(0, 0)
    tempo[1] = { 0, round2(api.Master_GetTempo()) or 120, num or 4, den or 4, 0 }
  end
  return { regions = regions, markers = markers, tempo = tempo }
end

local function project_length(t, items)
  local len = api.GetProjectLength and api.GetProjectLength(0) or 0
  for _, r in ipairs(t.regions) do len = math.max(len, r[2]) end
  for _, m in ipairs(t.markers) do len = math.max(len, m[1]) end
  for _, m in ipairs(t.tempo) do len = math.max(len, m[1]) end
  for _, it in ipairs(items or {}) do len = math.max(len, it[1] + it[2]) end
  return round2(len) or 0
end

local function timeline_view(cmd_type, data, before)
  local r = timeline_snapshot()
  if cmd_type == "list_media_items" and type(data) == "table" and type(data.items) == "table" then
    r.items = {}
    for _, it in ipairs(data.items) do
      if #r.items < EDIT_MAX_MARKS then
        r.items[#r.items + 1] = {
          round2(it.position) or 0, round2(it.length) or 0, round2(it.fadeInLength) or 0, round2(it.fadeOutLength) or 0,
          it.isMidi and 1 or 0, it.muted and 1 or 0,
        }
      end
    end
  end
  r.len = project_length(r, r.items)
  if before then
    r.was = before
    r.len = math.max(r.len, project_length(before))
  end
  return r
end

-- Item edits: the timeline with one lane per touched track, each with its items before the edit
local function item_view(params, before)
  local r = timeline_snapshot()
  r.lanes = {}
  local all = {}
  for i, idx in ipairs(item_tracks(params)) do
    local tr = api.GetTrack(0, idx)
    local lane = { t = name_of(tr), items = track_items(tr), was = before and before[i] or nil }
    r.lanes[i] = lane
    for _, it in ipairs(lane.items) do all[#all + 1] = it end
    for _, it in ipairs(lane.was or {}) do all[#all + 1] = it end
  end
  r.len = project_length(r, all)
  return r
end

-- Time selection and cursor on the timeline, with where they were before a write
local function time_view(before)
  local r = timeline_snapshot()
  local now = time_state()
  r.sel, r.cur = now.sel, now.cur
  if before then r.wasSel, r.wasCur = before.sel, before.cur end
  local len = project_length(r)
  for _, v in ipairs({ r.cur, r.wasCur, r.sel and r.sel[2], r.wasSel and r.wasSel[2] }) do len = math.max(len, v or 0) end
  r.len = round2(len) or 0
  return r
end

-- Mixer: [name, indent, color, volume dB, pan, flags]; flags M mute, S solo, R armed, F folder
local function mixer_row(tr, name, indent)
  local flags = (api.GetMediaTrackInfo_Value(tr, "B_MUTE") ~= 0 and "M" or "")
    .. (api.GetMediaTrackInfo_Value(tr, "I_SOLO") ~= 0 and "S" or "")
    .. (api.GetMediaTrackInfo_Value(tr, "I_RECARM") ~= 0 and "R" or "")
    .. (api.GetMediaTrackInfo_Value(tr, "I_FOLDERDEPTH") == 1 and "F" or "")
  local color = api.GetMediaTrackInfo_Value(tr, "I_CUSTOMCOLOR")
  return {
    name, indent, (color and color & 0x1000000 ~= 0) and hex_color(color) or "",
    round2(ctx.to_db(api.GetMediaTrackInfo_Value(tr, "D_VOL"))) or -150, round2(api.GetMediaTrackInfo_Value(tr, "D_PAN")) or 0, flags,
  }
end

-- Every track's row and id, with folder indent (structure edits diff the whole project)
local function mixer_all()
  local rows, ids, level = {}, {}, 0
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    local _, name = api.GetTrackName(tr)
    rows[#rows + 1] = mixer_row(tr, name or ("Track " .. (i + 1)), level)
    ids[#ids + 1] = short_id(api.GetTrackGUID(tr))
    level = math.max(0, level + (api.GetMediaTrackInfo_Value(tr, "I_FOLDERDEPTH") or 0))
  end
  return rows, ids
end

local function same_row(a, b)
  if not a or not b or #a ~= #b then return false end
  for k = 1, #a do if a[k] ~= b[k] then return false end end
  return true
end

local function slice(list, from, count)
  local out = {}
  for k = from + 1, math.min(#list, from + count) do out[#out + 1] = list[k] end
  return out
end

local function mixer_view(before)
  local rows, ids = mixer_all()
  local r = { total = #rows }
  local master = api.GetMasterTrack(0)
  if master then r.master = mixer_row(master, "Master", 0) end
  local from = 0
  if before then
    -- A big project only fits a window of rows: start it just above the first row that differs
    local first = 1
    while first <= math.max(#ids, #before.ids)
      and ids[first] == before.ids[first] and same_row(rows[first], before.tracks[first]) do
      first = first + 1
    end
    if math.max(#rows, #before.tracks) > EDIT_MAX_MARKS then from = math.max(0, first - 1 - 4) end
    r.ids = slice(ids, from, EDIT_MAX_MARKS)
    r.was = { tracks = slice(before.tracks, from, EDIT_MAX_MARKS), ids = slice(before.ids, from, EDIT_MAX_MARKS) }
    if from > 0 then r.from = from end
  end
  r.tracks = slice(rows, from, EDIT_MAX_MARKS)
  return r
end

-- run_plan: the ops in order, as [op, what]
local function plan_view(params, data)
  local ops = decode_param_list(params.ops)
  if type(ops) ~= "table" then return nil end
  local rows = {}
  for _, op in ipairs(ops) do
    if #rows < EDIT_MAX_ROWS and type(op) == "table" then
      local target = op.track or op.to or op.target or op.name or ""
      local what = tostring(target)
      if op.fxName or op.fx then what = what .. " · " .. tostring(op.fxName or op.fx) end
      if op.from then what = tostring(op.from) .. " → " .. what end
      if op.action then what = tostring(op.action) end
      rows[#rows + 1] = { tostring(op.op or "?"), what }
    end
  end
  return { ops = rows, total = #ops, dryRun = params.dryRun == true or nil, applied = type(data) == "table" and data.applied or nil }
end

local TIMELINE_WRITES = {
  add_marker = true, add_region = true, edit_marker = true, edit_region = true, delete_marker = true, delete_region = true,
  add_tempo_marker = true, edit_tempo_marker = true, delete_tempo_marker = true, set_project_tempo = true,
}
local ENVELOPE_WRITES = {
  insert_envelope_point = true, insert_envelope_points = true, delete_envelope_point = true,
  remove_envelope_points = true, clear_envelope = true,
}
local MIDI_WRITES = { insert_midi_note = true, insert_midi_notes = true, edit_midi_note = true, edit_midi_notes = true, delete_midi_note = true }

-- Measurements: numbers rounded to 0.01 so the feed stays small
local SPECTRUM_BANDS = 48
local RESULT_FIELDS = {
  read_track_meters = { "peakL", "peakR", "rmsL", "rmsR" },
  read_track_lufs = { "integrated", "shortTerm", "momentary", "truePeakL", "truePeakR", "duration" },
  read_track_correlation = { "correlation", "stereoWidth", "midLevel", "sideLevel" },
  read_track_crest = { "crestFactor", "peakLevel", "rmsLevel" },
  read_track_spectrum = { "sampleRate", "fftSize", "peakDb", "rmsDb" },
  render_track_to_wav = { "durationSeconds", "sampleRate" },
}

-- Loudest bin per log-spaced band from 20 Hz to 20 kHz; a band narrower than one bin takes the bin it falls in
local function spectrum_bands(data)
  local bins, res = data.bins, data.frequencyResolution
  if type(bins) ~= "table" or #bins == 0 or type(res) ~= "number" or res <= 0 then return nil end
  local bands = {}
  for b = 0, SPECTRUM_BANDS - 1 do
    local f0 = 20 * 1000 ^ (b / SPECTRUM_BANDS)
    local f1 = 20 * 1000 ^ ((b + 1) / SPECTRUM_BANDS)
    local i0 = math.max(1, math.floor(f0 / res) + 1)
    local i1 = math.min(#bins, math.max(i0, math.ceil(f1 / res)))
    local top
    for i = i0, i1 do
      local v = bins[i]
      if type(v) == "number" and (top == nil or v > top) then top = v end
    end
    bands[#bands + 1] = round2(top) or -150
  end
  return bands
end

-- Min/max per slice of a rendered WAV (all channels), read while the file still exists: the server deletes it
-- once it has the response, and the log entry is recorded before the response is written
local WAVE_BUCKETS = 120
local WAVE_MAX_SAMPLES = 2000000 -- longer renders are read with a stride
local WAV_SAMPLE = { [1] = { [16] = { "<i2", 32768 }, [24] = { "<i3", 8388608 }, [32] = { "<i4", 2147483648 } },
                     [3] = { [32] = { "<f", 1 }, [64] = { "<d", 1 } } }

local function wav_waveform(path)
  if type(path) ~= "string" then return nil end
  local f = io.open(path, "rb")
  if not f then return nil end
  local s = f:read("a")
  f:close()
  if not s or #s < 44 or s:sub(1, 4) ~= "RIFF" or s:sub(9, 12) ~= "WAVE" then return nil end
  local pos, tag, channels, bits, data_pos, data_len = 13
  while pos + 8 <= #s do
    local id, len = s:sub(pos, pos + 3), string.unpack("<I4", s, pos + 4)
    if id == "fmt " and len >= 16 then
      tag, channels = string.unpack("<I2I2", s, pos + 8)
      bits = string.unpack("<I2", s, pos + 22)
      if tag == 0xFFFE and len >= 26 then tag = string.unpack("<I2", s, pos + 32) end -- WAVE_FORMAT_EXTENSIBLE
    elseif id == "data" then
      data_pos, data_len = pos + 8, math.min(len, #s - pos - 7)
      break
    end
    pos = pos + 8 + len + (len % 2)
  end
  local spec = tag and WAV_SAMPLE[tag] and WAV_SAMPLE[tag][bits]
  if not spec or not data_pos or not channels or channels < 1 then return nil end
  local fmt, scale, width = spec[1], spec[2], bits // 8
  local frame_bytes = width * channels
  local frames = data_len // frame_bytes
  if frames < 1 then return nil end
  local stride = math.max(1, math.ceil(frames * channels / WAVE_MAX_SAMPLES))
  local hi, lo = {}, {}
  for b = 1, WAVE_BUCKETS do hi[b], lo[b] = 0, 0 end
  local peak, sum, count, clipped = 0, 0, 0, 0
  for fr = 0, frames - 1, stride do
    local b = fr * WAVE_BUCKETS // frames + 1
    local at = data_pos + fr * frame_bytes
    for _ = 1, channels do
      local v = string.unpack(fmt, s, at) / scale
      at = at + width
      if v > hi[b] then hi[b] = v end
      if v < lo[b] then lo[b] = v end
      local a = math.abs(v)
      if a > peak then peak = a end
      if a >= 0.999 then clipped = clipped + 1 end
      sum = sum + v * v
      count = count + 1
    end
  end
  for b = 1, WAVE_BUCKETS do hi[b], lo[b] = round2(hi[b]), round2(lo[b]) end
  local db = function(v) return v > 0 and round2(20 * math.log(v, 10)) or -150 end
  return { hi = hi, lo = lo, peakDb = db(peak), rmsDb = db(math.sqrt(sum / count)), clipped = clipped, channels = channels }
end

-- The state a write is about to change, read before its handler runs (nil for every other command)
function M.before(cmd_type, params)
  if cmd_type == "set_track_property" or cmd_type == "set_multiple_track_properties" then
    return read_track_values(track_targets(params, cmd_type))
  elseif cmd_type == "set_fx_parameter" or cmd_type == "set_multiple_fx_parameters" then
    return read_fx_values(fx_targets(params, cmd_type))
  elseif ENVELOPE_WRITES[cmd_type] then
    local env = env_of(params)
    return env and env_points(env)
  elseif MIDI_WRITES[cmd_type] then
    return midi_notes(params)
  elseif CC_COMMANDS[cmd_type] and cmd_type ~= "get_midi_cc" then
    return cc_events(params)
  elseif TIMELINE_WRITES[cmd_type] then
    return timeline_snapshot()
  elseif FX_CHAIN_COMMANDS[cmd_type] and cmd_type ~= "get_track_properties" then
    return fx_chains(params)
  elseif ITEM_COMMANDS[cmd_type] and cmd_type ~= "list_midi_items" then
    return item_lanes(params)
  elseif cmd_type == "set_time_selection" or cmd_type == "set_cursor_position" then
    return time_state()
  elseif ROUTING_COMMANDS[cmd_type] and cmd_type ~= "get_track_routing" then
    local tr = routing_track(params)
    return tr and { track = tr, routes = routes_of(tr) }
  elseif STRUCTURE_COMMANDS[cmd_type] then
    local rows, ids = mixer_all()
    return { tracks = rows, ids = ids }
  end
end

-- The entry's `r`: an edit view, a measurement, or nil
function M.summary(cmd_type, params, data, before)
  if cmd_type == "set_track_property" or cmd_type == "set_multiple_track_properties" then
    return change_rows(before, read_track_values(track_targets(params, cmd_type)))
  elseif cmd_type == "set_fx_parameter" or cmd_type == "set_multiple_fx_parameters" then
    return change_rows(before, read_fx_values(fx_targets(params, cmd_type)))
  elseif ENVELOPE_WRITES[cmd_type] or cmd_type == "get_envelope_points" then
    return envelope_view(cmd_type, params, data, before)
  elseif MIDI_WRITES[cmd_type] or cmd_type == "get_midi_notes" then
    return midi_view(params, before)
  elseif cmd_type == "analyze_midi" then
    return midi_stats_view(data)
  elseif CC_COMMANDS[cmd_type] then
    return cc_view(cmd_type, params, before)
  elseif TIMELINE_WRITES[cmd_type] or cmd_type == "list_markers" or cmd_type == "list_regions"
      or cmd_type == "get_tempo_map" or cmd_type == "list_media_items" then
    return timeline_view(cmd_type, data, before)
  elseif cmd_type == "list_tracks" or STRUCTURE_COMMANDS[cmd_type] then
    return mixer_view(before)
  elseif FX_CHAIN_COMMANDS[cmd_type] then
    return fx_chain_view(params, before)
  elseif ITEM_COMMANDS[cmd_type] then
    return item_view(params, before)
  elseif TIME_COMMANDS[cmd_type] then
    return time_view(before)
  elseif ROUTING_COMMANDS[cmd_type] then
    -- A write reads the same track it read before (remove_send can leave nothing to resolve by index)
    local tr = before and before.track or routing_track(params)
    if not tr then return nil end
    return { t = name_of(tr), routes = routes_of(tr), was = before and before.routes or nil }
  elseif cmd_type == "get_fx_parameters" then
    return fx_param_rows(params)
  elseif cmd_type == "run_plan" then
    return plan_view(params, data)
  end
  local fields = RESULT_FIELDS[cmd_type]
  if not fields or type(data) ~= "table" then return nil end
  local r = {}
  for _, k in ipairs(fields) do r[k] = round2(data[k]) end
  if cmd_type == "read_track_spectrum" then r.bands = spectrum_bands(data) end
  if cmd_type == "render_track_to_wav" then
    local ok, wave = pcall(wav_waveform, data.wavPath)
    if ok and wave then for k, v in pairs(wave) do r[k] = v end end
  end
  return r
end

return M
