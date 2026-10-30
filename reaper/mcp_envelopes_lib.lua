-- mcp_envelopes_lib.lua — track envelopes, their points and automation items.
--
-- Pure logic: every function takes the ReaScript API as `api`, so it runs
-- under a fake API in unit tests (envelopes-lib.test.ts). Loaded by
-- mcp_bridge.lua with dofile.
--
-- Values: a point's `value` is the raw envelope value REAPER stores. Volume
-- envelopes are fader-scaled by default (716.2 = 0 dB), so for those every
-- point also reads and writes `db`, converted with the envelope's own scaling
-- mode (ScaleToEnvelopeMode / ScaleFromEnvelopeMode).
--
-- Automation items: `automationItemIndex` (optional on every point tool)
-- addresses the points inside one automation item instead of the underlying
-- envelope. Instances of one pool share their points, so an edit to one is an
-- edit to all of them.
--
-- Every function validates all of its input before the first write, so a
-- refused request changes nothing. Writes happen inside one undo block.

local M = {}

-- Built-in envelopes REAPER creates and shows with a native action (the
-- reliable path: a hand-written chunk was rejected on some tracks). Width has
-- no such action and falls back to the chunk.
M.BUILTIN = {
  ["Volume"] = { action = 40406, chunk = "VOLENV2", neutral = 1 },
  ["Pan"] = { action = 40407, chunk = "PANENV2", neutral = 0 },
  ["Mute"] = { action = 40867, chunk = "MUTEENV", neutral = 1 },
  ["Trim Volume"] = { action = 42020, chunk = "VOLENV3", neutral = 1 },
  ["Width"] = { chunk = "WIDTHENV2", neutral = 1 },
}
M.DELETE_AUTOMATION_ITEMS = 42086
M.MIN_DB = -150
M.POOL_POINTS = 0x10000000

local function int(v)
  local n = tonumber(v)
  if not n or n ~= math.floor(n) then return nil end
  return n
end

local function with_undo(api, label, fn)
  api.Undo_BeginBlock()
  local ok, res, err = pcall(fn)
  api.Undo_EndBlock(label, -1)
  if api.UpdateArrange then api.UpdateArrange() end
  if not ok then return nil, "Internal error: " .. tostring(res) end
  return res, err
end

-- -----------------------------------------------------------------------------
-- Lookups (reads only)
-- -----------------------------------------------------------------------------

local function get_track(api, p)
  local i = int(p.trackIndex)
  if not i then return nil, "trackIndex required" end
  local tr = i == -1 and api.GetMasterTrack(0) or (i >= 0 and api.GetTrack(0, i) or nil)
  if not tr then return nil, "Track " .. i .. " not found" end
  return tr
end

