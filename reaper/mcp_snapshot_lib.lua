-- =============================================================================
-- MCP Snapshot Library — shared helpers for snapshot action scripts
-- =============================================================================
-- Loaded via dofile() by snapshot action scripts. Provides path resolution,
-- JSON parsing, snapshot listing, and restore logic.
-- =============================================================================

local M = {}

-- ExtState section for persisting current snapshot index across action calls
M.EXT_SECTION = "MCP_Snapshots"
M.EXT_KEY_IDX = "current_index"

-- =============================================================================
-- Path helpers
-- =============================================================================

function M.get_snapshot_dir()
  local proj_path = reaper.GetProjectPath()
  if proj_path and proj_path ~= "" then
    return proj_path .. "/.reaper-mcp/snapshots/"
  end
  return reaper.GetResourcePath() .. "/Scripts/mcp_bridge_data/snapshots/"
end

function M.ensure_snapshot_dir()
  reaper.RecursiveCreateDirectory(M.get_snapshot_dir(), 0)
end

function M.snapshot_path(name)
  local safe = name:gsub("[^%w%-_%.%s]", "_"):gsub("%s+", "_")
  return M.get_snapshot_dir() .. safe .. ".json"
end

-- =============================================================================
-- File I/O
-- =============================================================================

function M.read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

function M.write_file(path, content)
  local f = io.open(path, "wb")
  if not f then return false end
  f:write(content)
  f:close()
  return true
end

-- =============================================================================
-- Minimal JSON helpers
-- =============================================================================

local function json_encode_string(s)
  s = tostring(s)
  s = s:gsub('\\', '\\\\')
  s = s:gsub('"', '\\"')
  s = s:gsub('\n', '\\n')
  s = s:gsub('\r', '\\r')
  s = s:gsub('\t', '\\t')
  return '"' .. s .. '"'
end

