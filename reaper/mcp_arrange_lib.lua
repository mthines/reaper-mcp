-- mcp_arrange_lib.lua — arrangement edits: copy items, insert and remove time
-- across the project, copy a section, and process items (normalize, reverse,
-- glue).
--
-- Pure logic over an injected ReaScript API, unit-tested via wasmoon against
-- a fake. Loaded by mcp_bridge.lua, and used by mcp_plan_lib.lua's run_plan
-- ops through check_op / apply_op.
--
-- Every function checks all of its input before the first write, so a refused
-- request changes nothing; each tool call is one undo point. Time edits are
-- done here rather than with REAPER's ripple actions, so the result does not
-- depend on the user's ripple and "move envelope points with items" options.

local M = {}

M.MAX_ITEMS = 64        -- items one call may name
M.MAX_COPIES = 256      -- items one copy may create
M.MAX_REPEAT = 64
M.MAX_SPAN = 3600       -- seconds one insert/remove/copy may span
M.MAX_LISTED = 64       -- items listed in a response; the rest are counted
M.REVERSE = 41051       -- Item properties: Toggle take reverse
M.GLUE = 40362          -- Item: Glue items, ignoring time selection (41588 glues only inside it)
M.DELETE_AUTOMATION_ITEMS = 42086
-- CalculateNormalization modes
M.NORMALIZE_MODES = { lufs_i = 0, rms = 1, peak = 2, true_peak = 3, lufs_m_max = 4, lufs_s_max = 5 }
local EPS = 1e-6
local PIN = 0.001  -- seconds between a copied section's edge and the point keeping the destination's value