-- -> env, ai (-1 = the underlying envelope), track
function M.resolve(api, p)
  local tr, err = get_track(api, p)
  if not tr then return nil, err end
  local ei = int(p.envelopeIndex)
  if not ei then return nil, "envelopeIndex required" end
  local count = api.CountTrackEnvelopes(tr)
  if ei < 0 or ei >= count then
    return nil, "Envelope index " .. ei .. " out of range (track has " .. count .. " envelopes)"
  end
  local env = api.GetTrackEnvelope(tr, ei)
  local ai = -1
  if p.automationItemIndex ~= nil then
    ai = int(p.automationItemIndex)
    local n = api.CountAutomationItems(env)
    if not ai or ai < 0 or ai >= n then
      return nil, "Automation item " .. tostring(p.automationItemIndex) .. " out of range (envelope has " .. n .. ")"
    end
    -- Point indexes over one loop iteration (the pool's own points), not every visible repeat
    ai = ai | M.POOL_POINTS
  end
  return env, ai, tr
end

-- Volume envelopes (Volume, Volume (Pre-FX), Trim Volume, Send Volume) read in dB.
-- An FX parameter envelope is named "<param> / <fx>", so "Volume / ReaComp" is not one.
function M.is_volume(api, env)
  local _, name = api.GetEnvelopeName(env)
  name = name or ""
  if name:find(" / ", 1, true) then return false, name end
  return name:lower():find("volume", 1, true) ~= nil, name
end

local function scaling(api, env)
  return api.GetEnvelopeScalingMode and api.GetEnvelopeScalingMode(env) or 0
end

function M.to_db(api, env, raw)
  local amp = raw
  if api.ScaleFromEnvelopeMode then amp = api.ScaleFromEnvelopeMode(scaling(api, env), raw) end
  if not amp or amp <= 0 then return M.MIN_DB end
  return math.max(M.MIN_DB, 20 * math.log(amp, 10))
end

function M.from_db(api, env, db)
  if db <= M.MIN_DB then return 0 end
  local amp = 10 ^ (db / 20)
  if api.ScaleToEnvelopeMode then return api.ScaleToEnvelopeMode(scaling(api, env), amp) end
  return amp
end

local function round(v, places)
  local m = 10 ^ places
  return math.floor(v * m + 0.5) / m
end

local function read_point(api, env, ai, i, volume)
  local _, time, value, shape, tension, selected = api.GetEnvelopePointEx(env, ai, i)
  local pt = { index = i, time = time, value = value, shape = shape, tension = tension, selected = selected }
  if volume then pt.db = round(M.to_db(api, env, value), 2) end
  return pt
end

-- A point's value from `value` or `db` (one, not both; db only on volume envelopes)
local function point_value(api, env, volume, pt, where, required)
  if pt.value ~= nil and pt.db ~= nil then return nil, where .. ": give value or db, not both" end
  if pt.db ~= nil then
    local db = tonumber(pt.db)
    if not db then return nil, where .. ": db must be a number" end
    if not volume then return nil, where .. ": db only applies to volume envelopes; use value" end
    return M.from_db(api, env, db)
  end
  if pt.value ~= nil then
    local v = tonumber(pt.value)
    if not v then return nil, where .. ": value must be a number" end
    return v
  end
  if required then return nil, where .. ": value or db required" end
  return nil
end

local function check_shape(pt, where)
  if pt.shape ~= nil then
    local s = int(pt.shape)
    if not s or s < 0 or s > 5 then return nil, where .. ": shape must be 0-5" end
  end
  if pt.tension ~= nil then
    local t = tonumber(pt.tension)
    if not t or t < -1 or t > 1 then return nil, where .. ": tension must be -1..1" end
  end
  return true
end

local function sort(api, env, ai)
  if ai >= 0 then ai = ai & ~M.POOL_POINTS end
  if api.Envelope_SortPointsEx then api.Envelope_SortPointsEx(env, ai) else api.Envelope_SortPoints(env) end
end

-- REAPER keeps an automation item's points only inside its pool's own length
-- (D_POOL_QNLEN, end exclusive): a point past it is dropped from the pool with
-- no error. A new pool's length can also come out shorter than its item (49 QN
-- for a 50.25 QN item, seen live in REAPER 7.40). A point at the very end is
-- kept POOL_EDGE seconds inside it.
M.POOL_EDGE = 0.001

-- -> start, stop (project seconds) where the pool points of item `i` (plain index)
-- can sit; nil when an offset or play rate makes that mapping unclear
local function pool_span(api, env, i)
  local get = function(k) return api.GetSetAutomationItemInfo(env, i, k, 0, false) end
  local pos = get("D_POSITION")
  if get("D_STARTOFFS") ~= 0 or get("D_PLAYRATE") ~= 1 then return nil end
  local qn = api.TimeMap2_timeToQN and get("D_POOL_QNLEN")
  if not qn or qn <= 0 then return pos, pos + get("D_LENGTH") end
  return pos, api.TimeMap2_QNToTime(0, api.TimeMap2_timeToQN(0, pos) + qn)
end