function M.json_encode(val)
  local t = type(val)
  if t == "nil" then return "null"
  elseif t == "boolean" then return val and "true" or "false"
  elseif t == "number" then
    if val ~= val then return "null" end
    return tostring(val)
  elseif t == "string" then return json_encode_string(val)
  elseif t == "table" then
    local is_array = true
    local max_i = 0
    for k, _ in pairs(val) do
      if type(k) ~= "number" or k ~= math.floor(k) or k < 1 then
        is_array = false; break
      end
      if k > max_i then max_i = k end
    end
    if is_array and max_i == #val then
      local parts = {}
      for i = 1, #val do parts[i] = M.json_encode(val[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, v in pairs(val) do
        parts[#parts + 1] = json_encode_string(tostring(k)) .. ":" .. M.json_encode(v)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

local function extract_json_string(str, pos)
  local result = {}
  local i = pos
  while i <= #str do
    local ch = str:sub(i, i)
    if ch == '\\' then
      local next_ch = str:sub(i + 1, i + 1)
      if next_ch == '"' then result[#result + 1] = '"'
      elseif next_ch == '\\' then result[#result + 1] = '\\'
      elseif next_ch == 'n' then result[#result + 1] = '\n'
      elseif next_ch == 't' then result[#result + 1] = '\t'
      elseif next_ch == '/' then result[#result + 1] = '/'
      else result[#result + 1] = next_ch end
      i = i + 2
    elseif ch == '"' then
      return table.concat(result), i + 1
    else
      result[#result + 1] = ch
      i = i + 1
    end
  end
  return nil, i
end

function M.parse_flat_object(str)
  local obj = {}
  local i = 1
  while i <= #str do
    local key_start = str:find('"', i)
    if not key_start then break end
    local key, after_key = extract_json_string(str, key_start + 1)
    if not key then break end
    i = after_key
    local colon = str:find(':', i)
    if not colon then break end
    local val_start = str:match('^%s*()', colon + 1)
    local ch = str:sub(val_start, val_start)
    if ch == '"' then
      local val, next_pos = extract_json_string(str, val_start + 1)
      if val then obj[key] = val; i = next_pos
      else i = val_start + 1 end
    elseif ch == '{' or ch == '[' then
      local depth = 1
      local close_c = ch == '{' and '}' or ']'
      local j = val_start + 1
      while j <= #str and depth > 0 do
        local c = str:sub(j, j)
        if c == ch then depth = depth + 1
        elseif c == close_c then depth = depth - 1 end
        j = j + 1
      end
      i = j
    else
      local val_end = str:find('[,}%]]', val_start)
      if not val_end then val_end = #str + 1 end
      local raw = str:sub(val_start, val_end - 1):match("^%s*(.-)%s*$")
      if raw == "true" then obj[key] = true
      elseif raw == "false" then obj[key] = false
      elseif raw == "null" then obj[key] = nil
      else obj[key] = tonumber(raw) end
      i = val_end
    end
  end
  return obj
end

-- =============================================================================
-- Snapshot listing
-- =============================================================================

function M.load_snapshots()
  M.ensure_snapshot_dir()
  local snap_dir = M.get_snapshot_dir()
  local result = {}
  local i = 0
  while true do
    local fn = reaper.EnumerateFiles(snap_dir, i)
    if not fn then break end
    if fn:match("%.json$") then
      local path = snap_dir .. fn
      local content = M.read_file(path)
      if content then
        local ok, snap = pcall(M.parse_flat_object, content)
        if ok and snap and snap.name then
          result[#result + 1] = {
            name      = snap.name,
            timestamp = tonumber(snap.timestamp) or 0,
            path      = path,
          }
        end
      end
    end
    i = i + 1
  end
  table.sort(result, function(a, b) return a.timestamp > b.timestamp end)
  return result
end

-- =============================================================================
-- Restore logic
-- =============================================================================

function M.restore_snapshot(snap)
  local content = M.read_file(snap.path)
  if not content then return false, "File not found" end

  local mixer_block_start = content:find('"mixerState"%s*:%s*{')
  if not mixer_block_start then return false, "No mixerState" end

  local tracks_start = content:find('"tracks"%s*:%s*%[', mixer_block_start)
  if not tracks_start then return false, "No tracks" end

  local arr_open = content:find('%[', tracks_start)
  if not arr_open then return false, "Invalid format" end

  local track_objects = {}
  local depth = 0
  local obj_start = nil
  local i = arr_open
  while i <= #content do
    local ch = content:sub(i, i)
    if ch == '{' then
      depth = depth + 1
      if depth == 1 then obj_start = i end
    elseif ch == '}' then
      depth = depth - 1
      if depth == 0 and obj_start then
        track_objects[#track_objects + 1] = content:sub(obj_start, i)
        obj_start = nil
      end
    elseif ch == ']' and depth == 0 then break end
    i = i + 1
  end

  if #track_objects == 0 then return false, "No track data" end

  reaper.Undo_BeginBlock()
  local restored = 0
  for _, track_json in ipairs(track_objects) do
    local ok_t, td = pcall(M.parse_flat_object, track_json)
    if ok_t and td and td.index then
      local track = reaper.GetTrack(0, tonumber(td.index))
      if track then
        if td.volume then reaper.SetMediaTrackInfo_Value(track, "D_VOL", tonumber(td.volume)) end
        if td.pan then reaper.SetMediaTrackInfo_Value(track, "D_PAN", tonumber(td.pan)) end
        if td.mute ~= nil then
          reaper.SetMediaTrackInfo_Value(track, "B_MUTE", (td.mute == true or td.mute == "true") and 1 or 0)
        end
        if td.solo ~= nil then
          reaper.SetMediaTrackInfo_Value(track, "I_SOLO", (td.solo == true or td.solo == "true") and 1 or 0)
        end
        restored = restored + 1
      end
    end
  end
  reaper.Undo_EndBlock("MCP Snapshot: Restore '" .. snap.name .. "'", -1)
  reaper.TrackList_AdjustWindows(false)
  reaper.UpdateArrange()
  return true, nil, restored
end

-- =============================================================================
-- Capture mixer state
-- =============================================================================

function M.capture_mixer_state()
  local state = { version = 2, tracks = {} }
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(track)
    local vol  = reaper.GetMediaTrackInfo_Value(track, "D_VOL")
    local pan  = reaper.GetMediaTrackInfo_Value(track, "D_PAN")
    local mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE")
    local solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")
    local color = reaper.GetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR")

    local fx_count = reaper.TrackFX_GetCount(track)
    local fx_states = {}
    for j = 0, fx_count - 1 do
      local enabled = reaper.TrackFX_GetEnabled(track, j)
      local offline = reaper.TrackFX_GetOffline(track, j)
      local _, preset = reaper.TrackFX_GetPreset(track, j)
      local _, fx_name = reaper.TrackFX_GetFXName(track, j)
      local params_data = {}
      local param_count = reaper.TrackFX_GetNumParams(track, j)
      local limit = math.min(param_count, 500)
      for p = 0, limit - 1 do
        params_data[p + 1] = reaper.TrackFX_GetParam(track, j, p)
      end
      fx_states[j + 1] = {
        name = fx_name, enabled = enabled, offline = offline,
        preset = preset or "", params = params_data,
      }
    end

    local send_count = reaper.GetTrackNumSends(track, 0)
    local sends = {}
    for s = 0, send_count - 1 do
      local dest_track = reaper.GetTrackSendInfo_Value(track, 0, s, "P_DESTTRACK")
      local dest_idx = -1
      local dest_name = ""
      if dest_track then
        dest_idx = reaper.GetMediaTrackInfo_Value(dest_track, "IP_TRACKNUMBER") - 1
        local _, dname = reaper.GetTrackName(dest_track)
        dest_name = dname or ""
      end
      sends[s + 1] = {
        destTrackIndex = dest_idx, destTrackName = dest_name,
        volume = reaper.GetTrackSendInfo_Value(track, 0, s, "D_VOL"),
        pan    = reaper.GetTrackSendInfo_Value(track, 0, s, "D_PAN"),
        muted  = reaper.GetTrackSendInfo_Value(track, 0, s, "B_MUTE") ~= 0,
      }
    end

    local fx_enabled = {}
    for j = 1, #fx_states do fx_enabled[j] = fx_states[j].enabled end

    state.tracks[i + 1] = {
      index = i, name = name, color = color,
      volume = vol, pan = pan,
      mute = mute ~= 0, solo = solo ~= 0,
      fx = fx_states, sends = sends, fxEnabled = fx_enabled,
    }
  end
  return state
end

-- =============================================================================
-- Persisted index helpers
-- =============================================================================

function M.get_current_index()
  local val = reaper.GetExtState(M.EXT_SECTION, M.EXT_KEY_IDX)
  return tonumber(val) or 0
end

function M.set_current_index(idx)
  reaper.SetExtState(M.EXT_SECTION, M.EXT_KEY_IDX, tostring(idx), false)
end

-- =============================================================================
-- Toast message (brief console feedback)
-- =============================================================================

function M.toast(msg)
  reaper.Help_Set(msg, false)
end

return M
