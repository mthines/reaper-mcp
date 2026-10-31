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

-- Automation items as blocks [position, length, pool id, pool name] plus each pool's points
-- ([time from the item start, value, shape]) once, so pooled items draw the same curve.
local EDIT_MAX_ITEMS = 32
local AUTOMATION_ITEM_COMMANDS = {
  list_automation_items = true, insert_automation_item = true, set_automation_item = true, delete_automation_item = true,
}
local POOL_POINTS = 0x10000000
local function env_items(env)
  if not api.CountAutomationItems then return nil end
  local n = tonumber((api.CountAutomationItems(env))) or 0
  if n == 0 then return nil end
  local _, unit = env_unit(env)
  local mode = api.GetEnvelopeScalingMode and api.GetEnvelopeScalingMode(env) or 0
  local blocks, pools, seen = {}, {}, {}
  for i = 0, math.min(n, EDIT_MAX_ITEMS) - 1 do
    local function info(parm) return api.GetSetAutomationItemInfo(env, i, parm, 0, false) end
    local pos, pool = info("D_POSITION"), math.floor(info("D_POOL_ID") + 0.5)
    local _, name = api.GetSetAutomationItemInfo_String(env, i, "P_POOL_NAME", "", false)
    blocks[#blocks + 1] = { round3(pos) or 0, round3(info("D_LENGTH")) or 0, pool, name or "" }
    if not seen[pool] then
      seen[pool] = true
      local pts = {}
      for k = 0, math.min(api.CountEnvelopePointsEx(env, i | POOL_POINTS), EDIT_MAX_POINTS) - 1 do
        local _, time, value, shape = api.GetEnvelopePointEx(env, i | POOL_POINTS, k)
        local v = value
        if unit == "dB" then
          local amp = api.ScaleFromEnvelopeMode and api.ScaleFromEnvelopeMode(mode, value) or value
          v = amp > 0 and 20 * math.log(amp, 10) or -150
        end
        pts[#pts + 1] = { round3(time - pos) or 0, round2(v) or 0, shape or 0 }
      end
      pools[#pools + 1] = { pool, pts }
    end
  end
  return { items = blocks, pools = pools, more = math.max(0, n - EDIT_MAX_ITEMS) }
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
    -- The handler returns the point it deleted (also one inside an automation item)
    local gone = type(data) == "table" and type(data.deleted) == "table" and data.deleted.time
    local p = before and before[(tonumber(params.pointIndex) or -1) + 1]
    span(tonumber(gone) or (p and p[1]))
  elseif type(data) == "table" and type(data.points) == "table" then
    for _, p in ipairs(data.points) do span(p.time) end
  end
  -- Automation items: the item a call touched (before and after a move), or every item for a listing
  local items = env_items(env)
  local was_items = type(before) == "table" and before.items or nil
  local touched = tonumber(params.automationItemIndex)
  if type(data) == "table" and type(data.automationItem) == "table" then touched = data.automationItem.index end
  if cmd_type == "delete_automation_item" then touched = nil end
  local function span_block(b) if b then span(b[1]); span(b[1] + b[2]) end end
  if AUTOMATION_ITEM_COMMANDS[cmd_type] or touched then
    if touched and items then span_block(items.items[touched + 1]) end
    if was_items and params.automationItemIndex ~= nil then span_block(was_items.items[(tonumber(params.automationItemIndex) or -1) + 1]) end
    if not from then
      for _, b in ipairs(items and items.items or {}) do span_block(b) end
      for _, b in ipairs(was_items and was_items.items or {}) do span_block(b) end
    end
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
  if items then
    r.ais, r.pools = items.items, items.pools
    if items.more > 0 then r.aisMore = items.more end
    if touched then r.ai = touched end
  end
  if was_items and cmd_type ~= "list_automation_items" then r.wasAis, r.wasPools = was_items.items, was_items.pools end
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

-- Media items of a track, in the timeline's item shape; `gain` adds the item's gain in dB
local function track_items(tr, gain)
  local out = {}
  for i = 0, math.min(api.CountTrackMediaItems(tr) or 0, EDIT_MAX_MARKS) - 1 do
    local it = api.GetTrackMediaItem(tr, i)
    local take = api.GetActiveTake and api.GetActiveTake(it)
    out[#out + 1] = {
      round2(api.GetMediaItemInfo_Value(it, "D_POSITION")) or 0, round2(api.GetMediaItemInfo_Value(it, "D_LENGTH")) or 0,
      round2(api.GetMediaItemInfo_Value(it, "D_FADEINLEN")) or 0, round2(api.GetMediaItemInfo_Value(it, "D_FADEOUTLEN")) or 0,
      (take and api.TakeIsMIDI and api.TakeIsMIDI(take)) and 1 or 0, api.GetMediaItemInfo_Value(it, "B_MUTE") ~= 0 and 1 or 0,
    }
    if gain then
      local v = api.GetMediaItemInfo_Value(it, "D_VOL") or 1
      out[#out][7] = v > 0 and round2(20 * math.log(v, 10)) or -150
    end
  end
  return out
end

local ITEM_COMMANDS = {
  move_media_item = true, split_media_item = true, trim_media_item = true, delete_media_item = true,
  set_media_item_properties = true, set_media_items_properties = true, set_item_fades = true, insert_audio_file = true,
  list_midi_items = true,
}

-- The first four tracks the items are on (one lane each), and how many tracks that is in all
local function item_tracks(params)
  local out, seen, n = {}, {}, 0
  local function add(idx)
    idx = tonumber(idx)
    if idx and not seen[idx] and api.GetTrack(0, idx) then
      seen[idx] = true
      n = n + 1
      if #out < 4 then out[#out + 1] = idx end
    end
  end
  add(params.trackIndex)
  add(params.newTrackIndex)
  for _, it in ipairs(decode_param_list(params.items) or {}) do if type(it) == "table" then add(it.trackIndex) end end
  return out, n
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

-- Arrangement edits: the whole timeline before and after, a lane for up to four tracks the
-- edit touches, and the span it worked on (copied from, opened, cut) and where it copied to
local ARRANGE = {}
ARRANGE.OPS = { copy_media_items = "copy", insert_time = "insert", remove_time = "remove", copy_section = "section" }

-- The section a copy_section call copies, from a region index or start/end
function ARRANGE.section(params)
  local idx = tonumber(params.regionIndex)
  if idx == nil then return tonumber(params.start), tonumber(params["end"]) end
  local _, nm, nr = api.CountProjectMarkers(0)
  for i = 0, (nm or 0) + (nr or 0) - 1 do
    local _, isrgn, pos, rend, _, num = api.EnumProjectMarkers3(0, i)
    if isrgn and num == idx then return pos, rend end
  end
end

-- Track indexes for the lanes (at most four) and how many tracks the edit touches
function ARRANGE.tracks(cmd_type, params)
  if cmd_type == "copy_media_items" or cmd_type == "process_items" then
    return item_tracks(params)
  end
  local only = cmd_type == "copy_section" and decode_param_list(params.tracks)
  local s, e
  if cmd_type == "insert_time" then s, e = tonumber(params.position), math.huge
  elseif cmd_type == "remove_time" then s, e = tonumber(params.start), math.huge
  else s, e = ARRANGE.section(params) end
  if not s or not e then return {}, 0 end
  local out, n = {}, 0
  local function consider(t)
    local tr = api.GetTrack(0, t)
    if not tr then return end
    for i = 0, (api.CountTrackMediaItems(tr) or 0) - 1 do
      local it = api.GetTrackMediaItem(tr, i)
      local pos = api.GetMediaItemInfo_Value(it, "D_POSITION")
      if pos < e and pos + api.GetMediaItemInfo_Value(it, "D_LENGTH") > s then
        n = n + 1
        if #out < 4 then out[#out + 1] = t end
        return
      end
    end
  end
  if type(only) == "table" then
    for _, t in ipairs(only) do if tonumber(t) then consider(tonumber(t)) end end
  else
    for t = 0, (api.CountTracks(0) or 0) - 1 do consider(t) end
  end
  return out, n
end

function ARRANGE.before(cmd_type, params)
  local idx, n = ARRANGE.tracks(cmd_type, params)
  local gain = cmd_type == "process_items" and params.operation == "normalize"
  local b = { idx = idx, n = n, tl = timeline_snapshot(), lanes = {} }
  for i, t in ipairs(idx) do b.lanes[i] = track_items(api.GetTrack(0, t), gain) end
  if cmd_type == "copy_media_items" then
    -- The sources' span, read before the copies land
    local first, last
    for _, ref in ipairs(decode_param_list(params.items) or {}) do
      local tr = type(ref) == "table" and api.GetTrack(0, tonumber(ref.trackIndex) or -2)
      local it = tr and api.GetTrackMediaItem(tr, tonumber(ref.itemIndex) or -1)
      if it then
        local pos = api.GetMediaItemInfo_Value(it, "D_POSITION")
        first = math.min(first or pos, pos)
        last = math.max(last or pos, pos + api.GetMediaItemInfo_Value(it, "D_LENGTH"))
      end
    end
    if first then b.span = { round2(first), round2(last) } end
  end
  return b
end

function ARRANGE.view(cmd_type, params, data, before)
  if type(before) ~= "table" or type(data) ~= "table" then return nil end
  local r = timeline_snapshot()
  r.was = before.tl
  r.op = ARRANGE.OPS[cmd_type] or params.operation
  local gain = cmd_type == "process_items" and params.operation == "normalize"
  r.lanes = {}
  local all = {}
  for i, t in ipairs(before.idx) do
    local tr = api.GetTrack(0, t)
    if tr then
      local lane = { t = name_of(tr), items = track_items(tr, gain), was = before.lanes[i] }
      r.lanes[#r.lanes + 1] = lane
      for _, it in ipairs(lane.items) do all[#all + 1] = it end
      for _, it in ipairs(lane.was) do all[#all + 1] = it end
    end
  end
  if before.n > #r.lanes then r.moreTracks = before.n - #r.lanes end
  local num = function(v) return tonumber(v) end
  if cmd_type == "insert_time" and num(data.position) and num(data.length) then
    r.span = { data.position, round2(data.position + data.length) }
  elseif cmd_type == "remove_time" and num(data.start) then
    r.span = { data.start, data["end"] }
  elseif cmd_type == "copy_section" and num(data.start) then
    r.span = { data.start, data["end"] }
    -- An insert at or before the section moved it along
    if data.inserted and data.position <= data.start then r.span = { round2(data.start + data.length), round2(data["end"] + data.length) } end
    r.to = { data.position, round2(data.position + data.length) }
  elseif cmd_type == "copy_media_items" then
    r.span = before.span
    local first, last
    for _, c in ipairs(type(data.copies) == "table" and data.copies or {}) do
      first = math.min(first or c.position, c.position)
      last = math.max(last or c.position, c.position + c.length)
    end
    if first then r.to = { round2(first), round2(last) } end
  end
  r.len = math.max(project_length(r, all), project_length(before.tl))
  for _, v in ipairs({ r.span and r.span[2], r.to and r.to[2] }) do r.len = math.max(r.len, v or 0) end
  r.len = round2(r.len) or 0
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
  remove_envelope_points = true, clear_envelope = true, edit_envelope_points = true,
}
local MIDI_WRITES = {
  insert_midi_note = true, insert_midi_notes = true, edit_midi_note = true, edit_midi_notes = true, delete_midi_note = true,
  quantize_midi = true, transform_midi = true,
}

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

-- Mixing depth views: built from the handler's own result, which carries the state before
local MIX = {}

MIX.MODES = { trim = 0, read = 1, touch = 2, write = 3, latch = 4, latch_preview = 5 }

function MIX.automation(data)
  local rows = {}
  for i, t in ipairs(data.tracks or {}) do
    if i > EDIT_MAX_ROWS then break end
    rows[#rows + 1] = { t = t.name, p = "Automation", s = "bool",
      a = MIX.MODES[t.before] or 0, b = MIX.MODES[t.mode] or 0, at = t.before, bt = t.mode }
  end
  if data.globalOverrideBefore then
    rows[#rows + 1] = { t = "All tracks", p = "Global override", s = "bool",
      a = data.globalOverrideBefore == data.globalOverride and 1 or 0, b = 1,
      at = data.globalOverrideBefore, bt = data.globalOverride }
  end
  return { rows = rows }
end

-- One modulated parameter in the page's compact shape (nil when it has none)
function MIX.mod_row(m)
  if type(m) ~= "table" or m.enabled == false then return nil end
  local r = { p = m.name or ("Param " .. tostring(m.paramIndex)), base = round2(m.baseline) or 0, v = round2(m.value) or 0 }
  if m.lfo then
    r.lfo = { m.lfo.shape, round2(m.lfo.speed) or 0, round2(m.lfo.strength) or 0, round2(m.lfo.phase) or 0,
              m.lfo.direction or 1, m.lfo.tempoSync and 1 or 0 }
  end
  if m.audio then
    r.acs = { round2(m.audio.attackMs) or 0, round2(m.audio.releaseMs) or 0, round2(m.audio.minDb) or 0,
              round2(m.audio.maxDb) or 0, round2(m.audio.strength) or 0, m.audio.channel or 1, m.audio.direction or 1 }
  end
  if m.link then
    local src = (m.link.fxName or ("FX " .. tostring(m.link.fxIndex))) .. " / " .. (m.link.paramName or ("param " .. tostring(m.link.paramIndex)))
    r.link = { src, round2(m.link.scale) or 1, round2(m.link.offset) or 0 }
  end
  return r
end

function MIX.modulation(cmd_type, data)
  if type(data) ~= "table" then return nil end
  local rows = {}
  if cmd_type == "set_fx_param_modulation" then
    local now = MIX.mod_row(data.modulation) or { p = (data.before and data.before.name) or ("Param " .. tostring(data.paramIndex)), off = 1 }
    now.was = MIX.mod_row(data.before) or false
    rows[1] = now
  else
    for i, m in ipairs(data.modulated or {}) do
      if i > EDIT_MAX_ROWS then break end
      rows[#rows + 1] = MIX.mod_row(m)
    end
  end
  return { fx = data.fxName or "", rows = rows, total = data.modulated and #data.modulated or nil }
end

function MIX.pin_lists(side)
  local out = {}
  for i, pin in ipairs(side or {}) do
    if i > EDIT_MAX_ROWS then break end
    out[i] = pin.channels or {}
  end
  return out
end

function MIX.pins(data)
  if type(data) ~= "table" or not data.inputs then return nil end
  local r = { fx = data.fxName or "", ch = data.trackChannels or 2, ["in"] = MIX.pin_lists(data.inputs), out = MIX.pin_lists(data.outputs) }
  local names = {}
  for i, pin in ipairs(data.inputs) do if i <= EDIT_MAX_ROWS then names[i] = pin.name or "" end end
  r.names = names
  if data.before then
    r.chWas = data.before.trackChannels
    r.inWas = MIX.pin_lists(data.before.inputs)
    r.outWas = MIX.pin_lists(data.before.outputs)
  end
  return r
end

-- Grid lines inside an item, seconds from its start (at most EDIT_MAX_POINTS)
function MIX.grid_lines(pos, len, grid)
  if not grid or grid <= 0 or not api.TimeMap2_timeToQN then return nil end
  local lines = {}
  local qn = math.ceil(api.TimeMap2_timeToQN(0, pos) / grid - 1e-9) * grid
  while #lines < EDIT_MAX_POINTS do
    local t = api.TimeMap2_QNToTime(0, qn) - pos
    if t > len + 1e-9 then break end
    lines[#lines + 1] = round2(t)
    qn = qn + grid
  end
  return lines
end

function MIX.stretch(cmd_type, data)
  if type(data) ~= "table" then return nil end
  if cmd_type == "quantize_audio" then
    return { len = data.length, moves = data.moves or {}, more = data.more or 0, grid = MIX.grid_lines(data.position or 0, data.length or 0, data.grid),
             off = { data.offsetBefore and data.offsetBefore.avgMs or 0, data.offsetAfter and data.offsetAfter.avgMs or 0 } }
  end
  local marks, was = {}, {}
  for i, m in ipairs(data.markers or {}) do if i <= EDIT_MAX_POINTS then marks[#marks + 1] = m.position end end
  for i, m in ipairs(data.before or {}) do if i <= EDIT_MAX_POINTS then was[#was + 1] = m.position end end
  return { len = data.length, marks = marks, was = was }
end

function MIX.freeze(cmd_type, data)
  if type(data) ~= "table" then return nil end
  local rows = {}
  for i, t in ipairs(data.tracks or {}) do
    if i > EDIT_MAX_ROWS then break end
    local b = t.before or {}
    local label = cmd_type == "freeze_tracks" and ("frozen · " .. tostring(data.mode)) or (t.frozen > 0 and ("frozen · " .. t.frozen .. " layers") or "live")
    rows[#rows + 1] = { t = t.name, p = "Freeze", s = "bool", a = (b.frozen or 0) > 0 and 1 or 0, b = (t.frozen or 0) > 0 and 1 or 0,
      at = (b.frozen or 0) > 0 and "frozen" or "live", bt = label }
    rows[#rows + 1] = { t = t.name, p = "FX", s = "norm", a = math.min(1, (b.fx or 0) / 16), b = math.min(1, (t.fx or 0) / 16),
      at = tostring(b.fx or 0), bt = tostring(t.fx or 0) }
  end
  for i, it in ipairs(data.items or {}) do
    if i > EDIT_MAX_ROWS then break end
    local b = it.before or {}
    rows[#rows + 1] = { t = "Track " .. ((it.trackIndex or 0) + 1) .. " · item " .. ((it.itemIndex or 0) + 1), p = "Active take", s = "norm",
      a = math.min(1, (b.takes or 1) / 8), b = math.min(1, (it.takes or 1) / 8), at = b.activeTake or "", bt = it.activeTake or "" }
  end
  return { rows = rows }
end

function MIX.monitor_slots()
  local m = api.GetMasterTrack(0)
  local out = {}
  if not api.TrackFX_GetRecCount then return out end
  for i = 0, math.min(api.TrackFX_GetRecCount(m), EDIT_MAX_ROWS) - 1 do
    local idx = 0x1000000 + i
    local _, name = api.TrackFX_GetFXName(m, idx)
    local enabled = api.TrackFX_GetEnabled(m, idx) ~= false
    local offline = api.TrackFX_GetOffline and api.TrackFX_GetOffline(m, idx) == true
    out[#out + 1] = { name or ("FX " .. (i + 1)), (enabled and "" or "B") .. (offline and "O" or ""), short_id(api.TrackFX_GetFXGUID(m, idx)), "" }
  end
  return out
end

MIX.MONITOR = { list_monitoring_fx = true, add_monitoring_fx = true, set_monitoring_fx = true, remove_monitoring_fx = true }

-- Render results: one row per file written, with a few waveform slices read through REAPER's peak API
-- (any format REAPER reads). At most RENDER_MAX_FILES files get a row; the rest are counted.
local RENDER_MAX_FILES = 8
-- Waveforms are built on REAPER's main thread after the render already blocked it: once this much
-- time went to them in one call, the remaining files get rows without a waveform
local RENDER_PEAKS_BUDGET_S = 1.0
local RENDER_SLICES = 60

-- The .reapeaks file REAPER would build for path (nil when it cannot say)
local function peak_file(path)
  if not api.GetPeakFileName then return nil end
  local a, b = api.GetPeakFileName(path, "")
  local name = type(b) == "string" and b ~= "" and b or a
  return type(name) == "string" and name ~= "" and name or nil
end
local function exists(path)
  local f = path and io.open(path, "rb")
  if f then f:close() end
  return f ~= nil
end

local function file_peaks(path)
  if not (api.PCM_Source_CreateFromFile and api.PCM_Source_GetPeaks and api.new_array) then return nil end
  local src = api.PCM_Source_CreateFromFile(path)
  if not src then return nil end
  -- Peaks built only for this view are removed again, so no .reapeaks lands beside a delivered file
  local pk = peak_file(path)
  local had_peaks = exists(pk)
  local ok, hi, lo = pcall(function()
    local len = api.GetMediaSourceLength(src)
    if type(len) ~= "number" or len <= 0 then return nil end
    local ch = math.min(2, math.max(1, math.floor(api.GetMediaSourceNumChannels(src) or 1)))
    if api.PCM_Source_BuildPeaks and api.PCM_Source_BuildPeaks(src, 0) ~= 0 then
      local guard = 0
      while api.PCM_Source_BuildPeaks(src, 1) ~= 0 and guard < 1000000 do guard = guard + 1 end
      api.PCM_Source_BuildPeaks(src, 2)
    end
    local n = RENDER_SLICES
    local buf = api.new_array(n * ch * 2)
    -- The buffer holds n * ch maxima, then n * ch minima, channels interleaved
    local got = math.floor(api.PCM_Source_GetPeaks(src, n / len, 0, ch, n, 0, buf)) & 0xFFFFF
    if got <= 0 then return nil end
    local hi, lo = {}, {}
    for i = 0, math.min(got, n) - 1 do
      local mx, mn = 0, 0
      for c = 1, ch do
        local a, b = buf[i * ch + c], buf[n * ch + i * ch + c]
        if a and a > mx then mx = a end
        if b and b < mn then mn = b end
      end
      hi[#hi + 1], lo[#lo + 1] = round2(mx), round2(mn)
    end
    return hi, lo
  end)
  api.PCM_Source_Destroy(src)
  if pk and not had_peaks and exists(pk) then os.remove(pk) end
  if ok and hi then return hi, lo end
end

local function base_name(path) return (tostring(path):match("([^/\\]+)$")) or tostring(path) end

-- [name, duration s, LUFS-I, true peak, sample peak, hi[], lo[]] per file
local function render_rows(files, analysis, budget)
  local by_file = {}
  for _, a in ipairs(analysis or {}) do by_file[a.file] = a end
  local rows = {}
  for _, f in ipairs(files or {}) do
    if budget.left <= 0 then budget.more = budget.more + 1 else
      budget.left = budget.left - 1
      local a = by_file[f] or {}
      local hi, lo
      local clock = api.time_precise
      if not clock or clock() - budget.started < RENDER_PEAKS_BUDGET_S then hi, lo = file_peaks(f) end
      rows[#rows + 1] = { base_name(f), round2(a.durationSeconds) or -1, round2(a.lufsIntegrated) or -150, round2(a.truePeak) or -150,
        round2(a.samplePeak) or -150, hi or {}, lo or {} }
    end
  end
  return rows
end

local function render_view(cmd_type, data)
  if type(data) ~= "table" then return nil end
  local budget = { left = RENDER_MAX_FILES, more = 0, started = api.time_precise and api.time_precise() or 0 }
  local groups = {}
  if cmd_type == "render_versions" then
    for _, v in ipairs(data.versions or {}) do
      groups[#groups + 1] = { v = tostring(v.name), m = v.muted or {}, f = render_rows(v.files, v.analysis, budget) }
    end
  else
    groups[1] = { v = "", m = {}, f = render_rows(data.files, data.analysis, budget) }
  end
  local r = { fmt = data.format or "", src = data.source or "master", groups = groups }
  if data.bitDepth then r.bd = tostring(data.bitDepth) end
  if data.mp3Bitrate then r.kbps = data.mp3Bitrate end
  if data.normalize then r.norm, r.nt = data.normalize, round2(data.normalizeTarget) end
  if data.limitCeiling then r.lim, r.tp = round2(data.limitCeiling), data.limitTruePeak == true end
  if budget.more > 0 then r.more = budget.more end
  return r
end

-- Recording: the global mode and one row per track [name, armed 0/1, input, monitor, mode]
local RECORD_COMMANDS = { get_record_setup = true, set_track_record = true, set_record_mode = true }

-- Rows for the first EDIT_MAX_ROWS states, and how many states did not fit
local function record_rows(states)
  local rows, dropped = {}, 0
  for _, s in ipairs(states or {}) do
    if #rows < EDIT_MAX_ROWS then
      rows[#rows + 1] = { s.name or "", s.armed and 1 or 0, (s.input and s.input.label) or "", tostring(s.monitor or ""), tostring(s.mode or "") }
    else
      dropped = dropped + 1
    end
  end
  return rows, dropped
end

local function record_global()
  local g = ctx.recording.global_state(api)
  return { mode = g.mode, path = g.recordPath, punch = g.punch and { g.punch.start, g.punch["end"] } or nil }
end

local function record_tracks(params)
  local states = {}
  for _, u in ipairs(decode_param_list(params.tracks) or {}) do
    local tr = type(u) == "table" and ctx.resolve_track(u.track)
    if tr and #states < EDIT_MAX_ROWS then states[#states + 1] = ctx.recording.record_state(api, tr) end
  end
  return states
end

local function record_view(cmd_type, params, data, before)
  local r = record_global()
  local dropped = 0
  if cmd_type == "get_record_setup" then
    r.rows, dropped = record_rows(type(data) == "table" and data.tracks or nil)
    dropped = dropped + (type(data) == "table" and tonumber(data.tracksMore) or 0)
  elseif cmd_type == "set_track_record" then
    r.rows, dropped = record_rows(type(data) == "table" and data.tracks or record_tracks(params))
  end
  if dropped > 0 then r.more = dropped end
  if before then
    r.was = { mode = before.mode, path = before.path, punch = before.punch, rows = before.rows }
  end
  return r
end

-- Fixed lanes: [name, plays 0 off / 1 alone / 2 layered] per lane and [position, length, lane, 1 = MIDI] per item
local LANE_COMMANDS = { get_track_lanes = true, set_track_lanes = true, comp_lanes = true }
local PLAYS_CODE = { off = 0, exclusive = 1, layered = 2 }

local function lane_snapshot(tr)
  local st = ctx.recording.lanes_state(api, tr)
  local lanes, items = {}, {}
  for i, l in ipairs(st.lanes) do
    if i <= EDIT_MAX_ROWS then lanes[i] = { l.name, PLAYS_CODE[l.plays] or 0 } end
    for _, it in ipairs(l.items) do
      if #items < EDIT_MAX_NOTES / 2 then items[#items + 1] = { round2(it.position) or 0, round2(it.length) or 0, l.lane, it.midi and 1 or 0 } end
    end
  end
  return { t = st.name, fixed = st.fixedLanes and 1 or 0, lanes = lanes, items = items }
end

local function lane_track(params)
  local tr = ctx.resolve_track(params.track)
  if not tr or (api.GetMasterTrack and tr == api.GetMasterTrack(0)) then return nil end
  return tr
end

local function lane_view(params, data, before)
  local tr = lane_track(params)
  if not tr then return nil end
  local r = lane_snapshot(tr)
  local len = 0
  for _, it in ipairs(r.items) do len = math.max(len, it[1] + it[2]) end
  if before then
    r.was = { lanes = before.lanes, items = before.items, fixed = before.fixed }
    for _, it in ipairs(before.items) do len = math.max(len, it[1] + it[2]) end
  end
  if type(data) == "table" and data.compLane then
    r.comp = data.compLane
    r.segs = {}
    for _, s in ipairs(data.segments or {}) do
      if #r.segs < EDIT_MAX_MARKS then r.segs[#r.segs + 1] = { round2(s.start) or 0, round2(s["end"]) or 0, s.lane } end
    end
  end
  r.len = round2(len) or 0
  return r
end

-- The state a write is about to change, read before its handler runs (nil for every other command)
function M.before(cmd_type, params)
  if cmd_type == "set_track_property" or cmd_type == "set_multiple_track_properties" then
    return read_track_values(track_targets(params, cmd_type))
  elseif cmd_type == "set_fx_parameter" or cmd_type == "set_multiple_fx_parameters" then
    return read_fx_values(fx_targets(params, cmd_type))
  elseif ENVELOPE_WRITES[cmd_type] or (AUTOMATION_ITEM_COMMANDS[cmd_type] and cmd_type ~= "list_automation_items") then
    local env = env_of(params)
    if not env then return nil end
    local pts = env_points(env)
    pts.items = env_items(env)
    return pts
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
  elseif ARRANGE.OPS[cmd_type] or cmd_type == "process_items" then
    return ARRANGE.before(cmd_type, params)
  elseif cmd_type == "set_time_selection" or cmd_type == "set_cursor_position" then
    return time_state()
  elseif ROUTING_COMMANDS[cmd_type] and cmd_type ~= "get_track_routing" then
    local tr = routing_track(params)
    return tr and { track = tr, routes = routes_of(tr) }
  elseif STRUCTURE_COMMANDS[cmd_type] then
    local rows, ids = mixer_all()
    return { tracks = rows, ids = ids }
  elseif ctx.recording and (cmd_type == "set_track_record" or cmd_type == "set_record_mode") then
    local g = record_global()
    if cmd_type == "set_track_record" then g.rows = record_rows(record_tracks(params)) end
    return g
  elseif ctx.recording and (cmd_type == "set_track_lanes" or cmd_type == "comp_lanes") then
    local tr = lane_track(params)
    return tr and lane_snapshot(tr)
  elseif MIX.MONITOR[cmd_type] and cmd_type ~= "list_monitoring_fx" then
    return MIX.monitor_slots()
  end
end

-- The entry's `r`: an edit view, a measurement, or nil
function M.summary(cmd_type, params, data, before)
  if cmd_type == "set_track_property" or cmd_type == "set_multiple_track_properties" then
    return change_rows(before, read_track_values(track_targets(params, cmd_type)))
  elseif cmd_type == "set_fx_parameter" or cmd_type == "set_multiple_fx_parameters" then
    return change_rows(before, read_fx_values(fx_targets(params, cmd_type)))
  elseif ENVELOPE_WRITES[cmd_type] or AUTOMATION_ITEM_COMMANDS[cmd_type] or cmd_type == "get_envelope_points" then
    return envelope_view(cmd_type, params, data, before)
  elseif MIDI_WRITES[cmd_type] or cmd_type == "get_midi_notes" then
    return midi_view(params, before)
  elseif cmd_type == "import_midi_file" then
    -- The first created item, all notes new; the other items (one per new track) are counted
    local first = type(data) == "table" and type(data.items) == "table" and data.items[1]
    local view = first and first.itemIndex and midi_view({ trackIndex = first.trackIndex, itemIndex = first.itemIndex }, {})
    if view and #data.items > 1 then view.items = #data.items - 1 end
    return view
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
  elseif ARRANGE.OPS[cmd_type] or cmd_type == "process_items" then
    return ARRANGE.view(cmd_type, params, data, before)
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
  elseif cmd_type == "set_automation_mode" then
    return type(data) == "table" and MIX.automation(data) or nil
  elseif cmd_type == "get_fx_param_modulation" or cmd_type == "set_fx_param_modulation" then
    return MIX.modulation(cmd_type, data)
  elseif cmd_type == "get_fx_pins" or cmd_type == "set_fx_pins" then
    return MIX.pins(data)
  elseif cmd_type == "add_stretch_markers" or cmd_type == "quantize_audio" then
    return MIX.stretch(cmd_type, data)
  elseif cmd_type == "freeze_tracks" or cmd_type == "unfreeze_tracks" or cmd_type == "apply_fx_to_items" then
    return MIX.freeze(cmd_type, data)
  elseif MIX.MONITOR[cmd_type] then
    return { chains = { { t = "Monitoring FX", fx = MIX.monitor_slots(), was = before } } }
  elseif cmd_type == "render_project" or cmd_type == "render_versions" then
    return render_view(cmd_type, data)
  elseif RECORD_COMMANDS[cmd_type] then
    return ctx.recording and record_view(cmd_type, params, data, before)
  elseif LANE_COMMANDS[cmd_type] then
    return ctx.recording and lane_view(params, data, before)
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