local function num(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function int(v) return num(v) and v == math.floor(v) end
local function r3(v) return math.floor(v * 1000 + 0.5) / 1000 end
local function db(g) return g > 0 and r3(20 * math.log(g, 10)) or -150 end

local function with_undo(api, label, fn)
  api.Undo_BeginBlock()
  if api.PreventUIRefresh then api.PreventUIRefresh(1) end
  local ok, res = pcall(fn)
  if api.PreventUIRefresh then api.PreventUIRefresh(-1) end
  api.Undo_EndBlock(label, -1)
  -- A failure half way leaves no partial edit: undo the block, but only when the top entry is ours
  local undone = not ok and api.Undo_CanUndo2 and api.Undo_CanUndo2(0) == label
  if undone then api.Undo_DoUndo2(0) end
  if api.UpdateTimeline then api.UpdateTimeline() end
  if api.UpdateArrange then api.UpdateArrange() end
  if not ok then return nil, tostring(res) .. (undone and " — the edit was undone" or "") end
  return res
end

-- -----------------------------------------------------------------------------
-- Lookups (reads only)
-- -----------------------------------------------------------------------------

local function track_at(api, idx, field)
  field = field or "trackIndex"
  if not int(idx) or idx < 0 then return nil, field .. " must be a track index (0 or more)" end
  local tr = api.GetTrack(0, idx)
  if not tr then return nil, field .. ": track " .. idx .. " not found" end
  return tr
end

local function item_pos(api, it) return api.GetMediaItemInfo_Value(it, "D_POSITION") end
local function item_len(api, it) return api.GetMediaItemInfo_Value(it, "D_LENGTH") end

-- items: [{ trackIndex, itemIndex }] → { item, track, trackIndex, itemIndex, pos, len }, all checked
local function resolve_items(api, list)
  if type(list) ~= "table" or #list == 0 then return nil, "items must be a non-empty list of { trackIndex, itemIndex }" end
  if #list > M.MAX_ITEMS then return nil, "at most " .. M.MAX_ITEMS .. " items per call" end
  local out, seen = {}, {}
  for k, ref in ipairs(list) do
    local at = "items[" .. (k - 1) .. "]"
    if type(ref) ~= "table" then return nil, at .. " must be { trackIndex, itemIndex }" end
    local tr, err = track_at(api, ref.trackIndex)
    if not tr then return nil, at .. ": " .. err end
    if not int(ref.itemIndex) or ref.itemIndex < 0 then return nil, at .. ": itemIndex must be 0 or more" end
    local it = api.GetTrackMediaItem(tr, ref.itemIndex)
    if not it then return nil, at .. ": track " .. ref.trackIndex .. " has no item " .. ref.itemIndex end
    if seen[it] then return nil, at .. " names the same item twice" end
    seen[it] = true
    out[#out + 1] = { item = it, track = tr, trackIndex = ref.trackIndex, itemIndex = ref.itemIndex,
      pos = item_pos(api, it), len = item_len(api, it) }
  end
  return out
end

local function track_index(api, tr) return math.floor(api.GetMediaTrackInfo_Value(tr, "IP_TRACKNUMBER")) - 1 end

-- Where an item sits now, as the media tools address it
local function describe(api, it)
  local tr = api.GetMediaItem_Track(it)
  local idx
  for i = 0, api.CountTrackMediaItems(tr) - 1 do
    if api.GetTrackMediaItem(tr, i) == it then idx = i break end
  end
  return { trackIndex = track_index(api, tr), itemIndex = idx, position = r3(item_pos(api, it)), length = r3(item_len(api, it)) }
end

local function describe_all(api, items)
  local out = {}
  for i = 1, math.min(#items, M.MAX_LISTED) do out[i] = describe(api, items[i]) end
  return out
end

local function active_take_is_midi(api, it)
  local take = api.GetActiveTake(it)
  return take ~= nil and api.TakeIsMIDI(take)
end

-- Every track envelope in the project, the master's included, except the master's "Tempo map":
-- its points are the tempo markers, which the time edits change through the tempo API
local function each_envelope(api, fn)
  local master = api.GetMasterTrack(0)
  local function track_envs(tr)
    for i = 0, (api.CountTrackEnvelopes(tr) or 0) - 1 do
      local env = api.GetTrackEnvelope(tr, i)
      local _, name = api.GetEnvelopeName(env)
      if not (tr == master and name == "Tempo map") then fn(env, tr) end
    end
  end
  track_envs(master)
  for t = 0, api.CountTracks(0) - 1 do track_envs(api.GetTrack(0, t)) end
end

-- Split at `t` without the overlap REAPER's auto-crossfade option adds (it lengthens the left
-- part past the split): the left part ends at `t` and neither part gets a crossfade
local function split_at(api, it, t)
  local right = api.SplitMediaItem(it, t)
  if not right then return nil end
  api.SetMediaItemInfo_Value(it, "D_LENGTH", t - api.GetMediaItemInfo_Value(it, "D_POSITION"))
  api.SetMediaItemInfo_Value(it, "D_FADEOUTLEN", 0)
  api.SetMediaItemInfo_Value(it, "D_FADEOUTLEN_AUTO", 0)
  api.SetMediaItemInfo_Value(right, "D_FADEINLEN", 0)
  api.SetMediaItemInfo_Value(right, "D_FADEINLEN_AUTO", 0)
  return right
end

local function point(api, env, i)
  local _, t, v, shape, tension, sel = api.GetEnvelopePoint(env, i)
  return { t = t, v = v, shape = shape, tension = tension, sel = sel }
end

local function markers(api)
  local out = {}
  local _, nm, nr = api.CountProjectMarkers(0)
  for i = 0, (nm or 0) + (nr or 0) - 1 do
    local _, rgn, pos, rend, name, idx, color = api.EnumProjectMarkers3(0, i)
    out[#out + 1] = { rgn = rgn, pos = pos, rend = rend, name = name or "", num = idx, color = color or 0 }
  end
  return out
end

local function tempo_markers(api)
  local out = {}
  for i = 0, api.CountTempoTimeSigMarkers(0) - 1 do
    local _, t, _, _, bpm, n, d, lin = api.GetTempoTimeSigMarker(0, i)
    out[#out + 1] = { t = t, bpm = bpm, num = n, den = d, linear = lin }
  end
  return out
end

-- The tempo at t: a linear marker ramps to the next one
local function bpm_at(tempo, t)
  local prev
  for i, m in ipairs(tempo) do if m.t <= t + EPS then prev = i end end
  if not prev then return tempo[1] and tempo[1].bpm end
  local m, n = tempo[prev], tempo[prev + 1]
  if m.linear and n and n.t > m.t + EPS then return m.bpm + (n.bpm - m.bpm) * (t - m.t) / (n.t - m.t) end
  return m.bpm
end

-- The linear marker whose ramp runs across t (starts before it, its next marker after it)
local function ramp_across(tempo, t)
  for i, m in ipairs(tempo) do
    local n = tempo[i + 1]
    if m.linear and m.t < t - EPS and n and n.t > t + EPS then return m end
  end
end

-- A new tempo marker (0 = no time signature change)
local function add_tempo(api, t, bpm, linear)
  api.SetTempoTimeSigMarker(0, -1, t, -1, -1, bpm, 0, 0, linear)
end

-- Selected items project-wide, so an action that works on the selection can be pointed at
-- a few items and the user's selection put back afterwards
local function save_item_selection(api)
  local sel = {}
  for i = 0, api.CountMediaItems(0) - 1 do
    local it = api.GetMediaItem(0, i)
    if api.IsMediaItemSelected(it) then sel[#sel + 1] = it end
  end
  return sel
end

local function restore_item_selection(api, sel)
  api.SelectAllMediaItems(0, false)
  for _, it in ipairs(sel) do
    if api.ValidatePtr2(0, it, "MediaItem*") then api.SetMediaItemSelected(it, true) end
  end
end

-- -----------------------------------------------------------------------------
-- Copy items
-- -----------------------------------------------------------------------------

-- An item's state with fresh item, take and FX GUIDs. MIDI gets a fresh pool id unless
-- `pooled`, so editing a copy never edits its source.
local GUID_KEYS = { IGUID = true, GUID = true, FXID = true }
local function fresh_chunk(api, chunk, pooled)
  return (chunk:gsub("([\r\n]%s*)(%u+)(%s+){[%x%-]+}", function(pre, key, sp)
    if GUID_KEYS[key] or (key == "POOLEDEVTS" and not pooled) then return pre .. key .. sp .. api.genGuid("") end
  end))
end

local function copy_item(api, src, tr, pos, pooled)
  local ok, chunk = api.GetItemStateChunk(src, "", false)
  if not ok or type(chunk) ~= "string" then error("could not read an item's state") end
  local it = api.AddMediaItemToTrack(tr)
  api.SetItemStateChunk(it, fresh_chunk(api, chunk, pooled), false)
  api.SetMediaItemInfo_Value(it, "D_POSITION", pos)
  api.SetMediaItemSelected(it, false)
  return it
end

local function check_copy(api, p)
  local items, err = resolve_items(api, p.items)
  if not items then return nil, err end
  local times = p.times == nil and 1 or p.times
  if not int(times) or times < 1 or times > M.MAX_REPEAT then return nil, "times must be 1 to " .. M.MAX_REPEAT end
  if #items * times > M.MAX_COPIES then return nil, "at most " .. M.MAX_COPIES .. " copies per call (" .. #items .. " items × " .. times .. ")" end
  local first, last = math.huge, -math.huge
  for _, s in ipairs(items) do
    first = math.min(first, s.pos)
    last = math.max(last, s.pos + s.len)
  end
  local position = p.position == nil and last or p.position
  if not num(position) or position < 0 then return nil, "position must be 0 or more seconds" end
  local dest
  if p.trackIndex ~= nil then
    dest, err = track_at(api, p.trackIndex)
    if not dest then return nil, err end
  end
  if p.pooled ~= nil and type(p.pooled) ~= "boolean" then return nil, "pooled must be true or false" end
  return { items = items, times = times, first = first, span = last - first, position = position, dest = dest, pooled = p.pooled == true }
end

local function apply_copy(api, c)
  local made = {}
  for k = 0, c.times - 1 do
    local base = c.position + k * c.span
    for _, s in ipairs(c.items) do
      made[#made + 1] = copy_item(api, s.item, c.dest or s.track, base + (s.pos - c.first), c.pooled)
    end
  end
  return { copies = describe_all(api, made), count = #made, span = r3(c.span), times = c.times }
end

function M.copy_items(api, p)
  local c, err = check_copy(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Copy items", function() return apply_copy(api, c) end)
end

-- -----------------------------------------------------------------------------
-- Insert / remove time
-- -----------------------------------------------------------------------------

-- Tempo markers move first, then markers, envelopes and items are set to absolute times
-- read before any change: items and markers on a beat timebase would otherwise follow the
-- tempo change on their own.

-- Everything a time edit moves, read before the tempo map changes: with REAPER's default
-- beat timebase, markers, envelope points and items after a moved tempo marker move with it
local function snapshot(api)
  local snap = { markers = markers(api), envs = {}, items = {} }
  each_envelope(api, function(env)
    local e = { env = env, pts = {}, ais = {} }
    for i = 0, api.CountEnvelopePoints(env) - 1 do e.pts[#e.pts + 1] = point(api, env, i) end
    for i = 0, api.CountAutomationItems(env) - 1 do
      e.ais[#e.ais + 1] = { pos = api.GetSetAutomationItemInfo(env, i, "D_POSITION", 0, false),
        len = api.GetSetAutomationItemInfo(env, i, "D_LENGTH", 0, false) }
    end
    snap.envs[#snap.envs + 1] = e
  end)
  for t = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, t)
    for i = 0, api.CountTrackMediaItems(tr) - 1 do
      local it = api.GetTrackMediaItem(tr, i)
      snap.items[#snap.items + 1] = { it = it, tr = tr, pos = item_pos(api, it), len = item_len(api, it) }
    end
  end
  return snap
end

-- REAPER re-times beat-timebase content against a changed tempo map lazily; do it now, so
-- what is set next from the snapshot is converted with the new map
local function retime(api)
  if api.UpdateTimeline then api.UpdateTimeline() end
end

-- Value of an envelope at t, read before anything changes it
local function value_at(api, env, t)
  local _, v = api.Envelope_Evaluate(env, t, 0, 0)
  return v
end

-- True when an envelope has a point before t / at or after t
local function has_before(pts, t)
  return pts[1] ~= nil and pts[1].t < t - EPS
end
local function has_from(pts, t)
  return pts[#pts] ~= nil and pts[#pts].t >= t - EPS
end
-- Shape and tension of the segment running through t: the last point before it (linear when none)
local function shape_through(pts, t)
  local shape, tension = 0, 0
  for _, pt in ipairs(pts) do
    if pt.t < t - EPS then shape, tension = pt.shape, pt.tension end
  end
  return shape, tension
end

local function has_at(pts, t)
  for _, pt in ipairs(pts) do if math.abs(pt.t - t) <= EPS then return true end end
  return false
end

local function check_insert(api, p)
  if not num(p.position) or p.position < 0 then return nil, "position must be 0 or more seconds" end
  if not num(p.length) or p.length <= 0 or p.length > M.MAX_SPAN then return nil, "length must be more than 0 and at most " .. M.MAX_SPAN .. " seconds" end
  if p.splitItems ~= nil and type(p.splitItems) ~= "boolean" then return nil, "splitItems must be true or false" end
  return { at = p.position, len = p.length, split = p.splitItems ~= false }
end

local function apply_insert(api, c)
  local at, len = c.at, c.len
  local r = { position = r3(at), length = r3(len), itemsMoved = 0, itemsSplit = 0, markersMoved = 0, regionsExtended = 0,
    tempoMarkersMoved = 0, envelopePointsMoved = 0, automationItemsMoved = 0, automationItemsSpanning = 0 }
  local snap = snapshot(api)
  -- The value at the position, held across the opened time so the segment spanning it is not stretched
  for _, e in ipairs(snap.envs) do
    if has_before(e.pts, at) and has_from(e.pts, at) then e.hold = value_at(api, e.env, at) end
  end

  local tempo = tempo_markers(api)
  -- A ramp across the position would change slope (and so the timing before it) once its end moves
  local ramp = ramp_across(tempo, at)
  local ramp_bpm = ramp and bpm_at(tempo, at)
  for i = #tempo, 1, -1 do
    local m = tempo[i]
    if m.t >= at - EPS then
      api.SetTempoTimeSigMarker(0, i - 1, m.t + len, -1, -1, m.bpm, m.num, m.den, m.linear)
      r.tempoMarkersMoved = r.tempoMarkersMoved + 1
    end
  end
  if ramp then
    -- End the ramp at the position, hold its tempo across the opened time, then carry on as before
    add_tempo(api, at, ramp_bpm, false)
    add_tempo(api, at + len, ramp_bpm, true)
    r.tempoMarkersAdded = 2
  end
  retime(api)

  for _, m in ipairs(snap.markers) do
    if m.pos >= at - EPS then
      api.SetProjectMarker4(0, m.num, m.rgn, m.pos + len, m.rgn and m.rend + len or 0, m.name, m.color, 0)
      r.markersMoved = r.markersMoved + 1
    elseif m.rgn and m.rend > at + EPS then
      api.SetProjectMarker4(0, m.num, true, m.pos, m.rend + len, m.name, m.color, 0)
      r.regionsExtended = r.regionsExtended + 1
    end
  end

  for _, e in ipairs(snap.envs) do
    local moved = false
    for i, pt in ipairs(e.pts) do
      if pt.t >= at - EPS then
        api.SetEnvelopePoint(e.env, i - 1, pt.t + len, pt.v, pt.shape, pt.tension, pt.sel, true)
        r.envelopePointsMoved = r.envelopePointsMoved + 1
        moved = true
      end
    end
    if e.hold then
      api.InsertEnvelopePoint(e.env, at, e.hold, 0, 0, false, true)
      -- A point that sat on the position now ends the opened time itself
      -- and carries on with the shape of the segment it split (a square Mute envelope stays square)
      if not has_at(e.pts, at) then
        local shape, tension = shape_through(e.pts, at)
        api.InsertEnvelopePoint(e.env, at + len, e.hold, shape, tension, false, true)
      end
    end
    if moved then api.Envelope_SortPoints(e.env) end
    for i, ai in ipairs(e.ais) do
      if ai.pos >= at - EPS then
        api.GetSetAutomationItemInfo(e.env, i - 1, "D_POSITION", ai.pos + len, true)
        r.automationItemsMoved = r.automationItemsMoved + 1
      elseif ai.pos + ai.len > at + EPS then
        r.automationItemsSpanning = r.automationItemsSpanning + 1
      end
    end
  end

  for _, x in ipairs(snap.items) do
    if x.pos >= at - EPS then
      api.SetMediaItemInfo_Value(x.it, "D_POSITION", x.pos + len)
      api.SetMediaItemInfo_Value(x.it, "D_LENGTH", x.len)
      r.itemsMoved = r.itemsMoved + 1
    elseif c.split and x.pos + x.len > at + EPS then
      local right = split_at(api, x.it, at)
      if right then
        api.SetMediaItemInfo_Value(right, "D_POSITION", at + len)
        r.itemsSplit = r.itemsSplit + 1
      end
    end
  end
  return r
end

function M.insert_time(api, p)
  local c, err = check_insert(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Insert time", function() return apply_insert(api, c) end)
end

local function check_remove(api, p)
  if not num(p.start) or p.start < 0 then return nil, "start must be 0 or more seconds" end
  if not num(p["end"]) or p["end"] <= p.start then return nil, "end must be after start" end
  if p["end"] - p.start > M.MAX_SPAN then return nil, "at most " .. M.MAX_SPAN .. " seconds per call" end
  return { s = p.start, e = p["end"] }
end

-- Delete only the given automation items (by index on their envelope): REAPER has no API call,
-- so they are selected alone, deleted by action, and every other item's selection put back.
local function delete_automation_items(api, doomed)
  if #doomed == 0 then return end
  local keep, want = {}, {}
  for _, d in ipairs(doomed) do want[d[1]] = want[d[1]] or {}; want[d[1]][d[2]] = true end
  each_envelope(api, function(env)
    for i = 0, api.CountAutomationItems(env) - 1 do
      local was = api.GetSetAutomationItemInfo(env, i, "D_UISEL", 0, false) ~= 0
      local doom = want[env] and want[env][i] or false
      if not doom and was then keep[#keep + 1] = { env, i } end
      api.GetSetAutomationItemInfo(env, i, "D_UISEL", doom and 1 or 0, true)
    end
  end)
  api.Main_OnCommand(M.DELETE_AUTOMATION_ITEMS, 0)
  for _, k in ipairs(keep) do
    local i = k[2]
    for d in pairs(want[k[1]] or {}) do if d < k[2] then i = i - 1 end end
    api.GetSetAutomationItemInfo(k[1], i, "D_UISEL", 1, true)
  end
end

local function apply_remove(api, c)
  local s, e = c.s, c.e
  local len = e - s
  local function map(t) if t < s then return t elseif t >= e then return t - len end return s end
  local r = { start = r3(s), ["end"] = r3(e), itemsDeleted = 0, itemsTrimmed = 0, itemsMoved = 0, markersDeleted = 0,
    markersMoved = 0, regionsDeleted = 0, regionsTrimmed = 0, tempoMarkersDeleted = 0, tempoMarkersMoved = 0,
    envelopePointsDeleted = 0, envelopePointsMoved = 0, automationItemsDeleted = 0, automationItemsMoved = 0,
    automationItemsKept = 0, automationItemsTrimmed = 0 }
  local snap = snapshot(api)
  -- The values either side of the cut, kept at its edges so the automation outside it keeps its shape
  for _, x in ipairs(snap.envs) do
    if has_before(x.pts, s) and s - PIN >= 0 then x.left = value_at(api, x.env, s - PIN) end
    -- Also when the last point is inside the cut: it is deleted, and its value is what plays after the cut
    if has_from(x.pts, s) and not has_at(x.pts, e) then x.right = value_at(api, x.env, e) end
  end

  -- Tempo: markers inside go, except the last one, which moves to the cut so the tempo after
  -- the cut stays what it was (unless a marker sits on the cut's end already)
  local tempo = tempo_markers(api)
  -- Ramps across the cut's edges: before it, the ramp keeps its slope up to the cut; after it,
  -- the tempo starts where it stood at the cut's end and ramps on as it did
  local ramp_in = ramp_across(tempo, s)
  local bpm_in = ramp_in and bpm_at(tempo, s - PIN)
  local bpm_out = bpm_at(tempo, e)
  local in_force_out
  for _, m in ipairs(tempo) do if m.t <= e + EPS then in_force_out = m end end
  local ramp_out = in_force_out and in_force_out.linear and math.abs(in_force_out.t - e) > EPS and ramp_across(tempo, e) ~= nil
  local inside, at_end = {}, false
  for i, m in ipairs(tempo) do
    if m.t >= s - EPS and m.t < e - EPS then inside[#inside + 1] = i end
    if math.abs(m.t - e) < EPS then at_end = true end
  end
  local keep_last = (not at_end) and inside[#inside] or nil
  -- Inside first: delete from the last so earlier indexes hold, then move the kept one to
  -- the cut (after the deletes, so it never lands on a marker that is still there). Shifting
  -- what follows comes last: done first it could slide a later marker before an inside one.
  for k = #inside, 1, -1 do
    if inside[k] ~= keep_last then
      api.DeleteTempoTimeSigMarker(0, inside[k] - 1)
      r.tempoMarkersDeleted = r.tempoMarkersDeleted + 1
    end
  end
  if keep_last and math.abs(tempo[keep_last].t - s) > EPS then
    local kept = tempo[keep_last]
    for i, m in ipairs(tempo_markers(api)) do
      if math.abs(m.t - kept.t) < EPS then
        api.SetTempoTimeSigMarker(0, i - 1, s, -1, -1, m.bpm, m.num, m.den, m.linear)
        r.tempoMarkersMoved = r.tempoMarkersMoved + 1
        break
      end
    end
  end
  tempo = tempo_markers(api)
  for i, m in ipairs(tempo) do
    if m.t >= e - EPS then
      api.SetTempoTimeSigMarker(0, i - 1, m.t - len, -1, -1, m.bpm, m.num, m.den, m.linear)
      r.tempoMarkersMoved = r.tempoMarkersMoved + 1
    end
  end
  if ramp_out then
    local placed = false
    for i, m in ipairs(tempo_markers(api)) do
      if math.abs(m.t - s) < EPS then
        api.SetTempoTimeSigMarker(0, i - 1, s, -1, -1, bpm_out, m.num, m.den, true)
        placed = true
        break
      end
    end
    if not placed then add_tempo(api, s, bpm_out, true) end
  end
  if ramp_in then add_tempo(api, s - PIN, bpm_in, true) end
  retime(api)

  for _, m in ipairs(snap.markers) do
    if not m.rgn then
      if m.pos >= s - EPS and m.pos < e - EPS then
        api.DeleteProjectMarker(0, m.num, false)
        r.markersDeleted = r.markersDeleted + 1
      elseif m.pos >= e - EPS then
        api.SetProjectMarker4(0, m.num, false, m.pos - len, 0, m.name, m.color, 0)
        r.markersMoved = r.markersMoved + 1
      end
    else
      local a, b = map(m.pos), map(m.rend)
      if b - a <= EPS then
        api.DeleteProjectMarker(0, m.num, true)
        r.regionsDeleted = r.regionsDeleted + 1
      elseif a ~= m.pos or b ~= m.rend then
        api.SetProjectMarker4(0, m.num, true, a, b, m.name, m.color, 0)
        if b - a < m.rend - m.pos - EPS then r.regionsTrimmed = r.regionsTrimmed + 1 else r.markersMoved = r.markersMoved + 1 end
      end
    end
  end

  -- Envelope points, from the last so a delete leaves the earlier indexes as they were
  local doomed = {}
  for _, x in ipairs(snap.envs) do
    local moved = false
    for i = #x.pts, 1, -1 do
      local pt = x.pts[i]
      if pt.t >= s - EPS and pt.t < e - EPS then
        api.DeleteEnvelopePointEx(x.env, -1, i - 1)
        r.envelopePointsDeleted = r.envelopePointsDeleted + 1
      elseif pt.t >= e - EPS then
        api.SetEnvelopePoint(x.env, i - 1, pt.t - len, pt.v, pt.shape, pt.tension, pt.sel, true)
        r.envelopePointsMoved = r.envelopePointsMoved + 1
        moved = true
      end
    end
    if x.left then
      -- The pin carries the segment's shape, so a held step before the cut stays a step
      local shape, tension = shape_through(x.pts, s - PIN)
      api.InsertEnvelopePoint(x.env, s - PIN, x.left, shape, tension, false, true)
    end
    if x.right then
      local shape, tension = shape_through(x.pts, e)
      api.InsertEnvelopePoint(x.env, s, x.right, shape, tension, false, true)
    end
    if moved or x.left or x.right then api.Envelope_SortPoints(x.env) end
    for i, ai in ipairs(x.ais) do
      if ai.pos >= s - EPS and ai.pos + ai.len <= e + EPS then doomed[#doomed + 1] = { x.env, i - 1 } end
    end
  end
  -- Automation items: delete those inside first, then move the later ones by their index after the delete
  delete_automation_items(api, doomed)
  r.automationItemsDeleted = #doomed
  for _, x in ipairs(snap.envs) do
    local gone = 0
    for i, ai in ipairs(x.ais) do
      if ai.pos >= s - EPS and ai.pos + ai.len <= e + EPS then
        gone = gone + 1
      elseif ai.pos >= e - EPS then
        api.GetSetAutomationItemInfo(x.env, i - 1 - gone, "D_POSITION", ai.pos - len, true)
        r.automationItemsMoved = r.automationItemsMoved + 1
      elseif ai.pos >= s - EPS and ai.pos + ai.len > e + EPS then
        -- Starts in the cut (or on its start), ends after it: keep the part after the cut, like a media item
        local idx, cut_in = i - 1 - gone, e - ai.pos
        local rate = api.GetSetAutomationItemInfo(x.env, idx, "D_PLAYRATE", 0, false)
        if rate <= 0 then rate = 1 end
        local offs = api.GetSetAutomationItemInfo(x.env, idx, "D_STARTOFFS", 0, false)
        api.GetSetAutomationItemInfo(x.env, idx, "D_STARTOFFS", offs + cut_in * rate, true)
        api.GetSetAutomationItemInfo(x.env, idx, "D_POSITION", s, true)
        api.GetSetAutomationItemInfo(x.env, idx, "D_LENGTH", ai.len - cut_in, true)
        r.automationItemsTrimmed = r.automationItemsTrimmed + 1
      elseif ai.pos + ai.len <= e + EPS and ai.pos + ai.len > s + EPS then
        -- Starts before the cut, ends in it: drop its tail inside the cut
        api.GetSetAutomationItemInfo(x.env, i - 1 - gone, "D_LENGTH", s - ai.pos, true)
        r.automationItemsTrimmed = r.automationItemsTrimmed + 1
      elseif ai.pos + ai.len > s + EPS then
        -- Spans the whole cut: one item cannot lose its middle, so it stays and is counted
        r.automationItemsKept = r.automationItemsKept + 1
      end
    end
  end

  for _, x in ipairs(snap.items) do
    local stop = x.pos + x.len
    if x.pos >= e - EPS then
      api.SetMediaItemInfo_Value(x.it, "D_POSITION", x.pos - len)
      api.SetMediaItemInfo_Value(x.it, "D_LENGTH", x.len)
      r.itemsMoved = r.itemsMoved + 1
    elseif x.pos >= s - EPS and stop <= e + EPS then
      api.DeleteTrackMediaItem(x.tr, x.it)
      r.itemsDeleted = r.itemsDeleted + 1
    elseif stop > s + EPS then
      -- Crosses the cut: keep what lies outside it
      local middle = x.it
      if x.pos < s - EPS then middle = split_at(api, x.it, s) end
      local right = stop > e + EPS and split_at(api, middle, e) or nil
      api.DeleteTrackMediaItem(x.tr, middle)
      if right then api.SetMediaItemInfo_Value(right, "D_POSITION", s) end
      r.itemsTrimmed = r.itemsTrimmed + 1
    end
  end
  return r
end

function M.remove_time(api, p)
  local c, err = check_remove(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Remove time", function() return apply_remove(api, c) end)
end

-- -----------------------------------------------------------------------------
-- Copy a section
-- -----------------------------------------------------------------------------

-- regionIndex: the region's number, the `index` list_regions returns (and edit/delete_region take)
local function region_range(api, idx)
  for _, m in ipairs(markers(api)) do
    if m.rgn and m.num == idx then return m.pos, m.rend, m.name end
  end
end

local function check_section(api, p)
  local s, e, name
  if p.regionIndex ~= nil then
    if not int(p.regionIndex) or p.regionIndex < 0 then return nil, "regionIndex must be 0 or more" end
    s, e, name = region_range(api, p.regionIndex)
    if not s then return nil, "no region " .. p.regionIndex .. " (list_regions gives the indexes)" end
  else
    s, e = p.start, p["end"]
    if not num(s) or s < 0 then return nil, "give regionIndex, or start and end in seconds" end
    if not num(e) or e <= s then return nil, "end must be after start" end
  end
  if e - s > M.MAX_SPAN then return nil, "at most " .. M.MAX_SPAN .. " seconds per call" end
  if not num(p.position) or p.position < 0 then return nil, "position must be 0 or more seconds" end
  local dest, len = p.position, e - s
  if p.insert ~= nil and type(p.insert) ~= "boolean" then return nil, "insert must be true or false" end
  if p.envelopes ~= nil and type(p.envelopes) ~= "boolean" then return nil, "envelopes must be true or false" end
  if p.insert then
    if dest > s + EPS and dest < e - EPS then return nil, "position is inside the section; inserting there would split it" end
  elseif dest < e - EPS and dest + len > s + EPS then
    return nil, "the copy would overlap the section itself; pick a position at or after its end (" .. r3(e) .. " s), or before its start minus its length"
  end
  local tracks = {}
  if p.tracks ~= nil then
    if type(p.tracks) ~= "table" or #p.tracks == 0 then return nil, "tracks must be a non-empty list of track indexes" end
    for k, idx in ipairs(p.tracks) do
      local tr, err = track_at(api, idx, "tracks[" .. (k - 1) .. "]")
      if not tr then return nil, err end
      tracks[#tracks + 1] = tr
    end
  else
    for t = 0, api.CountTracks(0) - 1 do tracks[#tracks + 1] = api.GetTrack(0, t) end
  end
  local count = 0
  for _, tr in ipairs(tracks) do
    for i = 0, api.CountTrackMediaItems(tr) - 1 do
      local it = api.GetTrackMediaItem(tr, i)
      local pos = item_pos(api, it)
      if pos < e - EPS and pos + item_len(api, it) > s + EPS then count = count + 1 end
    end
  end
  if count > M.MAX_COPIES then return nil, "the section holds " .. count .. " items; at most " .. M.MAX_COPIES .. " per call" end
  return { s = s, e = e, len = len, dest = dest, name = name, tracks = tracks, insert = p.insert == true,
    envelopes = p.envelopes ~= false, all_tracks = p.tracks == nil }
end

-- Automation items wholly inside [s, e) get a pooled instance at the destination, so a section level
-- (one pool per section type) keeps editing as one; items crossing an edge are counted, not cut
local AI_KEYS = { "D_STARTOFFS", "D_PLAYRATE", "D_BASELINE", "D_AMPLITUDE", "D_LOOPSRC" }
local function copy_automation_items(api, env, s, e, offset, r)
  local inside = {}
  for i = 0, api.CountAutomationItems(env) - 1 do
    local pos = api.GetSetAutomationItemInfo(env, i, "D_POSITION", 0, false)
    local len = api.GetSetAutomationItemInfo(env, i, "D_LENGTH", 0, false)
    if pos >= s - EPS and pos + len <= e + EPS then
      local props = {}
      for _, k in ipairs(AI_KEYS) do props[k] = api.GetSetAutomationItemInfo(env, i, k, 0, false) end
      inside[#inside + 1] = { pool = math.floor(api.GetSetAutomationItemInfo(env, i, "D_POOL_ID", 0, false) + 0.5), pos = pos, len = len, props = props }
    elseif pos < e - EPS and pos + len > s + EPS then
      r.automationItemsCrossing = r.automationItemsCrossing + 1
    end
  end
  for _, ai in ipairs(inside) do
    local idx = api.InsertAutomationItem(env, ai.pool, ai.pos + offset, ai.len)
    if idx and idx >= 0 then
      for k, v in pairs(ai.props) do api.GetSetAutomationItemInfo(env, idx, k, v, true) end
      r.automationItems = r.automationItems + 1
    end
  end
end

local function apply_section(api, c)
  local s, e, len, dest = c.s, c.e, c.len, c.dest
  local r = { start = r3(s), ["end"] = r3(e), position = r3(dest), length = r3(len), region = c.name }
  if c.insert then
    r.inserted = apply_insert(api, { at = dest, len = len, split = true })
    -- Opening time at or before the section moves the section along with everything else
    if dest <= s + EPS then s, e = s + len, e + len end
  end
  local offset = dest - s
  local made = {}
  for _, tr in ipairs(c.tracks) do
    local sources = {}
    for i = 0, api.CountTrackMediaItems(tr) - 1 do
      local it = api.GetTrackMediaItem(tr, i)
      local pos = item_pos(api, it)
      if pos < e - EPS and pos + item_len(api, it) > s + EPS then sources[#sources + 1] = { it, pos } end
    end
    for _, src in ipairs(sources) do
      local copy = copy_item(api, src[1], tr, src[2] + offset, false)
      -- Trim the copy to the section by splitting at its edges and dropping the outside parts
      if src[2] < s - EPS then
        local inner = split_at(api, copy, dest)
        api.DeleteTrackMediaItem(tr, copy)
        copy = inner
      end
      if copy and item_pos(api, copy) + item_len(api, copy) > dest + len + EPS then
        local outer = split_at(api, copy, dest + len)
        if outer then api.DeleteTrackMediaItem(tr, outer) end
      end
      if copy then made[#made + 1] = copy end
    end
  end
  r.items = describe_all(api, made)
  r.itemCount = #made
  r.envelopePoints = 0
  r.automationItems, r.automationItemsCrossing = 0, 0
  if c.envelopes then
    local wanted = {}
    for _, tr in ipairs(c.tracks) do wanted[tr] = true end
    each_envelope(api, function(env, tr)
      if not (wanted[tr] or (c.all_tracks and tr == api.GetMasterTrack(0))) then return end
      local all, pts = {}, {}
      for i = 0, api.CountEnvelopePoints(env) - 1 do
        local pt = point(api, env, i)
        all[#all + 1] = pt
        if pt.t >= s - EPS and pt.t < e - EPS then pts[#pts + 1] = pt end
      end
      copy_automation_items(api, env, s, e, offset, r)
      if #all == 0 then return end
      -- Values at the section's edges, so the copy starts and ends where the source does
      local _, v_start = api.Envelope_Evaluate(env, s, 0, 0)
      local _, v_end = api.Envelope_Evaluate(env, e, 0, 0)
      -- And the destination's own values just outside the copy, so ramps leading in and out keep their shape
      local before, after = dest - PIN, dest + len + PIN
      local _, v_before = api.Envelope_Evaluate(env, before, 0, 0)
      local _, v_after = api.Envelope_Evaluate(env, after, 0, 0)
      -- Also with insert: the opened time's hold points would double the copy's own edge points
      api.DeleteEnvelopePointRange(env, dest - EPS, dest + len + EPS)
      if before >= 0 then api.InsertEnvelopePoint(env, before, v_before, 0, 0, false, true) end
      -- The edge points carry the shape of the segment they sit in, so a held or curved segment stays one
      local after_shape, after_tension = shape_through(all, after)
      api.InsertEnvelopePoint(env, after, v_after, after_shape, after_tension, false, true)
      -- With no point inside, the start point alone carries a ramp or level running through the section
      if #pts == 0 or math.abs(pts[1].t - s) > EPS then
        local start_shape, start_tension = shape_through(all, s)
        api.InsertEnvelopePoint(env, dest, v_start, start_shape, start_tension, false, true)
      end
      for _, pt in ipairs(pts) do
        api.InsertEnvelopePoint(env, pt.t + offset, pt.v, pt.shape, pt.tension, false, true)
      end
      api.InsertEnvelopePoint(env, dest + len, v_end, 0, 0, false, true)
      api.Envelope_SortPoints(env)
      r.envelopePoints = r.envelopePoints + #pts
    end)
  end
  return r
end

function M.copy_section(api, p)
  local c, err = check_section(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Copy section", function() return apply_section(api, c) end)
end

-- -----------------------------------------------------------------------------
-- Process items: normalize, reverse, glue
-- -----------------------------------------------------------------------------

-- The measured level (dB) of the part of the active take's source the item plays
local function take_level(api, it, mode)
  local take = api.GetActiveTake(it)
  local src = take and api.GetMediaItemTake_Source(take)
  if not src then return nil end
  local offs = api.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
  local rate = api.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")
  if rate <= 0 then rate = 1 end
  local src_len = api.GetMediaSourceLength(src)
  local stop = math.min(offs + item_len(api, it) * rate, src_len)
  -- With a 0 dB target the gain REAPER returns is the level, inverted
  local gain = api.CalculateNormalization(src, mode, 0, math.max(0, offs), stop)
  if not gain or gain <= 0 then return nil end
  return -20 * math.log(gain, 10), take
end

local function check_process(api, p)
  local items, err = resolve_items(api, p.items)
  if not items then return nil, err end
  local op = p.operation
  if op ~= "normalize" and op ~= "reverse" and op ~= "glue" then return nil, "operation must be normalize, reverse or glue" end
  local c = { op = op, items = items }
  if op == "normalize" or op == "reverse" then
    for k, s in ipairs(items) do
      if not api.GetActiveTake(s.item) then return nil, "items[" .. (k - 1) .. "] has no take" end
      if active_take_is_midi(api, s.item) then return nil, "items[" .. (k - 1) .. "] is MIDI; " .. op .. " works on audio items" end
    end
  end
  if op == "normalize" then
    local mode = p.mode or "peak"
    c.mode = M.NORMALIZE_MODES[mode]
    if not c.mode then return nil, "mode must be peak, true_peak, lufs_i, rms, lufs_m_max or lufs_s_max" end
    c.mode_name = mode
    local target = p.target
    if target == nil then
      if mode ~= "peak" and mode ~= "true_peak" then return nil, "target (dB) is required for mode " .. mode end
      target = 0
    end
    if not num(target) or target < -70 or target > 0 then return nil, "target must be -70 to 0 dB" end
    c.target = target
    for k, s in ipairs(items) do
      s.level, s.take = take_level(api, s.item, c.mode)
      if not s.level then return nil, "items[" .. (k - 1) .. "] is silent or its source can't be measured" end
    end
  end
  return c
end

local function apply_process(api, c)
  local r = { operation = c.op }
  if c.op == "normalize" then
    r.mode, r.target, r.items = c.mode_name, c.target, {}
    for _, s in ipairs(c.items) do
      local before = api.GetMediaItemInfo_Value(s.item, "D_VOL")
      -- A negative take volume is a polarity flip: its level is the magnitude
      local take_vol = math.abs(api.GetMediaItemTakeInfo_Value(s.take, "D_VOL"))
      if take_vol == 0 then take_vol = 1 end
      local gain = 10 ^ ((c.target - s.level) / 20) / take_vol
      api.SetMediaItemInfo_Value(s.item, "D_VOL", gain)
      local d = describe(api, s.item)
      d.levelBefore = r3(s.level + db(before) + db(take_vol))
      d.levelAfter = r3(c.target)
      d.gainBeforeDb, d.gainAfterDb = db(before), db(gain)
      r.items[#r.items + 1] = d
    end
    return r
  end
  local sel = save_item_selection(api)
  api.SelectAllMediaItems(0, false)
  for _, s in ipairs(c.items) do api.SetMediaItemSelected(s.item, true) end
  local ok, err = pcall(function()
    if c.op == "reverse" then
      api.Main_OnCommand(M.REVERSE, 0)
      r.items = {}
      for _, s in ipairs(c.items) do r.items[#r.items + 1] = describe(api, s.item) end
    else
      -- The glued items are the ones that did not exist before, on the tracks the sources are on
      -- (or a source still there afterwards, should REAPER reuse it for the result)
      local existed, tracks, selected_on, source = {}, {}, {}, {}
      local was_sel = {}
      for _, it in ipairs(sel) do was_sel[it] = true end
      for _, s in ipairs(c.items) do
        if not tracks[s.track] then
          tracks[s.track] = true
          for i = 0, api.CountTrackMediaItems(s.track) - 1 do existed[api.GetTrackMediaItem(s.track, i)] = true end
        end
        source[s.item] = true
        if was_sel[s.item] then selected_on[s.track] = true end
      end
      api.Main_OnCommand(M.GLUE, 0)
      local glued = {}
      for t = 0, api.CountTracks(0) - 1 do
        local tr = api.GetTrack(0, t)
        if tracks[tr] then
          for i = 0, api.CountTrackMediaItems(tr) - 1 do
            local it = api.GetTrackMediaItem(tr, i)
            if not existed[it] or source[it] then
              glued[#glued + 1] = it
              -- A selected source passes its selection on to the item that replaced it on its track
              if selected_on[tr] then sel[#sel + 1] = it end
            end
          end
        end
      end
      r.items = describe_all(api, glued)
    end
  end)
  restore_item_selection(api, sel)
  if not ok then error(err, 0) end
  return r
end

function M.process_items(api, p)
  local c, err = check_process(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: " .. c.op:sub(1, 1):upper() .. c.op:sub(2) .. " items", function() return apply_process(api, c) end)
end

-- -----------------------------------------------------------------------------
-- run_plan ops: copy_items, insert_time, remove_time
-- -----------------------------------------------------------------------------

local OPS = {
  copy_items = { check_copy, apply_copy },
  insert_time = { check_insert, apply_insert },
  remove_time = { check_remove, apply_remove },
}
M.PLAN_OPS = { copy_items = true, insert_time = true, remove_time = true }

--- Checks a plan op without writing; returns an error string or nil
function M.check_op(api, op)
  local _, err = OPS[op.op][1](api, op)
  return err
end

--- Runs a plan op inside the plan's undo block; raises on a refusal so the plan is undone
function M.apply_op(api, op)
  local c, err = OPS[op.op][1](api, op)
  if not c then error(op.op .. ": " .. err, 0) end
  return OPS[op.op][2](api, c)
end

return M