-- A point time inside automation item `ai` (flagged or plain): the time to write,
-- or nil and why not
local function pool_time(api, env, ai, t, where)
  if ai < 0 then return t end
  local i = ai & ~M.POOL_POINTS
  local start, stop = pool_span(api, env, i)
  if not start then return t end
  if t < start - 1e-9 or t > stop + 1e-9 then
    return nil, string.format("%s: time %.3f is outside automation item %d (its points run %.3f..%.3f)",
      where, t, i, start, stop)
  end
  return math.min(t, stop - M.POOL_EDGE)
end

local function target(p, ai)
  local t = { trackIndex = int(p.trackIndex), envelopeIndex = int(p.envelopeIndex) }
  if ai >= 0 then t.automationItemIndex = ai & ~M.POOL_POINTS end
  return t
end

-- The send a send envelope belongs to (every one is named "Send Volume", "Send Pan", ...);
-- nil for any other envelope. I_SEND_IDX is 1-based, 0 when not a send.
local function send_of(api, env)
  if not api.GetEnvelopeInfo_Value then return nil end
  local idx = math.floor((tonumber((api.GetEnvelopeInfo_Value(env, "I_SEND_IDX"))) or 0) + 0.5)
  if idx <= 0 then return nil end
  local send = { index = idx - 1 }
  local dest = api.GetEnvelopeInfo_Value(env, "P_DESTTRACK")
  if type(dest) == "userdata" or type(dest) == "table" then
    local _, name = api.GetTrackName(dest)
    send.destTrackName = name
    local n = math.floor(api.GetMediaTrackInfo_Value(dest, "IP_TRACKNUMBER") + 0.5)
    send.destTrackIndex = n == -1 and -1 or n - 1
  end
  return send
end

function M.list_envelopes(api, p)
  local tr, err = get_track(api, p)
  if not tr then return nil, err end
  local count = api.CountTrackEnvelopes(tr)
  local envelopes = {}
  for i = 0, count - 1 do
    local env = api.GetTrackEnvelope(tr, i)
    local _, name = api.GetEnvelopeName(env)
    -- SWS reads the active/visible/armed state; without it these are defaults
    local active, visible, armed = true, true, false
    if api.BR_EnvAlloc then
      local br = api.BR_EnvAlloc(env, false)
      active, visible, armed = api.BR_EnvGetProperties(br)
      api.BR_EnvFree(br, false)
    end
    envelopes[#envelopes + 1] = {
      index = i, name = name, pointCount = api.CountEnvelopePoints(env),
      active = active, visible = visible, armed = armed,
      automationItems = api.CountAutomationItems and api.CountAutomationItems(env) or 0,
      send = send_of(api, env),
    }
  end
  return { trackIndex = int(p.trackIndex), envelopes = envelopes, count = count }
end

-- -----------------------------------------------------------------------------
-- Points
-- -----------------------------------------------------------------------------

function M.get_points(api, p)
  local env, ai = M.resolve(api, p)
  if not env then return nil, ai end
  local volume, name = M.is_volume(api, env)
  local total = api.CountEnvelopePointsEx(env, ai)
  local offset = int(p.offset) or 0
  local limit = int(p.limit) or total
  local last = math.min(offset + limit, total)
  local points = {}
  for i = offset, last - 1 do points[#points + 1] = read_point(api, env, ai, i, volume) end
  local r = target(p, ai)
  r.name, r.unit, r.points, r.total, r.offset, r.hasMore = name, volume and "dB" or "raw", points, total, offset, last < total
  return r
end

-- points: list of { time, value | db, shape?, tension? }
function M.insert_points(api, p, points)
  local env, ai = M.resolve(api, p)
  if not env then return nil, ai end
  if type(points) ~= "table" or #points == 0 then return nil, "points must be a non-empty array" end
  local volume = M.is_volume(api, env)
  local todo = {}
  for i, pt in ipairs(points) do
    local where = "point " .. (i - 1)
    local time = tonumber(pt.time)
    if not time then return nil, where .. ": time required" end
    local terr
    time, terr = pool_time(api, env, ai, time, where)
    if not time then return nil, terr end
    local value, err = point_value(api, env, volume, pt, where, true)
    if not value then return nil, err end
    local ok, serr = check_shape(pt, where)
    if not ok then return nil, serr end
    todo[i] = { time, value, int(pt.shape) or 0, tonumber(pt.tension) or 0 }
  end
  return with_undo(api, "MCP: Insert " .. #todo .. " envelope point" .. (#todo == 1 and "" or "s"), function()
    for _, t in ipairs(todo) do api.InsertEnvelopePointEx(env, ai, t[1], t[2], t[3], t[4], false, true) end
    sort(api, env, ai)
    local r = target(p, ai)
    r.insertedPoints, r.totalPoints = #todo, api.CountEnvelopePointsEx(env, ai)
    return r
  end)
end

-- edits: list of { index, time?, value? | db?, shape?, tension? }; fields left out keep their value
function M.edit_points(api, p, edits)
  local env, ai = M.resolve(api, p)
  if not env then return nil, ai end
  if type(edits) ~= "table" or #edits == 0 then return nil, "points must be a non-empty array" end
  local volume = M.is_volume(api, env)
  local total = api.CountEnvelopePointsEx(env, ai)
  local seen, todo = {}, {}
  for i, e in ipairs(edits) do
    local idx = int(e.index)
    local where = "edit " .. (i - 1)
    if not idx or idx < 0 or idx >= total then
      return nil, where .. ": point index " .. tostring(e.index) .. " out of range (envelope has " .. total .. " points)"
    end
    if seen[idx] then return nil, where .. ": point " .. idx .. " is edited twice" end
    seen[idx] = true
    if e.time ~= nil and not tonumber(e.time) then return nil, where .. ": time must be a number" end
    local time = tonumber(e.time)
    if time then
      local terr
      time, terr = pool_time(api, env, ai, time, where)
      if not time then return nil, terr end
    end
    local value, err = point_value(api, env, volume, e, where, false)
    if err then return nil, err end
    local ok, serr = check_shape(e, where)
    if not ok then return nil, serr end
    local cur = read_point(api, env, ai, idx, false)
    todo[#todo + 1] = {
      idx, time or cur.time, value or cur.value,
      int(e.shape) or cur.shape, tonumber(e.tension) or cur.tension, cur.selected,
    }
  end
  return with_undo(api, "MCP: Edit " .. #todo .. " envelope point" .. (#todo == 1 and "" or "s"), function()
    -- SetEnvelopePointEx ignores a flagged index (seen live, REAPER 7.40): the plain item index edits its
    -- first loop iteration, which is the pool's own points
    local set_ai = ai >= 0 and (ai & ~M.POOL_POINTS) or ai
    for _, t in ipairs(todo) do api.SetEnvelopePointEx(env, set_ai, t[1], t[2], t[3], t[4], t[5], t[6], true) end
    sort(api, env, ai)
    local r = target(p, ai)
    r.editedPoints, r.totalPoints = #todo, api.CountEnvelopePointsEx(env, ai)
    return r
  end)
end

function M.delete_point(api, p)
  local env, ai = M.resolve(api, p)
  if not env then return nil, ai end
  local idx = int(p.pointIndex)
  local total = api.CountEnvelopePointsEx(env, ai)
  if not idx or idx < 0 or idx >= total then
    return nil, "Point index " .. tostring(p.pointIndex) .. " out of range (envelope has " .. total .. " points)"
  end
  local deleted = read_point(api, env, ai, idx, M.is_volume(api, env))
  return with_undo(api, "MCP: Delete envelope point", function()
    api.DeleteEnvelopePointEx(env, ai, idx)
    sort(api, env, ai)
    local r = target(p, ai)
    r.success, r.deleted, r.totalPoints = true, deleted, api.CountEnvelopePointsEx(env, ai)
    return r
  end)
end

-- Deletes the points with timeStart <= time < timeEnd (all of them when both are nil)
function M.remove_range(api, p, label)
  local env, ai = M.resolve(api, p)
  if not env then return nil, ai end
  local t0, t1 = tonumber(p.timeStart), tonumber(p.timeEnd)
  local all = p.timeStart == nil and p.timeEnd == nil
  if not all then
    if not t0 or not t1 then return nil, "timeStart and timeEnd required" end
    if t1 <= t0 then return nil, "timeEnd must be after timeStart" end
  end
  local before = api.CountEnvelopePointsEx(env, ai)
  return with_undo(api, label, function()
    if all then
      api.DeleteEnvelopePointRangeEx(env, ai, -math.huge, math.huge)
    else
      api.DeleteEnvelopePointRangeEx(env, ai, t0, t1)
    end
    sort(api, env, ai)
    local after = api.CountEnvelopePointsEx(env, ai)
    local r = target(p, ai)
    if not all then r.timeStart, r.timeEnd = t0, t1 end
    r.deletedPoints, r.totalPoints = before - after, after
    return r
  end)
end

-- -----------------------------------------------------------------------------
-- Creating built-in envelopes
-- -----------------------------------------------------------------------------

local function track_selection(api)
  local sel = {}
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    sel[#sel + 1] = { tr, api.IsTrackSelected(tr) }
  end
  local master = api.GetMasterTrack(0)
  sel[#sel + 1] = { master, api.IsTrackSelected(master) }
  return sel
end

local function restore_selection(api, sel)
  for _, s in ipairs(sel) do api.SetTrackSelected(s[1], s[2]) end
end

-- REAPER drops an envelope without points, so a new one gets one neutral point at 0
local function add_by_chunk(api, tr, spec)
  local _, chunk = api.GetTrackStateChunk(tr, "", false)
  if chunk:find("<" .. spec.chunk .. "\n", 1, true) then
    chunk = chunk:gsub("(<" .. spec.chunk .. "[^\n]*\n)ACT 0", "%1ACT 1")
    chunk = chunk:gsub("(<" .. spec.chunk .. "[^\n]*\n[^\n]*\n)VIS 0", "%1VIS 1")
  else
    local env_chunk = "<" .. spec.chunk .. "\nACT 1 -1\nVIS 1 1 1\nLANEHEIGHT 0 0\nARM 0\nDEFSHAPE 0 -1 -1\nPT 0 "
      .. spec.neutral .. " 0\n>\n"
    -- Envelopes belong before the first item; else before the closing > of the track
    local at = chunk:find("\n<ITEM", 1, true)
    if at then
      chunk = chunk:sub(1, at) .. env_chunk .. chunk:sub(at + 1)
    else
      local last_gt = chunk:match(".*()>")
      if not last_gt then return end
      chunk = chunk:sub(1, last_gt - 1) .. env_chunk .. chunk:sub(last_gt)
    end
  end
  api.SetTrackStateChunk(tr, chunk, false)
end

local function show(api, env)
  local ok, chunk = api.GetEnvelopeStateChunk(env, "", false)
  if not ok or type(chunk) ~= "string" then return end
  local shown = chunk:gsub("\nACT 0", "\nACT 1"):gsub("\nVIS 0", "\nVIS 1")
  if shown ~= chunk then api.SetEnvelopeStateChunk(env, shown, false) end
end

local function index_of(api, tr, env)
  for i = 0, api.CountTrackEnvelopes(tr) - 1 do
    if api.GetTrackEnvelope(tr, i) == env then return i end
  end
  return -1
end

function M.create(api, p)
  local tr, err = get_track(api, p)
  if not tr then return nil, err end
  local name = p.envelopeName
  if p.fxIndex ~= nil then
    local fx, param = int(p.fxIndex), int(p.paramIndex)
    if not param then return nil, "paramIndex is required when fxIndex is provided" end
    local fx_count = api.TrackFX_GetCount(tr)
    if not fx or fx < 0 or fx >= fx_count then
      return nil, "FX index " .. tostring(p.fxIndex) .. " out of range (track has " .. fx_count .. " FX)"
    end
    local param_count = api.TrackFX_GetNumParams(tr, fx)
    if param < 0 or param >= param_count then
      return nil, "Parameter index " .. param .. " out of range (FX has " .. param_count .. " parameters)"
    end
  elseif name then
    if not M.BUILTIN[name] then
      return nil, "Unknown envelope name: " .. tostring(name) .. ". Use Volume, Pan, Mute, Width, or Trim Volume"
    end
  else
    return nil, "Must provide either envelopeName or fxIndex+paramIndex"
  end

  local label = "MCP: Create envelope '" .. (name or "FX parameter") .. "'"
  return with_undo(api, label, function()
    local env, created = nil, false
    if p.fxIndex ~= nil then
      created = api.GetFXEnvelope(tr, p.fxIndex, p.paramIndex, false) == nil
      env = api.GetFXEnvelope(tr, p.fxIndex, p.paramIndex, true)
      if not env then return nil, "Failed to create FX parameter envelope (fxIndex=" .. p.fxIndex .. ", paramIndex=" .. p.paramIndex .. ")" end
      local _, pname = api.TrackFX_GetParamName(tr, p.fxIndex, p.paramIndex)
      local _, fname = api.TrackFX_GetFXName(tr, p.fxIndex)
      name = fname .. " / " .. pname
    else
      local spec = M.BUILTIN[name]
      env = api.GetTrackEnvelopeByName(tr, name)
      if not env then
        created = true
        if spec.action then
          -- The action works on the selected tracks: select only this one, then put the selection back
          local sel = track_selection(api)
          api.SetOnlyTrackSelected(tr)
          api.Main_OnCommand(spec.action, 0)
          restore_selection(api, sel)
          env = api.GetTrackEnvelopeByName(tr, name)
        end
        if not env then
          add_by_chunk(api, tr, spec)
          env = api.GetTrackEnvelopeByName(tr, name)
        end
        if not env then return nil, "Failed to create envelope: " .. name end
      end
    end
    show(api, env)
    if api.TrackList_AdjustWindows then api.TrackList_AdjustWindows(false) end
    return {
      trackIndex = int(p.trackIndex),
      envelopeIndex = index_of(api, tr, env),
      name = name,
      created = created,
      pointCount = api.CountEnvelopePoints(env),
    }
  end)
end

-- -----------------------------------------------------------------------------
-- Automation items
-- -----------------------------------------------------------------------------

local AI_FIELDS = {
  position = "D_POSITION", length = "D_LENGTH", startOffset = "D_STARTOFFS", playRate = "D_PLAYRATE",
  baseline = "D_BASELINE", amplitude = "D_AMPLITUDE",
}

local function ai_info(api, env, i)
  local function get(parm) return api.GetSetAutomationItemInfo(env, i, parm, 0, false) end
  local _, pool_name = api.GetSetAutomationItemInfo_String(env, i, "P_POOL_NAME", "", false)
  local pool = math.floor(get("D_POOL_ID") + 0.5)
  return {
    index = i,
    poolId = pool,
    name = pool_name or "",
    position = get("D_POSITION"),
    length = get("D_LENGTH"),
    startOffset = get("D_STARTOFFS"),
    playRate = get("D_PLAYRATE"),
    baseline = get("D_BASELINE"),
    amplitude = get("D_AMPLITUDE"),
    loop = get("D_LOOPSRC") ~= 0,
    selected = get("D_UISEL") ~= 0,
    pointCount = api.CountEnvelopePointsEx(env, i | M.POOL_POINTS),
  }
end

-- Every automation item in the project, for pool ids and for selection
local function each_automation_item(api, fn)
  local function track_envs(tr)
    for e = 0, api.CountTrackEnvelopes(tr) - 1 do
      local env = api.GetTrackEnvelope(tr, e)
      for i = 0, api.CountAutomationItems(env) - 1 do fn(env, i) end
    end
  end
  track_envs(api.GetMasterTrack(0))
  for t = 0, api.CountTracks(0) - 1 do track_envs(api.GetTrack(0, t)) end
end

-- Instances of a pool anywhere in the project: pools are shared across tracks and envelopes
local function pool_instances(api, pool)
  local n = 0
  each_automation_item(api, function(e, i)
    if math.floor(api.GetSetAutomationItemInfo(e, i, "D_POOL_ID", 0, false) + 0.5) == pool then n = n + 1 end
  end)
  return n
end

function M.list_items(api, p)
  local env, err = M.resolve(api, p)
  if not env then return nil, err end
  local items = {}
  for i = 0, api.CountAutomationItems(env) - 1 do items[#items + 1] = ai_info(api, env, i) end
  local _, name = M.is_volume(api, env)
  local r = target(p, -1)
  r.name, r.items, r.count = name, items, #items
  return r
end

local function check_item_fields(p)
  for key in pairs(AI_FIELDS) do
    if p[key] ~= nil and not tonumber(p[key]) then return nil, key .. " must be a number" end
  end
  if p.length ~= nil and tonumber(p.length) <= 0 then return nil, "length must be > 0" end
  if p.position ~= nil and tonumber(p.position) < 0 then return nil, "position must be >= 0" end
  if p.playRate ~= nil and tonumber(p.playRate) <= 0 then return nil, "playRate must be > 0" end
  if p.baseline ~= nil and (tonumber(p.baseline) < 0 or tonumber(p.baseline) > 1) then return nil, "baseline must be 0..1" end
  if p.amplitude ~= nil and (tonumber(p.amplitude) < -1 or tonumber(p.amplitude) > 1) then return nil, "amplitude must be -1..1" end
  if p.name ~= nil and type(p.name) ~= "string" then return nil, "name must be a string" end
  return true
end

local function apply_item_fields(api, env, i, p)
  for key, parm in pairs(AI_FIELDS) do
    if p[key] ~= nil and key ~= "position" and key ~= "length" then
      api.GetSetAutomationItemInfo(env, i, parm, tonumber(p[key]), true)
    end
  end
  if p.loop ~= nil then api.GetSetAutomationItemInfo(env, i, "D_LOOPSRC", p.loop and 1 or 0, true) end
  if p.name ~= nil then api.GetSetAutomationItemInfo_String(env, i, "P_POOL_NAME", p.name, true) end
end

-- New automation item at position/length. poolId: an existing pool makes a pooled
-- instance (same points); omitted makes a new empty pool, filled from `points`
-- (times relative to the item start). captureEnvelope moves the underlying points
-- in that range into the new item instead.
function M.insert_item(api, p, points)
  local env, err = M.resolve(api, { trackIndex = p.trackIndex, envelopeIndex = p.envelopeIndex })
  if not env then return nil, err end
  local pos, len = tonumber(p.position), tonumber(p.length)
  if not pos or pos < 0 then return nil, "position (seconds, >= 0) required" end
  if not len or len <= 0 then return nil, "length (seconds, > 0) required" end
  local ok, ferr = check_item_fields(p)
  if not ok then return nil, ferr end
  local pool = p.poolId ~= nil and int(p.poolId) or nil
  if p.poolId ~= nil and (not pool or pool < 0) then return nil, "poolId must be an integer >= 0" end
  if p.captureEnvelope and pool then return nil, "captureEnvelope makes a new pool; leave out poolId" end
  local existing = false
  if pool then
    each_automation_item(api, function(e, i)
      if math.floor(api.GetSetAutomationItemInfo(e, i, "D_POOL_ID", 0, false) + 0.5) == pool then existing = true end
    end)
  end
  if existing and points then return nil, "points only apply to a new pool; edit the pool's points with edit_envelope_points" end
  local volume = M.is_volume(api, env)
  local todo = {}
  for i, pt in ipairs(points or {}) do
    local where = "point " .. (i - 1)
    local t = tonumber(pt.time)
    if not t or t < 0 or t > len then return nil, where .. ": time must be 0.." .. len .. " (seconds from the item start)" end
    local value, verr = point_value(api, env, volume, pt, where, true)
    if not value then return nil, verr end
    local sok, serr = check_shape(pt, where)
    if not sok then return nil, serr end
    todo[#todo + 1] = { pos + t, value, int(pt.shape) or 0, tonumber(pt.tension) or 0 }
  end
  if not pool and not p.captureEnvelope then
    local max = -1
    each_automation_item(api, function(e, i)
      max = math.max(max, math.floor(api.GetSetAutomationItemInfo(e, i, "D_POOL_ID", 0, false) + 0.5))
    end)
    pool = max + 1
  end

  return with_undo(api, "MCP: Insert automation item", function()
    local idx = api.InsertAutomationItem(env, p.captureEnvelope and -1 or pool, pos, len)
    if idx == nil or idx < 0 then return nil, "REAPER refused to insert the automation item" end
    if not existing and api.TimeMap2_timeToQN then
      -- The pool spans the whole item, or points near its end are dropped
      api.GetSetAutomationItemInfo(env, idx, "D_POOL_QNLEN",
        api.TimeMap2_timeToQN(0, pos + len) - api.TimeMap2_timeToQN(0, pos), true)
    end
    if #todo > 0 then
      -- A new pool's item can start with points of its own; replace them with ours
      local pidx = idx | M.POOL_POINTS
      api.DeleteEnvelopePointRangeEx(env, pidx, -math.huge, math.huge)
      for _, t in ipairs(todo) do
        api.InsertEnvelopePointEx(env, pidx, (pool_time(api, env, pidx, t[1], "")), t[2], t[3], t[4], false, true)
      end
      sort(api, env, pidx)
    end
    apply_item_fields(api, env, idx, p)
    local r = target(p, -1)
    r.automationItem = ai_info(api, env, idx)
    r.pooledWith = pool_instances(api, r.automationItem.poolId) - 1
    return r
  end)
end

-- The item itself, not its points: the plain index without the pool-points flag
local function resolve_item(api, p)
  if p.automationItemIndex == nil then return nil, "automationItemIndex required" end
  local env, ai = M.resolve(api, p)
  if not env then return nil, ai end
  return env, ai & ~M.POOL_POINTS
end

function M.set_item(api, p)
  local env, ai = resolve_item(api, p)
  if not env then return nil, ai end
  local ok, ferr = check_item_fields(p)
  if not ok then return nil, ferr end
  return with_undo(api, "MCP: Edit automation item", function()
    if p.position ~= nil then api.GetSetAutomationItemInfo(env, ai, "D_POSITION", tonumber(p.position), true) end
    if p.length ~= nil then api.GetSetAutomationItemInfo(env, ai, "D_LENGTH", tonumber(p.length), true) end
    apply_item_fields(api, env, ai, p)
    local r = target(p, -1)
    r.automationItem = ai_info(api, env, ai)
    return r
  end)
end

-- Deletes one automation item (its points go with it unless preservePoints).
-- REAPER has no API call for it: select only this item, run the delete action,
-- then put every other item's selection back.
function M.delete_item(api, p)
  local env, ai = resolve_item(api, p)
  if not env then return nil, ai end
  local deleted = ai_info(api, env, ai)
  return with_undo(api, "MCP: Delete automation item", function()
    local sel = {}
    each_automation_item(api, function(e, i)
      local was = api.GetSetAutomationItemInfo(e, i, "D_UISEL", 0, false) ~= 0
      local this = e == env and i == ai
      if not this then sel[#sel + 1] = { e, i, was } end
      api.GetSetAutomationItemInfo(e, i, "D_UISEL", this and 1 or 0, true)
    end)
    local before = api.CountAutomationItems(env)
    api.Main_OnCommand(p.preservePoints and 42088 or M.DELETE_AUTOMATION_ITEMS, 0)
    -- Items after the deleted one on this envelope moved down one index
    for _, s in ipairs(sel) do
      local i = s[2]
      if s[1] == env and i > ai then i = i - 1 end
      api.GetSetAutomationItemInfo(s[1], i, "D_UISEL", s[3] and 1 or 0, true)
    end
    if api.CountAutomationItems(env) ~= before - 1 then return nil, "Internal error: the automation item was not deleted" end
    local r = target(p, -1)
    r.deleted, r.count = deleted, api.CountAutomationItems(env)
    return r
  end)
end

return M
