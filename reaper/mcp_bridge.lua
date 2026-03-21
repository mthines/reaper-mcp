-- =============================================================================
-- MCP Bridge for REAPER
-- =============================================================================
-- This script runs as a persistent defer loop inside REAPER.
-- It polls a bridge directory for JSON command files from the MCP server,
-- executes the corresponding ReaScript API calls, and writes response files.
--
-- Install: Actions > Show action list > Load ReaScript > select this file > Run
-- The script will keep running in the background via defer().
-- =============================================================================

local POLL_INTERVAL = 0.030 -- 30ms between polls
local HEARTBEAT_INTERVAL = 1.0 -- write heartbeat every 1s
local MCP_ANALYZER_FX_NAME = "mcp_analyzer" -- JSFX analyzer name

-- Determine bridge directory (REAPER resource path / Scripts / mcp_bridge_data)
local bridge_dir = reaper.GetResourcePath() .. "/Scripts/mcp_bridge_data/"

-- Ensure bridge directory exists
reaper.RecursiveCreateDirectory(bridge_dir, 0)

local last_poll = 0
local last_heartbeat = 0

-- =============================================================================
-- JSON Parser (minimal, sufficient for our command format)
-- =============================================================================

-- Helper: extract a JSON string value starting at pos (after the opening quote).
-- Handles escaped quotes (\") and other escape sequences.
local function extract_json_string(str, pos)
  local result = {}
  local i = pos
  while i <= #str do
    local ch = str:sub(i, i)
    if ch == '\\' then
      local next_ch = str:sub(i + 1, i + 1)
      if next_ch == '"' then
        result[#result + 1] = '"'
      elseif next_ch == '\\' then
        result[#result + 1] = '\\'
      elseif next_ch == 'n' then
        result[#result + 1] = '\n'
      elseif next_ch == 't' then
        result[#result + 1] = '\t'
      elseif next_ch == '/' then
        result[#result + 1] = '/'
      else
        result[#result + 1] = next_ch
      end
      i = i + 2
    elseif ch == '"' then
      return table.concat(result), i + 1  -- return string and position after closing quote
    else
      result[#result + 1] = ch
      i = i + 1
    end
  end
  return nil, i  -- unterminated string
end

-- Parse a flat JSON object with string/number values in params.
-- Handles escaped quotes in string values (e.g. JSON arrays passed as strings).
local function parse_flat_object(str)
  local obj = {}
  local i = 1
  while i <= #str do
    -- Find a key
    local key_start = str:find('"', i)
    if not key_start then break end
    local key_end = str:find('"', key_start + 1)
    if not key_end then break end
    local key = str:sub(key_start + 1, key_end - 1)

    -- Find the colon
    local colon = str:find(':', key_end + 1)
    if not colon then break end

    -- Skip whitespace after colon
    local val_start = str:match('^%s*()', colon + 1)

    local ch = str:sub(val_start, val_start)
    if ch == '"' then
      -- String value (handles escaped quotes)
      local val, next_pos = extract_json_string(str, val_start + 1)
      if val then
        obj[key] = val
        i = next_pos
      else
        i = val_start + 1
      end
    elseif ch == '{' then
      -- Nested object — extract with balanced braces
      local nested = str:match('%b{}', val_start)
      if nested then
        obj[key] = parse_flat_object(nested)
        i = val_start + #nested
      else
        i = val_start + 1
      end
    elseif ch == '[' then
      -- Array — extract with balanced brackets
      local arr = str:match('%b[]', val_start)
      if arr then
        obj[key] = arr  -- keep as string for json_decode_array to parse later
        i = val_start + #arr
      else
        i = val_start + 1
      end
    elseif ch:match('[%d%-]') then
      -- Number
      local num_str = str:match('-?%d+%.?%d*', val_start)
      if num_str then
        obj[key] = tonumber(num_str)
        i = val_start + #num_str
      else
        i = val_start + 1
      end
    elseif str:sub(val_start, val_start + 3) == 'true' then
      obj[key] = true
      i = val_start + 4
    elseif str:sub(val_start, val_start + 4) == 'false' then
      obj[key] = false
      i = val_start + 5
    elseif str:sub(val_start, val_start + 3) == 'null' then
      i = val_start + 4
    else
      i = val_start + 1
    end
  end
  return obj
end

local function json_decode(str)
  -- Use REAPER 7+ built-in JSON if available, otherwise basic parser
  if reaper.CF_Json_Parse then
    local ok, val = reaper.CF_Json_Parse(str)
    if ok then return val end
  end

  -- Fallback: parse the command JSON using our robust parser
  -- that handles escaped quotes in string values (needed for batch commands)
  return parse_flat_object(str)
end

-- Parse a JSON array of objects. Accepts either a Lua table (already parsed by
-- CF_Json_Parse) or a JSON string. Falls back to extracting each {...} and
-- parsing with parse_flat_object.
local function json_decode_array(input)
  -- If already a table (e.g. CF_Json_Parse decoded it), return directly
  if type(input) == "table" then return input end
  if type(input) ~= "string" then return nil end

  if reaper.CF_Json_Parse then
    local ok, val = reaper.CF_Json_Parse(input)
    if ok then return val end
  end

  -- Fallback: extract each {...} from the array and parse individually
  local arr = {}
  for obj_str in input:gmatch("%b{}") do
    arr[#arr + 1] = parse_flat_object(obj_str)
  end
  if #arr > 0 then return arr end
  return nil
end

local function json_encode(obj)
  -- Simple JSON encoder for our response objects
  local parts = {}
  local function encode_value(v)
    local t = type(v)
    if t == "string" then
      return '"' .. v:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n') .. '"'
    elseif t == "number" then
      if v ~= v then return "null" end -- NaN
      if v == math.huge or v == -math.huge then return "null" end
      return tostring(v)
    elseif t == "boolean" then
      return tostring(v)
    elseif t == "table" then
      -- Check if array or object
      if #v > 0 or next(v) == nil then
        -- Array (or empty table treated as empty array)
        local items = {}
        for i, item in ipairs(v) do
          items[i] = encode_value(item)
        end
        return "[" .. table.concat(items, ",") .. "]"
      else
        -- Object
        local items = {}
        for k, val in pairs(v) do
          items[#items + 1] = '"' .. tostring(k) .. '":' .. encode_value(val)
        end
        return "{" .. table.concat(items, ",") .. "}"
      end
    elseif t == "nil" then
      return "null"
    end
    return "null"
  end
  return encode_value(obj)
end

-- =============================================================================
-- File I/O helpers
-- =============================================================================

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

local function write_file(path, content)
  local f = io.open(path, "w")
  if not f then return false end
  f:write(content)
  f:close()
  return true
end

local function file_exists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

local function list_files(dir, prefix)
  local files = {}
  local i = 0
  while true do
    local fn = reaper.EnumerateFiles(dir, i)
    if not fn then break end
    if prefix and fn:sub(1, #prefix) == prefix then
      files[#files + 1] = fn
    end
    i = i + 1
  end
  return files
end

-- =============================================================================
-- dB conversion helpers
-- =============================================================================

local function to_db(val)
  if val <= 0 then return -150.0 end
  return 20 * math.log(val, 10)
end

local function from_db(db)
  return 10 ^ (db / 20)
end

-- =============================================================================
-- Command handlers
-- =============================================================================

local handlers = {}

function handlers.get_project_info(params)
  local _, proj_name = reaper.EnumProjects(-1)
  local proj_path = reaper.GetProjectPath()
  local track_count = reaper.CountTracks(0)
  local tempo = reaper.Master_GetTempo()
  local _, ts_num, ts_den = reaper.TimeMap_GetTimeSigAtTime(0, 0)
  local sr = reaper.GetSetProjectInfo(0, "PROJECT_SRATE", 0, false)
  local play_state = reaper.GetPlayState() -- 0=stopped, 1=playing, 2=paused, 4=recording
  local cursor_pos = reaper.GetCursorPosition()

  return {
    name = proj_name or "",
    path = proj_path or "",
    trackCount = track_count,
    tempo = tempo,
    timeSignatureNumerator = ts_num,
    timeSignatureDenominator = ts_den,
    sampleRate = sr,
    isPlaying = (play_state & 1) ~= 0,
    isRecording = (play_state & 4) ~= 0,
    cursorPosition = cursor_pos,
  }
end

function handlers.list_tracks(params)
  local tracks = {}
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(track)
    local vol = reaper.GetMediaTrackInfo_Value(track, "D_VOL")
    local pan = reaper.GetMediaTrackInfo_Value(track, "D_PAN")
    local mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE")
    local solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")
    local fx_count = reaper.TrackFX_GetCount(track)
    local depth = reaper.GetMediaTrackInfo_Value(track, "I_FOLDERDEPTH")
    local parent = reaper.GetParentTrack(track)
    local parent_idx = -1
    if parent then
      parent_idx = reaper.GetMediaTrackInfo_Value(parent, "IP_TRACKNUMBER") - 1
    end
    local color = reaper.GetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR")

    local rec_arm = reaper.GetMediaTrackInfo_Value(track, "I_RECARM")
    local phase = reaper.GetMediaTrackInfo_Value(track, "B_PHASE")
    local input_ch = reaper.GetMediaTrackInfo_Value(track, "I_RECINPUT")

    tracks[#tracks + 1] = {
      index = i,
      name = name,
      volume = to_db(vol),
      volumeRaw = vol,
      pan = pan,
      mute = mute ~= 0,
      solo = solo ~= 0,
      recordArm = rec_arm ~= 0,
      phase = phase ~= 0,
      inputChannel = input_ch,
      fxCount = fx_count,
      receiveCount = reaper.GetTrackNumSends(track, -1),
      sendCount = reaper.GetTrackNumSends(track, 0),
      depth = depth,
      parentIndex = parent_idx,
      color = color,
    }
  end
  return tracks
end

function handlers.get_track_properties(params)
  local idx = params.trackIndex
  if not idx then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local _, name = reaper.GetTrackName(track)
  local vol = reaper.GetMediaTrackInfo_Value(track, "D_VOL")
  local pan = reaper.GetMediaTrackInfo_Value(track, "D_PAN")
  local mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE")
  local solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")
  local fx_count = reaper.TrackFX_GetCount(track)
  local depth = reaper.GetMediaTrackInfo_Value(track, "I_FOLDERDEPTH")
  local parent = reaper.GetParentTrack(track)
  local parent_idx = -1
  if parent then
    parent_idx = reaper.GetMediaTrackInfo_Value(parent, "IP_TRACKNUMBER") - 1
  end
  local color = reaper.GetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR")

  -- Build FX list
  local fx_list = {}
  for i = 0, fx_count - 1 do
    local _, fx_name = reaper.TrackFX_GetFXName(track, i)
    local enabled = reaper.TrackFX_GetEnabled(track, i)
    local offline = reaper.TrackFX_GetOffline(track, i)
    local _, preset = reaper.TrackFX_GetPreset(track, i)
    fx_list[#fx_list + 1] = {
      index = i,
      name = fx_name,
      enabled = enabled,
      offline = offline,
      preset = preset or "",
    }
  end

  local rec_arm = reaper.GetMediaTrackInfo_Value(track, "I_RECARM")
  local phase = reaper.GetMediaTrackInfo_Value(track, "B_PHASE")
  local input_ch = reaper.GetMediaTrackInfo_Value(track, "I_RECINPUT")

  return {
    index = idx,
    name = name,
    volume = to_db(vol),
    volumeRaw = vol,
    pan = pan,
    mute = mute ~= 0,
    solo = solo ~= 0,
    recordArm = rec_arm ~= 0,
    phase = phase ~= 0,
    inputChannel = input_ch,
    fxCount = fx_count,
    receiveCount = reaper.GetTrackNumSends(track, -1),
    sendCount = reaper.GetTrackNumSends(track, 0),
    depth = depth,
    parentIndex = parent_idx,
    color = color,
    fxList = fx_list,
  }
end

function handlers.set_track_property(params)
  local idx = params.trackIndex
  local prop = params.property
  local value = params.value
  if not idx or not prop or not value then
    return nil, "trackIndex, property, and value required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  if prop == "volume" then
    reaper.SetMediaTrackInfo_Value(track, "D_VOL", from_db(value))
  elseif prop == "pan" then
    reaper.SetMediaTrackInfo_Value(track, "D_PAN", value)
  elseif prop == "mute" then
    reaper.SetMediaTrackInfo_Value(track, "B_MUTE", value)
  elseif prop == "solo" then
    reaper.SetMediaTrackInfo_Value(track, "I_SOLO", value)
  elseif prop == "recordArm" then
    reaper.SetMediaTrackInfo_Value(track, "I_RECARM", value)
  elseif prop == "phase" then
    reaper.SetMediaTrackInfo_Value(track, "B_PHASE", value)
  elseif prop == "input" then
    reaper.SetMediaTrackInfo_Value(track, "I_RECINPUT", value)
  else
    return nil, "Unknown property: " .. tostring(prop)
  end

  return { success = true, trackIndex = idx, property = prop, value = value }
end

function handlers.add_fx(params)
  local idx = params.trackIndex
  local fx_name = params.fxName
  if not idx or not fx_name then
    return nil, "trackIndex and fxName required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local position = params.position or -1
  local fx_idx = reaper.TrackFX_AddByName(track, fx_name, false, position)
  if fx_idx < 0 then
    return nil, "FX not found: " .. fx_name
  end

  local _, actual_name = reaper.TrackFX_GetFXName(track, fx_idx)
  return {
    fxIndex = fx_idx,
    fxName = actual_name,
    trackIndex = idx,
  }
end

function handlers.remove_fx(params)
  local idx = params.trackIndex
  local fx_idx = params.fxIndex
  if not idx or not fx_idx then
    return nil, "trackIndex and fxIndex required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local ok = reaper.TrackFX_Delete(track, fx_idx)
  if not ok then
    return nil, "Failed to remove FX " .. fx_idx .. " from track " .. idx
  end

  return { success = true, trackIndex = idx, fxIndex = fx_idx }
end

function handlers.get_fx_parameters(params)
  local idx = params.trackIndex
  local fx_idx = params.fxIndex
  if not idx or not fx_idx then
    return nil, "trackIndex and fxIndex required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local param_count = reaper.TrackFX_GetNumParams(track, fx_idx)
  local parameters = {}

  for p = 0, param_count - 1 do
    local _, pname = reaper.TrackFX_GetParamName(track, fx_idx, p)
    local val, min_val, max_val = reaper.TrackFX_GetParam(track, fx_idx, p)
    local _, formatted = reaper.TrackFX_GetFormattedParamValue(track, fx_idx, p)

    parameters[#parameters + 1] = {
      index = p,
      name = pname,
      value = val,
      formattedValue = formatted or "",
      minValue = min_val,
      maxValue = max_val,
    }
  end

  return {
    trackIndex = idx,
    fxIndex = fx_idx,
    parameterCount = param_count,
    parameters = parameters,
  }
end

function handlers.set_fx_parameter(params)
  local idx = params.trackIndex
  local fx_idx = params.fxIndex
  local param_idx = params.paramIndex
  local value = params.value
  if not idx or not fx_idx or not param_idx or not value then
    return nil, "trackIndex, fxIndex, paramIndex, and value required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local ok = reaper.TrackFX_SetParam(track, fx_idx, param_idx, value)
  if not ok then
    return nil, "Failed to set param " .. param_idx .. " on FX " .. fx_idx
  end

  return { success = true, trackIndex = idx, fxIndex = fx_idx, paramIndex = param_idx, value = value }
end

function handlers.set_fx_enabled(params)
  local idx = params.trackIndex
  local fx_idx = params.fxIndex
  local enabled = params.enabled
  if idx == nil or fx_idx == nil or enabled == nil then
    return nil, "trackIndex, fxIndex, and enabled required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local fx_count = reaper.TrackFX_GetCount(track)
  if fx_idx >= fx_count then
    return nil, "FX " .. fx_idx .. " not found (track has " .. fx_count .. " FX)"
  end

  reaper.TrackFX_SetEnabled(track, fx_idx, enabled ~= 0)
  return { success = true, trackIndex = idx, fxIndex = fx_idx, enabled = enabled ~= 0 }
end

function handlers.set_fx_offline(params)
  local idx = params.trackIndex
  local fx_idx = params.fxIndex
  local offline = params.offline
  if idx == nil or fx_idx == nil or offline == nil then
    return nil, "trackIndex, fxIndex, and offline required"
  end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local fx_count = reaper.TrackFX_GetCount(track)
  if fx_idx >= fx_count then
    return nil, "FX " .. fx_idx .. " not found (track has " .. fx_count .. " FX)"
  end

  reaper.TrackFX_SetOffline(track, fx_idx, offline ~= 0)
  return { success = true, trackIndex = idx, fxIndex = fx_idx, offline = offline ~= 0 }
end

function handlers.read_track_meters(params)
  local idx = params.trackIndex
  if not idx then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local peak_l = reaper.Track_GetPeakInfo(track, 0) -- channel 0 = left
  local peak_r = reaper.Track_GetPeakInfo(track, 1) -- channel 1 = right

  -- RMS is available via D_VOL peak hold with mode flags
  -- For simplicity, use peak values (RMS requires more complex metering)
  return {
    trackIndex = idx,
    peakL = to_db(peak_l),
    peakR = to_db(peak_r),
    rmsL = to_db(peak_l * 0.707), -- approximate RMS from peak
    rmsR = to_db(peak_r * 0.707),
  }
end

function handlers.read_track_spectrum(params)
  local idx = params.trackIndex
  if not idx then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  -- Check if MCP analyzer JSFX is already on the track
  local analyzer_idx = -1
  local fx_count = reaper.TrackFX_GetCount(track)
  for i = 0, fx_count - 1 do
    local _, name = reaper.TrackFX_GetFXName(track, i)
    if name and name:find(MCP_ANALYZER_FX_NAME) then
      analyzer_idx = i
      break
    end
  end

  -- Auto-insert if not present
  if analyzer_idx < 0 then
    analyzer_idx = reaper.TrackFX_AddByName(track, MCP_ANALYZER_FX_NAME, false, -1)
    if analyzer_idx < 0 then
      return nil, "MCP Spectrum Analyzer JSFX not found. Run 'reaper-mcp setup' to install it."
    end
  end

  -- Read spectrum data from gmem
  -- JSFX writes: gmem[0] = bin_count, gmem[1] = peak_db, gmem[2] = rms_db, gmem[3..] = bins
  reaper.gmem_attach("MCPAnalyzer")

  local bin_count = reaper.gmem_read(0)
  if bin_count <= 0 then
    return nil, "Spectrum analyzer not producing data yet. Ensure audio is playing."
  end

  local peak_db = reaper.gmem_read(1)
  local rms_db = reaper.gmem_read(2)
  local sr = reaper.GetSetProjectInfo(0, "PROJECT_SRATE", 0, false)
  local fft_size = params.fftSize or 4096

  local bins = {}
  for i = 0, bin_count - 1 do
    bins[#bins + 1] = reaper.gmem_read(3 + i)
  end

  return {
    trackIndex = idx,
    fftSize = fft_size,
    sampleRate = sr,
    binCount = bin_count,
    frequencyResolution = sr / fft_size,
    peakDb = peak_db,
    rmsDb = rms_db,
    bins = bins,
  }
end

-- =============================================================================
-- Transport handlers
-- =============================================================================

function handlers.play(params)
  -- Action 1007 = Transport: Play
  reaper.Main_OnCommand(1007, 0)
  return { success = true }
end

function handlers.stop(params)
  -- Action 1016 = Transport: Stop
  reaper.Main_OnCommand(1016, 0)
  return { success = true }
end

function handlers.record(params)
  -- Action 1013 = Transport: Record
  reaper.Main_OnCommand(1013, 0)
  return { success = true }
end

function handlers.get_transport_state(params)
  local play_state = reaper.GetPlayState() -- 0=stopped, 1=playing, 2=paused, 4=recording, 5=recording+playing
  local cursor_pos = reaper.GetCursorPosition()
  local play_pos = reaper.GetPlayPosition()
  local tempo = reaper.Master_GetTempo()
  local _, ts_num, ts_den = reaper.TimeMap_GetTimeSigAtTime(0, 0)

  return {
    playing = (play_state & 1) ~= 0,
    recording = (play_state & 4) ~= 0,
    paused = (play_state & 2) ~= 0,
    cursorPosition = cursor_pos,
    playPosition = play_pos,
    tempo = tempo,
    timeSignatureNumerator = ts_num,
    timeSignatureDenominator = ts_den,
  }
end

function handlers.set_cursor_position(params)
  local pos = params.position
  if not pos then return nil, "position required" end
  if pos < 0 then pos = 0 end
  reaper.SetEditCurPos(pos, true, false) -- moveview=true, seekplay=false
  return { success = true, position = pos }
end

-- =============================================================================
-- Phase 1: Mix agent handlers
-- =============================================================================

-- Helper: detect FX type prefix from name
local function fx_type_from_name(name)
  if name:match("^VST3:") then return "VST3"
  elseif name:match("^VST:") then return "VST"
  elseif name:match("^JS:") then return "JS"
  elseif name:match("^AU:") then return "AU"
  elseif name:match("^CLAP:") then return "CLAP"
  else return "JS" end  -- default for bare JSFX names
end

-- Enumerate all installed FX using SWS CF_EnumerateInstalledFX if available,
-- otherwise fall back to scanning open projects via TrackFX_AddByName probe.
-- The SWS approach is preferred and more complete.
function handlers.list_available_fx(params)
  local category_filter = params.category
  local fx_list = {}

  -- Try SWS CF_EnumerateInstalledFX (requires SWS extension)
  if reaper.CF_EnumerateInstalledFX then
    local i = 0
    while true do
      local ok, name, ident = reaper.CF_EnumerateInstalledFX(i)
      if not ok then break end
      local fx_type = fx_type_from_name(name)
      if not category_filter or fx_type:lower() == category_filter:lower() then
        fx_list[#fx_list + 1] = {
          name = name,
          type = fx_type,
          path = ident or "",
        }
      end
      i = i + 1
    end
    return { fxList = fx_list, total = #fx_list, source = "sws" }
  end

  -- Fallback: parse reaper-fxfolders.ini for plugin names
  local resource_path = reaper.GetResourcePath()
  local ini_path = resource_path .. "/reaper-fxfolders.ini"
  local content = read_file(ini_path)
  if content then
    for line in content:gmatch("[^\r\n]+") do
      local name = line:match("^Item%d+=(.+)$")
      if name and name ~= "" then
        local fx_type = fx_type_from_name(name)
        if not category_filter or fx_type:lower() == category_filter:lower() then
          fx_list[#fx_list + 1] = { name = name, type = fx_type }
        end
      end
    end
    return { fxList = fx_list, total = #fx_list, source = "fxfolders_ini" }
  end

  return { fxList = fx_list, total = 0, source = "none",
           warning = "SWS not installed and reaper-fxfolders.ini not found. Install SWS Extensions for full FX enumeration." }
end

function handlers.search_fx(params)
  local query = params.query
  if not query or query == "" then
    return nil, "query required"
  end

  -- Get full list first (reuse list_available_fx logic)
  local all_result = handlers.list_available_fx({})
  local matches = {}
  local q_lower = query:lower()

  for _, fx in ipairs(all_result.fxList) do
    if fx.name:lower():find(q_lower, 1, true) then
      matches[#matches + 1] = fx
    end
  end

  return { query = query, matches = matches, total = #matches }
end

function handlers.get_fx_preset_list(params)
  local track_idx = params.trackIndex
  local fx_idx = params.fxIndex
  if track_idx == nil or fx_idx == nil then
    return nil, "trackIndex and fxIndex required"
  end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, "Track " .. track_idx .. " not found" end

  local preset_count = reaper.TrackFX_GetPresetIndex(track, fx_idx)
  local presets = {}

  -- TrackFX_GetPresetIndex returns current index and total count
  -- We iterate by cycling through presets
  local _, total = reaper.TrackFX_GetPresetIndex(track, fx_idx)
  if total and total > 0 then
    for i = 0, total - 1 do
      reaper.TrackFX_SetPresetByIndex(track, fx_idx, i)
      local _, preset_name = reaper.TrackFX_GetPreset(track, fx_idx)
      presets[#presets + 1] = { index = i, name = preset_name or ("Preset " .. i) }
    end
    -- Restore original preset
    reaper.TrackFX_SetPresetByIndex(track, fx_idx, preset_count)
  else
    -- Plugin doesn't report preset count; return current preset only
    local _, current_preset = reaper.TrackFX_GetPreset(track, fx_idx)
    if current_preset and current_preset ~= "" then
      presets[#presets + 1] = { index = 0, name = current_preset }
    end
  end

  return { trackIndex = track_idx, fxIndex = fx_idx, presets = presets, total = #presets }
end

function handlers.set_fx_preset(params)
  local track_idx = params.trackIndex
  local fx_idx = params.fxIndex
  local preset_name = params.presetName
  if track_idx == nil or fx_idx == nil or not preset_name then
    return nil, "trackIndex, fxIndex, and presetName required"
  end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, "Track " .. track_idx .. " not found" end

  -- TrackFX_SetPreset returns true on success
  local ok = reaper.TrackFX_SetPreset(track, fx_idx, preset_name)
  if not ok then
    return nil, "Preset not found: " .. preset_name
  end

  local _, applied = reaper.TrackFX_GetPreset(track, fx_idx)
  return { success = true, trackIndex = track_idx, fxIndex = fx_idx, presetName = applied or preset_name }
end

-- =============================================================================
-- Snapshot handlers
-- =============================================================================

local function get_snapshot_dir()
  return bridge_dir .. "snapshots/"
end

local function ensure_snapshot_dir()
  reaper.RecursiveCreateDirectory(get_snapshot_dir(), 0)
end

local function snapshot_path(name)
  -- Sanitize name for filesystem
  local safe = name:gsub("[^%w%-_%.%s]", "_"):gsub("%s+", "_")
  return get_snapshot_dir() .. safe .. ".json"
end

local function capture_mixer_state()
  local state = { tracks = {} }
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(track)
    local vol = reaper.GetMediaTrackInfo_Value(track, "D_VOL")
    local pan = reaper.GetMediaTrackInfo_Value(track, "D_PAN")
    local mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE")
    local solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")

    -- Capture FX bypass states
    local fx_count = reaper.TrackFX_GetCount(track)
    local fx_states = {}
    for j = 0, fx_count - 1 do
      fx_states[#fx_states + 1] = reaper.TrackFX_GetEnabled(track, j)
    end

    state.tracks[#state.tracks + 1] = {
      index = i,
      name = name,
      volume = vol,
      pan = pan,
      mute = mute ~= 0,
      solo = solo ~= 0,
      fxEnabled = fx_states,
    }
  end
  return state
end

function handlers.snapshot_save(params)
  local name = params.name
  if not name or name == "" then
    return nil, "name required"
  end

  ensure_snapshot_dir()

  local timestamp = os.time() * 1000
  local snapshot = {
    name = name,
    description = params.description or "",
    timestamp = timestamp,
    mixerState = capture_mixer_state(),
  }

  local path = snapshot_path(name)
  local ok = write_file(path, json_encode(snapshot))
  if not ok then
    return nil, "Failed to write snapshot file: " .. path
  end

  return { success = true, name = name, timestamp = timestamp, path = path }
end

function handlers.snapshot_restore(params)
  local name = params.name
  if not name or name == "" then
    return nil, "name required"
  end

  local path = snapshot_path(name)
  local content = read_file(path)
  if not content then
    return nil, "Snapshot not found: " .. name
  end

  local snapshot = json_decode(content)
  if not snapshot or not snapshot.mixerState then
    return nil, "Invalid snapshot file for: " .. name
  end

  -- Restore each track state
  local restored = 0
  local state = snapshot.mixerState
  if state.tracks then
    for _, track_state in ipairs(state.tracks) do
      local track = reaper.GetTrack(0, track_state.index)
      if track then
        reaper.SetMediaTrackInfo_Value(track, "D_VOL", track_state.volume)
        reaper.SetMediaTrackInfo_Value(track, "D_PAN", track_state.pan)
        reaper.SetMediaTrackInfo_Value(track, "B_MUTE", track_state.mute and 1 or 0)
        reaper.SetMediaTrackInfo_Value(track, "I_SOLO", track_state.solo and 1 or 0)

        -- Restore FX bypass states
        if track_state.fxEnabled then
          for j, enabled in ipairs(track_state.fxEnabled) do
            local fx_idx = j - 1  -- convert to 0-based
            if fx_idx < reaper.TrackFX_GetCount(track) then
              reaper.TrackFX_SetEnabled(track, fx_idx, enabled)
            end
          end
        end
        restored = restored + 1
      end
    end
  end

  reaper.TrackList_AdjustWindows(false)
  reaper.UpdateArrange()

  return {
    success = true,
    name = name,
    timestamp = snapshot.timestamp,
    tracksRestored = restored,
  }
end

function handlers.snapshot_list(params)
  ensure_snapshot_dir()
  local snap_dir = get_snapshot_dir()
  local snapshots = {}

  local i = 0
  while true do
    local fn = reaper.EnumerateFiles(snap_dir, i)
    if not fn then break end
    if fn:match("%.json$") then
      local content = read_file(snap_dir .. fn)
      if content then
        local snap = json_decode(content)
        if snap and snap.name then
          snapshots[#snapshots + 1] = {
            name = snap.name,
            description = snap.description or "",
            timestamp = snap.timestamp or 0,
          }
        end
      end
    end
    i = i + 1
  end

  -- Sort by timestamp descending (newest first)
  table.sort(snapshots, function(a, b) return a.timestamp > b.timestamp end)

  return { snapshots = snapshots, total = #snapshots }
end

-- =============================================================================
-- Routing handler
-- =============================================================================

function handlers.get_track_routing(params)
  local track_idx = params.trackIndex
  if track_idx == nil then
    return nil, "trackIndex required"
  end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, "Track " .. track_idx .. " not found" end

  -- Sends (category 0)
  local send_count = reaper.GetTrackNumSends(track, 0)
  local sends = {}
  for i = 0, send_count - 1 do
    local dest_track = reaper.GetTrackSendInfo_Value(track, 0, i, "P_DESTTRACK")
    local dest_idx = -1
    local dest_name = ""
    if dest_track then
      dest_idx = reaper.GetMediaTrackInfo_Value(dest_track, "IP_TRACKNUMBER") - 1
      local _, dname = reaper.GetTrackName(dest_track)
      dest_name = dname or ""
    end
    local send_vol = reaper.GetTrackSendInfo_Value(track, 0, i, "D_VOL")
    local send_pan = reaper.GetTrackSendInfo_Value(track, 0, i, "D_PAN")
    local send_mute = reaper.GetTrackSendInfo_Value(track, 0, i, "B_MUTE")
    sends[#sends + 1] = {
      destTrackIndex = dest_idx,
      destTrackName = dest_name,
      volume = to_db(send_vol),
      pan = send_pan,
      muted = send_mute ~= 0,
    }
  end

  -- Receives (category -1)
  local recv_count = reaper.GetTrackNumSends(track, -1)
  local receives = {}
  for i = 0, recv_count - 1 do
    local src_track = reaper.GetTrackSendInfo_Value(track, -1, i, "P_SRCTRACK")
    local src_idx = -1
    local src_name = ""
    if src_track then
      src_idx = reaper.GetMediaTrackInfo_Value(src_track, "IP_TRACKNUMBER") - 1
      local _, sname = reaper.GetTrackName(src_track)
      src_name = sname or ""
    end
    local recv_vol = reaper.GetTrackSendInfo_Value(track, -1, i, "D_VOL")
    local recv_pan = reaper.GetTrackSendInfo_Value(track, -1, i, "D_PAN")
    local recv_mute = reaper.GetTrackSendInfo_Value(track, -1, i, "B_MUTE")
    receives[#receives + 1] = {
      srcTrackIndex = src_idx,
      srcTrackName = src_name,
      volume = to_db(recv_vol),
      pan = recv_pan,
      muted = recv_mute ~= 0,
    }
  end

  local parent = reaper.GetParentTrack(track)
  local parent_idx = -1
  if parent then
    parent_idx = reaper.GetMediaTrackInfo_Value(parent, "IP_TRACKNUMBER") - 1
  end

  local folder_depth = reaper.GetMediaTrackInfo_Value(track, "I_FOLDERDEPTH")

  return {
    trackIndex = track_idx,
    sends = sends,
    receives = receives,
    parentTrackIndex = parent_idx,
    isFolder = folder_depth > 0,
    folderDepth = folder_depth,
  }
end

-- =============================================================================
-- Phase 4: Custom JSFX analyzer handlers
-- =============================================================================

local MCP_LUFS_METER_FX_NAME        = "mcp_lufs_meter"
local MCP_CORRELATION_METER_FX_NAME = "mcp_correlation_meter"
local MCP_CREST_FACTOR_FX_NAME      = "mcp_crest_factor"

-- Helper: find or auto-insert a named JSFX on a track.
-- Returns the FX index (0-based) on success, or nil + error message on failure.
local function ensure_jsfx_on_track(track, fx_name)
  local fx_count = reaper.TrackFX_GetCount(track)
  for i = 0, fx_count - 1 do
    local _, name = reaper.TrackFX_GetFXName(track, i)
    if name and name:find(fx_name, 1, true) then
      return i
    end
  end
  -- Auto-insert
  local idx = reaper.TrackFX_AddByName(track, fx_name, false, -1)
  if idx < 0 then
    return nil, fx_name .. " JSFX not found. Run 'reaper-mcp setup' to install it."
  end
  return idx
end

function handlers.read_track_lufs(params)
  local idx = params.trackIndex
  if idx == nil then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local fx_idx, err = ensure_jsfx_on_track(track, MCP_LUFS_METER_FX_NAME)
  if not fx_idx then return nil, err end

  -- Set the track_slot parameter (slider2, param index 1) so this instance
  -- writes to a unique gmem offset and doesn't collide with other tracks
  reaper.TrackFX_SetParam(track, fx_idx, 1, idx / 127)

  -- Attach to the LUFS meter gmem namespace and read from track-specific offset
  reaper.gmem_attach("MCPLufsMeter")

  local base = idx * 8
  local integrated  = reaper.gmem_read(base + 0)
  local short_term  = reaper.gmem_read(base + 1)
  local momentary   = reaper.gmem_read(base + 2)
  local true_peak_l = reaper.gmem_read(base + 3)
  local true_peak_r = reaper.gmem_read(base + 4)
  local duration    = reaper.gmem_read(base + 5)

  return {
    trackIndex  = idx,
    integrated  = integrated,
    shortTerm   = short_term,
    momentary   = momentary,
    truePeakL   = true_peak_l,
    truePeakR   = true_peak_r,
    duration    = duration,
    measuring   = duration > 0,
  }
end

function handlers.read_track_correlation(params)
  local idx = params.trackIndex
  if idx == nil then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local fx_idx, err = ensure_jsfx_on_track(track, MCP_CORRELATION_METER_FX_NAME)
  if not fx_idx then return nil, err end

  reaper.gmem_attach("MCPCorrelationMeter")

  local correlation  = reaper.gmem_read(0)
  local stereo_width = reaper.gmem_read(1)
  local mid_level    = reaper.gmem_read(2)
  local side_level   = reaper.gmem_read(3)

  return {
    trackIndex   = idx,
    correlation  = correlation,
    stereoWidth  = stereo_width,
    midLevel     = mid_level,
    sideLevel    = side_level,
  }
end

function handlers.read_track_crest(params)
  local idx = params.trackIndex
  if idx == nil then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local fx_idx, err = ensure_jsfx_on_track(track, MCP_CREST_FACTOR_FX_NAME)
  if not fx_idx then return nil, err end

  reaper.gmem_attach("MCPCrestFactor")

  local crest_factor = reaper.gmem_read(0)
  local peak_level   = reaper.gmem_read(1)
  local rms_level    = reaper.gmem_read(2)

  return {
    trackIndex   = idx,
    crestFactor  = crest_factor,
    peakLevel    = peak_level,
    rmsLevel     = rms_level,
  }
end

-- =============================================================================
-- MIDI editing handlers
-- =============================================================================

-- Helper: get a MIDI take from track/item indices, with validation
local function get_midi_take(params)
  local track_idx = params.trackIndex
  local item_idx = params.itemIndex
  if track_idx == nil then return nil, nil, nil, "trackIndex required" end
  if item_idx == nil then return nil, nil, nil, "itemIndex required" end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, nil, nil, "Track " .. track_idx .. " not found" end

  local item_count = reaper.CountTrackMediaItems(track)
  if item_idx >= item_count then
    return nil, nil, nil, "Item " .. item_idx .. " not found (track has " .. item_count .. " items)"
  end

  local item = reaper.GetTrackMediaItem(track, item_idx)
  if not item then return nil, nil, nil, "Item " .. item_idx .. " not found" end

  local take = reaper.GetActiveTake(item)
  if not take then return nil, nil, nil, "Item has no active take" end

  if not reaper.TakeIsMIDI(take) then
    return nil, nil, nil, "Item is not a MIDI item"
  end

  return track, item, take, nil
end

-- Helper: get a media item from track/item indices, with validation
local function get_media_item(params)
  local track_idx = params.trackIndex
  local item_idx = params.itemIndex
  if track_idx == nil then return nil, nil, "trackIndex required" end
  if item_idx == nil then return nil, nil, "itemIndex required" end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, nil, "Track " .. track_idx .. " not found" end

  local item_count = reaper.CountTrackMediaItems(track)
  if item_idx >= item_count then
    return nil, nil, "Item " .. item_idx .. " not found (track has " .. item_count .. " items)"
  end

  local item = reaper.GetTrackMediaItem(track, item_idx)
  if not item then return nil, nil, "Item " .. item_idx .. " not found" end

  return track, item, nil
end

-- Helper: convert beats from item start to PPQ ticks
local function beats_to_ppq(take, item, beats)
  local item_start = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  -- Convert beats to project time (using project tempo), then to PPQ
  local proj_time = item_start + reaper.TimeMap2_QNToTime(0, reaper.TimeMap2_timeToQN(0, item_start) + beats) - item_start
  return reaper.MIDI_GetPPQPosFromProjTime(take, proj_time)
end

-- Helper: convert PPQ ticks to beats from item start
local function ppq_to_beats(take, item)
  local item_start = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  local item_start_qn = reaper.TimeMap2_timeToQN(0, item_start)
  return function(ppq)
    local proj_time = reaper.MIDI_GetProjTimeFromPPQPos(take, ppq)
    local proj_qn = reaper.TimeMap2_timeToQN(0, proj_time)
    return proj_qn - item_start_qn
  end
end

function handlers.create_midi_item(params)
  local track_idx = params.trackIndex
  local start_pos = params.startPosition
  local end_pos = params.endPosition
  if track_idx == nil then return nil, "trackIndex required" end
  if not start_pos or not end_pos then return nil, "startPosition and endPosition required" end
  if end_pos <= start_pos then return nil, "endPosition must be greater than startPosition" end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, "Track " .. track_idx .. " not found" end

  reaper.Undo_BeginBlock()
  local item = reaper.CreateNewMIDIItemInProj(track, start_pos, end_pos)
  reaper.Undo_EndBlock("MCP: Create MIDI item", -1)

  if not item then return nil, "Failed to create MIDI item" end

  -- Find the index of the new item on the track
  local item_count = reaper.CountTrackMediaItems(track)
  local new_idx = -1
  for i = 0, item_count - 1 do
    if reaper.GetTrackMediaItem(track, i) == item then
      new_idx = i
      break
    end
  end

  reaper.UpdateArrange()

  return {
    trackIndex = track_idx,
    itemIndex = new_idx,
    position = start_pos,
    length = end_pos - start_pos,
  }
end

function handlers.list_midi_items(params)
  local track_idx = params.trackIndex
  if track_idx == nil then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, "Track " .. track_idx .. " not found" end

  local items = {}
  local item_count = reaper.CountTrackMediaItems(track)
  for i = 0, item_count - 1 do
    local item = reaper.GetTrackMediaItem(track, i)
    local take = reaper.GetActiveTake(item)
    if take and reaper.TakeIsMIDI(take) then
      local _, note_cnt, cc_cnt, _ = reaper.MIDI_CountEvts(take)
      items[#items + 1] = {
        itemIndex = i,
        position = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
        length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
        noteCount = note_cnt,
        ccCount = cc_cnt,
        muted = reaper.GetMediaItemInfo_Value(item, "B_MUTE") ~= 0,
      }
    end
  end

  return { trackIndex = track_idx, items = items, total = #items }
end

function handlers.get_midi_notes(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local _, note_cnt, _, _ = reaper.MIDI_CountEvts(take)
  local to_beats = ppq_to_beats(take, item)

  local offset = params.offset or 0
  local limit = params.limit
  local start_idx = math.min(offset, note_cnt)
  local end_idx = note_cnt - 1
  if limit then
    end_idx = math.min(start_idx + limit - 1, note_cnt - 1)
  end

  local notes = {}
  for i = start_idx, end_idx do
    local _, sel, muted, start_ppq, end_ppq, chan, pitch, vel = reaper.MIDI_GetNote(take, i)
    local start_beats = to_beats(start_ppq)
    local end_beats = to_beats(end_ppq)
    notes[#notes + 1] = {
      noteIndex = i,
      pitch = pitch,
      velocity = vel,
      startPosition = start_beats,
      duration = end_beats - start_beats,
      channel = chan,
      selected = sel,
      muted = muted,
    }
  end

  return {
    trackIndex = params.trackIndex,
    itemIndex = params.itemIndex,
    notes = notes,
    returned = #notes,
    total = note_cnt,
    offset = start_idx,
    hasMore = end_idx < note_cnt - 1,
  }
end

function handlers.analyze_midi(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local _, note_cnt, cc_cnt, _ = reaper.MIDI_CountEvts(take)
  local to_beats = ppq_to_beats(take, item)

  -- Per-pitch accumulators
  local pitch_data = {}  -- pitch -> { count, sum_vel, sum_sq, min_vel, max_vel, last_vel, consec, max_consec, sequences }
  -- Velocity histogram: 13 buckets (0-9, 10-19, ..., 120-127)
  local vel_histogram = {}
  for i = 1, 13 do vel_histogram[i] = 0 end

  local max_end_beat = 0

  for i = 0, note_cnt - 1 do
    local _, _, _, start_ppq, end_ppq, _, pitch, vel = reaper.MIDI_GetNote(take, i)

    -- Track duration
    local end_beat = to_beats(end_ppq)
    if end_beat > max_end_beat then max_end_beat = end_beat end

    -- Velocity histogram bucket
    local bucket = math.min(math.floor(vel / 10) + 1, 13)
    vel_histogram[bucket] = vel_histogram[bucket] + 1

    -- Per-pitch stats
    if not pitch_data[pitch] then
      pitch_data[pitch] = {
        count = 0, sum_vel = 0, sum_sq = 0,
        min_vel = 127, max_vel = 0,
        last_vel = -1, consec = 1, max_consec = 1, sequences = 0,
      }
    end
    local pd = pitch_data[pitch]
    pd.count = pd.count + 1
    pd.sum_vel = pd.sum_vel + vel
    pd.sum_sq = pd.sum_sq + vel * vel
    if vel < pd.min_vel then pd.min_vel = vel end
    if vel > pd.max_vel then pd.max_vel = vel end

    -- Machine gun detection: consecutive identical velocities
    if vel == pd.last_vel then
      pd.consec = pd.consec + 1
      if pd.consec > pd.max_consec then pd.max_consec = pd.consec end
    else
      if pd.consec >= 3 then pd.sequences = pd.sequences + 1 end
      pd.consec = 1
    end
    pd.last_vel = vel
  end

  -- Build pitch stats array
  local pitch_stats = {}
  local machine_gun = {}
  local sorted_pitches = {}
  for p, _ in pairs(pitch_data) do sorted_pitches[#sorted_pitches + 1] = p end
  table.sort(sorted_pitches)

  for _, pitch in ipairs(sorted_pitches) do
    local pd = pitch_data[pitch]
    -- Close final run
    if pd.consec >= 3 then pd.sequences = pd.sequences + 1 end

    local avg = pd.sum_vel / pd.count
    local variance = (pd.sum_sq / pd.count) - (avg * avg)
    local std_dev = math.sqrt(math.max(0, variance))

    pitch_stats[#pitch_stats + 1] = {
      pitch = pitch,
      count = pd.count,
      minVelocity = pd.min_vel,
      maxVelocity = pd.max_vel,
      avgVelocity = math.floor(avg * 10 + 0.5) / 10,  -- round to 1 decimal
      stdDev = math.floor(std_dev * 10 + 0.5) / 10,
      maxConsecutiveSameVelocity = pd.max_consec,
    }

    if pd.max_consec >= 3 then
      machine_gun[#machine_gun + 1] = {
        pitch = pitch,
        maxConsecutive = pd.max_consec,
        sequences = pd.sequences,
      }
    end
  end

  return {
    trackIndex = params.trackIndex,
    itemIndex = params.itemIndex,
    totalNotes = note_cnt,
    totalCC = cc_cnt,
    durationBeats = math.floor(max_end_beat * 100 + 0.5) / 100,
    pitchStats = pitch_stats,
    velocityHistogram = vel_histogram,
    machineGunWarnings = machine_gun,
  }
end

function handlers.insert_midi_note(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local pitch = params.pitch
  local vel = params.velocity
  local start_pos = params.startPosition
  local dur = params.duration
  local chan = params.channel or 0

  if not pitch or not vel or not start_pos or not dur then
    return nil, "pitch, velocity, startPosition, and duration required"
  end

  -- Clamp values
  pitch = math.max(0, math.min(127, math.floor(pitch)))
  vel = math.max(1, math.min(127, math.floor(vel)))
  chan = math.max(0, math.min(15, math.floor(chan)))

  local start_ppq = beats_to_ppq(take, item, start_pos)
  local end_ppq = beats_to_ppq(take, item, start_pos + dur)

  reaper.Undo_BeginBlock()
  reaper.MIDI_InsertNote(take, false, false, start_ppq, end_ppq, chan, pitch, vel, false)
  reaper.MIDI_Sort(take)
  reaper.Undo_EndBlock("MCP: Insert MIDI note", -1)

  reaper.UpdateArrange()

  local _, note_cnt, _, _ = reaper.MIDI_CountEvts(take)
  return { success = true, noteCount = note_cnt }
end

function handlers.insert_midi_notes(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local notes_str = params.notes
  if not notes_str or notes_str == "" then return nil, "notes JSON string required" end

  -- Parse notes JSON array (uses dedicated array parser with fallback)
  local notes_list = json_decode_array(notes_str)
  if not notes_list or #notes_list == 0 then
    return nil, "Failed to parse notes JSON array. Expected: [{\"pitch\":60,\"velocity\":100,\"startPosition\":0,\"duration\":1}, ...]"
  end

  reaper.Undo_BeginBlock()
  local inserted = 0
  for _, note in ipairs(notes_list) do
    local pitch = note.pitch
    local vel = note.velocity
    local start_pos = note.startPosition
    local dur = note.duration
    local chan = note.channel or 0

    if pitch and vel and start_pos and dur then
      pitch = math.max(0, math.min(127, math.floor(pitch)))
      vel = math.max(1, math.min(127, math.floor(vel)))
      chan = math.max(0, math.min(15, math.floor(chan)))

      local start_ppq = beats_to_ppq(take, item, start_pos)
      local end_ppq = beats_to_ppq(take, item, start_pos + dur)

      reaper.MIDI_InsertNote(take, false, false, start_ppq, end_ppq, chan, pitch, vel, true)
      inserted = inserted + 1
    end
  end
  reaper.MIDI_Sort(take)
  reaper.Undo_EndBlock("MCP: Insert " .. inserted .. " MIDI notes", -1)

  reaper.UpdateArrange()

  local _, note_cnt, _, _ = reaper.MIDI_CountEvts(take)
  return { success = true, inserted = inserted, noteCount = note_cnt }
end

function handlers.edit_midi_note(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local note_idx = params.noteIndex
  if note_idx == nil then return nil, "noteIndex required" end

  local _, note_cnt, _, _ = reaper.MIDI_CountEvts(take)
  if note_idx >= note_cnt then
    return nil, "Note index " .. note_idx .. " out of range (item has " .. note_cnt .. " notes)"
  end

  -- Get current note values
  local _, sel, muted, cur_start_ppq, cur_end_ppq, cur_chan, cur_pitch, cur_vel = reaper.MIDI_GetNote(take, note_idx)

  -- Apply changes (nil means keep current)
  local new_pitch = params.pitch and math.max(0, math.min(127, math.floor(params.pitch))) or nil
  local new_vel = params.velocity and math.max(1, math.min(127, math.floor(params.velocity))) or nil
  local new_chan = params.channel and math.max(0, math.min(15, math.floor(params.channel))) or nil

  local new_start_ppq = nil
  local new_end_ppq = nil
  if params.startPosition ~= nil then
    new_start_ppq = beats_to_ppq(take, item, params.startPosition)
    if params.duration ~= nil then
      new_end_ppq = beats_to_ppq(take, item, params.startPosition + params.duration)
    else
      -- Keep same duration
      local dur_ppq = cur_end_ppq - cur_start_ppq
      new_end_ppq = new_start_ppq + dur_ppq
    end
  elseif params.duration ~= nil then
    -- Change duration only, keep start
    local to_beats = ppq_to_beats(take, item)
    local cur_start_beats = to_beats(cur_start_ppq)
    new_end_ppq = beats_to_ppq(take, item, cur_start_beats + params.duration)
  end

  reaper.Undo_BeginBlock()
  reaper.MIDI_SetNote(take, note_idx, sel, muted, new_start_ppq, new_end_ppq, new_chan, new_pitch, new_vel, false)
  reaper.MIDI_Sort(take)
  reaper.Undo_EndBlock("MCP: Edit MIDI note " .. note_idx, -1)

  reaper.UpdateArrange()

  return { success = true, noteIndex = note_idx }
end

function handlers.edit_midi_notes(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local edits_str = params.edits
  if not edits_str then return nil, "edits (JSON array string) required" end

  local edits = json_decode_array(edits_str)
  if not edits then return nil, "Failed to parse edits JSON array" end

  local _, note_cnt, _, _ = reaper.MIDI_CountEvts(take)
  local to_beats = ppq_to_beats(take, item)
  local edited = 0
  local errors = {}

  reaper.Undo_BeginBlock()

  for _, edit in ipairs(edits) do
    local note_idx = edit.noteIndex
    if note_idx == nil then
      errors[#errors + 1] = "edit missing noteIndex"
    elseif note_idx >= note_cnt then
      errors[#errors + 1] = "noteIndex " .. note_idx .. " out of range"
    else
      local _, sel, muted, cur_start_ppq, cur_end_ppq, cur_chan, cur_pitch, cur_vel = reaper.MIDI_GetNote(take, note_idx)

      local new_pitch = edit.pitch and math.max(0, math.min(127, math.floor(edit.pitch))) or nil
      local new_vel = edit.velocity and math.max(1, math.min(127, math.floor(edit.velocity))) or nil
      local new_chan = edit.channel and math.max(0, math.min(15, math.floor(edit.channel))) or nil

      local new_start_ppq = nil
      local new_end_ppq = nil
      if edit.startPosition ~= nil then
        new_start_ppq = beats_to_ppq(take, item, edit.startPosition)
        if edit.duration ~= nil then
          new_end_ppq = beats_to_ppq(take, item, edit.startPosition + edit.duration)
        else
          local dur_ppq = cur_end_ppq - cur_start_ppq
          new_end_ppq = new_start_ppq + dur_ppq
        end
      elseif edit.duration ~= nil then
        local cur_start_beats = to_beats(cur_start_ppq)
        new_end_ppq = beats_to_ppq(take, item, cur_start_beats + edit.duration)
      end

      reaper.MIDI_SetNote(take, note_idx, sel, muted, new_start_ppq, new_end_ppq, new_chan, new_pitch, new_vel, false)
      edited = edited + 1
    end
  end

  reaper.MIDI_Sort(take)
  reaper.Undo_EndBlock("MCP: Batch edit " .. edited .. " MIDI notes", -1)
  reaper.UpdateArrange()

  local result = { success = true, edited = edited, total = #edits }
  if #errors > 0 then result.errors = errors end
  return result
end

function handlers.delete_midi_note(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local note_idx = params.noteIndex
  if note_idx == nil then return nil, "noteIndex required" end

  local _, note_cnt, _, _ = reaper.MIDI_CountEvts(take)
  if note_idx >= note_cnt then
    return nil, "Note index " .. note_idx .. " out of range (item has " .. note_cnt .. " notes)"
  end

  reaper.Undo_BeginBlock()
  reaper.MIDI_DeleteNote(take, note_idx)
  reaper.Undo_EndBlock("MCP: Delete MIDI note " .. note_idx, -1)

  reaper.UpdateArrange()

  local _, new_cnt, _, _ = reaper.MIDI_CountEvts(take)
  return { success = true, noteCount = new_cnt }
end

function handlers.get_midi_cc(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local _, _, cc_cnt, _ = reaper.MIDI_CountEvts(take)
  local to_beats = ppq_to_beats(take, item)
  local cc_filter = params.ccNumber
  local events = {}

  for i = 0, cc_cnt - 1 do
    local _, sel, muted, ppq, chanmsg, chan, msg2, msg3 = reaper.MIDI_GetCC(take, i)
    -- msg2 = CC number, msg3 = CC value (for standard CC messages, chanmsg=176)
    if chanmsg == 176 then -- standard CC
      if cc_filter == nil or msg2 == cc_filter then
        events[#events + 1] = {
          ccIndex = i,
          ccNumber = msg2,
          value = msg3,
          position = to_beats(ppq),
          channel = chan,
        }
      end
    end
  end

  return { trackIndex = params.trackIndex, itemIndex = params.itemIndex, events = events, total = #events }
end

function handlers.insert_midi_cc(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local cc_num = params.ccNumber
  local value = params.value
  local pos = params.position
  local chan = params.channel or 0

  if not cc_num or not value or not pos then
    return nil, "ccNumber, value, and position required"
  end

  cc_num = math.max(0, math.min(127, math.floor(cc_num)))
  value = math.max(0, math.min(127, math.floor(value)))
  chan = math.max(0, math.min(15, math.floor(chan)))

  local ppq = beats_to_ppq(take, item, pos)

  reaper.Undo_BeginBlock()
  -- chanmsg 176 = 0xB0 = CC message
  reaper.MIDI_InsertCC(take, false, false, ppq, 176, chan, cc_num, value)
  reaper.MIDI_Sort(take)
  reaper.Undo_EndBlock("MCP: Insert MIDI CC " .. cc_num, -1)

  reaper.UpdateArrange()

  local _, _, cc_cnt, _ = reaper.MIDI_CountEvts(take)
  return { success = true, ccCount = cc_cnt }
end

function handlers.delete_midi_cc(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local cc_idx = params.ccIndex
  if cc_idx == nil then return nil, "ccIndex required" end

  local _, _, cc_cnt, _ = reaper.MIDI_CountEvts(take)
  if cc_idx >= cc_cnt then
    return nil, "CC index " .. cc_idx .. " out of range (item has " .. cc_cnt .. " CC events)"
  end

  reaper.Undo_BeginBlock()
  reaper.MIDI_DeleteCC(take, cc_idx)
  reaper.Undo_EndBlock("MCP: Delete MIDI CC " .. cc_idx, -1)

  reaper.UpdateArrange()

  local _, _, new_cnt, _ = reaper.MIDI_CountEvts(take)
  return { success = true, ccCount = new_cnt }
end

function handlers.get_midi_item_properties(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  local _, note_cnt, cc_cnt, _ = reaper.MIDI_CountEvts(take)

  return {
    trackIndex = params.trackIndex,
    itemIndex = params.itemIndex,
    position = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
    length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
    noteCount = note_cnt,
    ccCount = cc_cnt,
    muted = reaper.GetMediaItemInfo_Value(item, "B_MUTE") ~= 0,
    loopSource = reaper.GetMediaItemInfo_Value(item, "B_LOOPSRC") ~= 0,
  }
end

function handlers.set_midi_item_properties(params)
  local track, item, take, err = get_midi_take(params)
  if err then return nil, err end

  reaper.Undo_BeginBlock()

  if params.position ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_POSITION", params.position)
  end
  if params.length ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_LENGTH", params.length)
  end
  if params.mute ~= nil then
    reaper.SetMediaItemInfo_Value(item, "B_MUTE", params.mute)
  end
  if params.loopSource ~= nil then
    reaper.SetMediaItemInfo_Value(item, "B_LOOPSRC", params.loopSource)
  end

  reaper.Undo_EndBlock("MCP: Set MIDI item properties", -1)
  reaper.UpdateArrange()

  return { success = true, trackIndex = params.trackIndex, itemIndex = params.itemIndex }
end

-- =============================================================================
-- Media item editing handlers
-- =============================================================================

function handlers.list_media_items(params)
  local track_idx = params.trackIndex
  if track_idx == nil then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, track_idx)
  if not track then return nil, "Track " .. track_idx .. " not found" end

  local items = {}
  local item_count = reaper.CountTrackMediaItems(track)
  for i = 0, item_count - 1 do
    local item = reaper.GetTrackMediaItem(track, i)
    local take = reaper.GetActiveTake(item)
    local take_name = ""
    local is_midi = false
    if take then
      take_name = reaper.GetTakeName(take) or ""
      is_midi = reaper.TakeIsMIDI(take)
    end

    local vol_raw = reaper.GetMediaItemInfo_Value(item, "D_VOL")
    items[#items + 1] = {
      itemIndex = i,
      position = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
      length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
      name = take_name,
      volume = to_db(vol_raw),
      muted = reaper.GetMediaItemInfo_Value(item, "B_MUTE") ~= 0,
      fadeInLength = reaper.GetMediaItemInfo_Value(item, "D_FADEINLEN"),
      fadeOutLength = reaper.GetMediaItemInfo_Value(item, "D_FADEOUTLEN"),
      playRate = take and reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE") or 1.0,
      isMidi = is_midi,
      takeName = take_name,
    }
  end

  return { trackIndex = track_idx, items = items, total = #items }
end

function handlers.get_media_item_properties(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  local take = reaper.GetActiveTake(item)
  local take_name = ""
  local is_midi = false
  local play_rate = 1.0
  local pitch = 0.0
  local start_offset = 0.0
  local source_file = ""

  if take then
    take_name = reaper.GetTakeName(take) or ""
    is_midi = reaper.TakeIsMIDI(take)
    play_rate = reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")
    pitch = reaper.GetMediaItemTakeInfo_Value(take, "D_PITCH")
    start_offset = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
    local source = reaper.GetMediaItemTake_Source(take)
    if source then
      local _, src_fn = reaper.GetMediaSourceFileName(source, "")
      source_file = src_fn or ""
    end
  end

  local vol_raw = reaper.GetMediaItemInfo_Value(item, "D_VOL")

  return {
    trackIndex = params.trackIndex,
    itemIndex = params.itemIndex,
    position = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
    length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
    name = take_name,
    volume = to_db(vol_raw),
    volumeRaw = vol_raw,
    muted = reaper.GetMediaItemInfo_Value(item, "B_MUTE") ~= 0,
    fadeInLength = reaper.GetMediaItemInfo_Value(item, "D_FADEINLEN"),
    fadeOutLength = reaper.GetMediaItemInfo_Value(item, "D_FADEOUTLEN"),
    fadeInShape = reaper.GetMediaItemInfo_Value(item, "C_FADEINSHAPE"),
    fadeOutShape = reaper.GetMediaItemInfo_Value(item, "C_FADEOUTSHAPE"),
    playRate = play_rate,
    pitch = pitch,
    startOffset = start_offset,
    loopSource = reaper.GetMediaItemInfo_Value(item, "B_LOOPSRC") ~= 0,
    isMidi = is_midi,
    takeName = take_name,
    sourceFile = source_file,
    locked = reaper.GetMediaItemInfo_Value(item, "C_LOCK") ~= 0,
  }
end

function handlers.set_media_item_properties(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  reaper.Undo_BeginBlock()

  if params.position ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_POSITION", params.position)
  end
  if params.length ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_LENGTH", params.length)
  end
  if params.volume ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_VOL", from_db(params.volume))
  end
  if params.mute ~= nil then
    reaper.SetMediaItemInfo_Value(item, "B_MUTE", params.mute)
  end
  if params.fadeInLength ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_FADEINLEN", params.fadeInLength)
  end
  if params.fadeOutLength ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_FADEOUTLEN", params.fadeOutLength)
  end
  if params.playRate ~= nil then
    local take = reaper.GetActiveTake(item)
    if take then
      reaper.SetMediaItemTakeInfo_Value(take, "D_PLAYRATE", params.playRate)
    end
  end

  reaper.Undo_EndBlock("MCP: Set media item properties", -1)
  reaper.UpdateArrange()

  return { success = true, trackIndex = params.trackIndex, itemIndex = params.itemIndex }
end

function handlers.set_media_items_properties(params)
  local items_str = params.items
  if not items_str then return nil, "items (JSON array string) required" end

  local items = json_decode_array(items_str)
  if not items then return nil, "Failed to parse items JSON array" end

  local edited = 0
  local errors = {}

  reaper.Undo_BeginBlock()

  for _, item_params in ipairs(items) do
    local track_idx = item_params.trackIndex
    local item_idx = item_params.itemIndex
    if track_idx == nil or item_idx == nil then
      errors[#errors + 1] = "item missing trackIndex or itemIndex"
    else
      local track = reaper.GetTrack(0, track_idx)
      if not track then
        errors[#errors + 1] = "Track " .. track_idx .. " not found"
      else
        local item_count = reaper.CountTrackMediaItems(track)
        if item_idx >= item_count then
          errors[#errors + 1] = "Item " .. item_idx .. " not found on track " .. track_idx
        else
          local item = reaper.GetTrackMediaItem(track, item_idx)
          if item_params.position ~= nil then
            reaper.SetMediaItemInfo_Value(item, "D_POSITION", item_params.position)
          end
          if item_params.length ~= nil then
            reaper.SetMediaItemInfo_Value(item, "D_LENGTH", item_params.length)
          end
          if item_params.volume ~= nil then
            reaper.SetMediaItemInfo_Value(item, "D_VOL", from_db(item_params.volume))
          end
          if item_params.mute ~= nil then
            reaper.SetMediaItemInfo_Value(item, "B_MUTE", item_params.mute)
          end
          if item_params.fadeInLength ~= nil then
            reaper.SetMediaItemInfo_Value(item, "D_FADEINLEN", item_params.fadeInLength)
          end
          if item_params.fadeOutLength ~= nil then
            reaper.SetMediaItemInfo_Value(item, "D_FADEOUTLEN", item_params.fadeOutLength)
          end
          if item_params.playRate ~= nil then
            local take = reaper.GetActiveTake(item)
            if take then
              reaper.SetMediaItemTakeInfo_Value(take, "D_PLAYRATE", item_params.playRate)
            end
          end
          edited = edited + 1
        end
      end
    end
  end

  reaper.Undo_EndBlock("MCP: Batch set " .. edited .. " media item properties", -1)
  reaper.UpdateArrange()

  local result = { success = true, edited = edited, total = #items }
  if #errors > 0 then result.errors = errors end
  return result
end

function handlers.split_media_item(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  local position = params.position
  if not position then return nil, "position required" end

  local item_start = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  local item_end = item_start + reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
  if position <= item_start or position >= item_end then
    return nil, "Split position must be within item bounds (" .. item_start .. "s - " .. item_end .. "s)"
  end

  reaper.Undo_BeginBlock()
  local right_item = reaper.SplitMediaItem(item, position)
  reaper.Undo_EndBlock("MCP: Split media item", -1)

  if not right_item then return nil, "Failed to split item at position " .. position end

  reaper.UpdateArrange()

  return {
    success = true,
    leftItem = {
      position = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
      length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
    },
    rightItem = {
      position = reaper.GetMediaItemInfo_Value(right_item, "D_POSITION"),
      length = reaper.GetMediaItemInfo_Value(right_item, "D_LENGTH"),
    },
  }
end

function handlers.delete_media_item(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  reaper.Undo_BeginBlock()
  local ok = reaper.DeleteTrackMediaItem(track, item)
  reaper.Undo_EndBlock("MCP: Delete media item", -1)

  if not ok then return nil, "Failed to delete item" end

  reaper.UpdateArrange()

  return { success = true, trackIndex = params.trackIndex, itemIndex = params.itemIndex }
end

function handlers.move_media_item(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  -- Validate destination track before starting undo block
  if params.newTrackIndex ~= nil then
    local dest_track = reaper.GetTrack(0, params.newTrackIndex)
    if not dest_track then
      return nil, "Destination track " .. params.newTrackIndex .. " not found"
    end
  end

  reaper.Undo_BeginBlock()

  -- Move track first, then set position (MoveMediaItemToTrack preserves position)
  if params.newTrackIndex ~= nil then
    local dest_track = reaper.GetTrack(0, params.newTrackIndex)
    reaper.MoveMediaItemToTrack(item, dest_track)
  end

  if params.newPosition ~= nil then
    reaper.SetMediaItemInfo_Value(item, "D_POSITION", params.newPosition)
  end

  reaper.Undo_EndBlock("MCP: Move media item", -1)
  reaper.UpdateArrange()

  return {
    success = true,
    position = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
    trackIndex = params.newTrackIndex or params.trackIndex,
  }
end

function handlers.trim_media_item(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")

  -- Validate both trims upfront before applying either
  local trim_start = (params.trimStart ~= nil and params.trimStart ~= 0) and params.trimStart or 0
  local trim_end = (params.trimEnd ~= nil and params.trimEnd ~= 0) and params.trimEnd or 0
  local new_len = len - trim_start - trim_end
  if new_len <= 0 then
    return nil, "Trim would result in zero or negative length (current: " .. len .. "s, trimStart: " .. trim_start .. "s, trimEnd: " .. trim_end .. "s)"
  end

  reaper.Undo_BeginBlock()

  local take = reaper.GetActiveTake(item)

  if trim_start ~= 0 then
    pos = pos + trim_start
    reaper.SetMediaItemInfo_Value(item, "D_POSITION", pos)
    -- Adjust take start offset
    if take then
      local offset = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
      reaper.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", offset + trim_start)
    end
  end

  reaper.SetMediaItemInfo_Value(item, "D_LENGTH", new_len)
  len = new_len

  reaper.Undo_EndBlock("MCP: Trim media item", -1)
  reaper.UpdateArrange()

  return {
    success = true,
    position = pos,
    length = len,
  }
end

function handlers.add_stretch_marker(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  local position = params.position
  if not position then return nil, "position required" end

  local take = reaper.GetActiveTake(item)
  if not take then return nil, "Item has no active take" end

  local src_pos = params.sourcePosition or position

  reaper.Undo_BeginBlock()
  local idx = reaper.SetTakeStretchMarker(take, -1, position, src_pos)
  reaper.Undo_EndBlock("MCP: Add stretch marker", -1)

  if idx < 0 then return nil, "Failed to add stretch marker" end

  reaper.UpdateItemInProject(item)
  reaper.UpdateArrange()

  return {
    success = true,
    markerIndex = idx,
    position = position,
    sourcePosition = src_pos,
    totalMarkers = reaper.GetTakeNumStretchMarkers(take),
  }
end

function handlers.get_stretch_markers(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  local take = reaper.GetActiveTake(item)
  if not take then return nil, "Item has no active take" end

  local count = reaper.GetTakeNumStretchMarkers(take)
  local markers = {}

  for i = 0, count - 1 do
    local _, pos, src_pos = reaper.GetTakeStretchMarker(take, i)
    markers[#markers + 1] = {
      index = i,
      position = pos,
      sourcePosition = src_pos,
    }
  end

  return { trackIndex = params.trackIndex, itemIndex = params.itemIndex, markers = markers, total = count }
end

function handlers.delete_stretch_marker(params)
  local track, item, err = get_media_item(params)
  if err then return nil, err end

  local marker_idx = params.markerIndex
  if marker_idx == nil then return nil, "markerIndex required" end

  local take = reaper.GetActiveTake(item)
  if not take then return nil, "Item has no active take" end

  local count = reaper.GetTakeNumStretchMarkers(take)
  if marker_idx >= count then
    return nil, "Marker index " .. marker_idx .. " out of range (item has " .. count .. " markers)"
  end

  reaper.Undo_BeginBlock()
  reaper.DeleteTakeStretchMarkers(take, marker_idx, 1)
  reaper.Undo_EndBlock("MCP: Delete stretch marker", -1)

  reaper.UpdateItemInProject(item)
  reaper.UpdateArrange()

  return { success = true, totalMarkers = reaper.GetTakeNumStretchMarkers(take) }
end

-- =============================================================================
-- Selection & navigation handlers
-- =============================================================================

function handlers.get_selected_tracks(params)
  local tracks = {}
  local count = reaper.CountSelectedTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetSelectedTrack(0, i)
    local _, name = reaper.GetTrackName(track)
    local idx = reaper.GetMediaTrackInfo_Value(track, "IP_TRACKNUMBER") - 1
    tracks[#tracks + 1] = {
      index = idx,
      name = name,
    }
  end
  return { tracks = tracks, total = count }
end

function handlers.get_time_selection(params)
  local start_time, end_time = reaper.GetSet_LoopTimeRange(false, false, 0, 0, false)
  local length = end_time - start_time
  return {
    start = start_time,
    ["end"] = end_time,
    length = length,
    empty = length == 0,
  }
end

function handlers.set_time_selection(params)
  local start_time = params.start
  local end_time = params["end"]
  if start_time == nil or end_time == nil then
    return nil, "start and end required"
  end
  if end_time <= start_time then
    return nil, "end must be greater than start"
  end

  reaper.GetSet_LoopTimeRange(true, false, start_time, end_time, false)
  return { success = true, start = start_time, ["end"] = end_time }
end

-- =============================================================================
-- Markers & regions handlers
-- =============================================================================

function handlers.list_markers(params)
  local markers = {}
  local num_markers, num_regions = reaper.CountProjectMarkers(0)
  local total = num_markers + num_regions
  for i = 0, total - 1 do
    local _, isrgn, pos, _, name, markrgnindex, color = reaper.EnumProjectMarkers3(0, i)
    if not isrgn then
      markers[#markers + 1] = {
        index = markrgnindex,
        name = name or "",
        position = pos,
        color = color,
      }
    end
  end
  return { markers = markers, total = #markers }
end

function handlers.list_regions(params)
  local regions = {}
  local num_markers, num_regions = reaper.CountProjectMarkers(0)
  local total = num_markers + num_regions
  for i = 0, total - 1 do
    local _, isrgn, pos, rgnend, name, markrgnindex, color = reaper.EnumProjectMarkers3(0, i)
    if isrgn then
      regions[#regions + 1] = {
        index = markrgnindex,
        name = name or "",
        start = pos,
        ["end"] = rgnend,
        color = color,
      }
    end
  end
  return { regions = regions, total = #regions }
end

function handlers.add_marker(params)
  local pos = params.position
  if pos == nil then return nil, "position required" end
  local name = params.name or ""
  local color = params.color or 0

  local idx = reaper.AddProjectMarker2(0, false, pos, 0, name, -1, color)
  if idx < 0 then return nil, "Failed to add marker" end

  return { success = true, index = idx, position = pos, name = name }
end

function handlers.add_region(params)
  local start_pos = params.start
  local end_pos = params["end"]
  if start_pos == nil or end_pos == nil then return nil, "start and end required" end
  if end_pos <= start_pos then return nil, "end must be greater than start" end
  local name = params.name or ""
  local color = params.color or 0

  local idx = reaper.AddProjectMarker2(0, true, start_pos, end_pos, name, -1, color)
  if idx < 0 then return nil, "Failed to add region" end

  return { success = true, index = idx, start = start_pos, ["end"] = end_pos, name = name }
end

function handlers.delete_marker(params)
  local idx = params.markerIndex
  if idx == nil then return nil, "markerIndex required" end

  local ok = reaper.DeleteProjectMarker(0, idx, false)
  if not ok then return nil, "Marker " .. idx .. " not found" end

  return { success = true, markerIndex = idx }
end

function handlers.delete_region(params)
  local idx = params.regionIndex
  if idx == nil then return nil, "regionIndex required" end

  local ok = reaper.DeleteProjectMarker(0, idx, true)
  if not ok then return nil, "Region " .. idx .. " not found" end

  return { success = true, regionIndex = idx }
end

-- =============================================================================
-- Tempo map handlers
-- =============================================================================

function handlers.get_tempo_map(params)
  local points = {}
  local count = reaper.CountTempoTimeSigMarkers(0)
  for i = 0, count - 1 do
    local _, timepos, measurepos, beatpos, bpm, timesig_num, timesig_denom, lineartempo = reaper.GetTempoTimeSigMarker(0, i)
    points[#points + 1] = {
      index = i,
      position = timepos,
      beatPosition = beatpos,
      tempo = bpm,
      timeSignatureNumerator = timesig_num,
      timeSignatureDenominator = timesig_denom,
      linearTempo = lineartempo,
    }
  end
  return { points = points, total = count }
end

-- =============================================================================
-- Envelope handlers
-- =============================================================================

function handlers.get_track_envelopes(params)
  local idx = params.trackIndex
  if idx == nil then return nil, "trackIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local envelopes = {}
  local count = reaper.CountTrackEnvelopes(track)
  for i = 0, count - 1 do
    local env = reaper.GetTrackEnvelope(track, i)
    local _, name = reaper.GetEnvelopeName(env)
    local point_count = reaper.CountEnvelopePoints(env)

    -- Get envelope state from state chunk (ACT, VIS, ARM flags)
    local active = true
    local visible = true
    local armed = false

    local _, chunk = reaper.GetEnvelopeStateChunk(env, "", false)
    if chunk then
      local act_val = chunk:match("ACT (%d)")
      if act_val then active = act_val ~= "0" end
      local vis_val = chunk:match("VIS (%d)")
      if vis_val then visible = vis_val ~= "0" end
      local arm_val = chunk:match("ARM (%d)")
      if arm_val then armed = arm_val ~= "0" end
    end

    envelopes[#envelopes + 1] = {
      index = i,
      name = name or "",
      pointCount = point_count,
      active = active,
      visible = visible,
      armed = armed,
    }
  end

  return { trackIndex = idx, envelopes = envelopes, total = count }
end

function handlers.get_envelope_points(params)
  local idx = params.trackIndex
  local env_idx = params.envelopeIndex
  if idx == nil then return nil, "trackIndex required" end
  if env_idx == nil then return nil, "envelopeIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local env_count = reaper.CountTrackEnvelopes(track)
  if env_idx >= env_count then
    return nil, "Envelope " .. env_idx .. " not found (track has " .. env_count .. " envelopes)"
  end

  local env = reaper.GetTrackEnvelope(track, env_idx)
  local _, env_name = reaper.GetEnvelopeName(env)
  local point_count = reaper.CountEnvelopePoints(env)

  local offset = params.offset or 0
  local limit = params.limit
  local start_idx = math.min(offset, point_count)
  local end_idx = point_count - 1
  if limit then
    end_idx = math.min(start_idx + limit - 1, point_count - 1)
  end

  local points = {}
  for i = start_idx, end_idx do
    local _, time, value, shape, tension, selected = reaper.GetEnvelopePoint(env, i)
    points[#points + 1] = {
      pointIndex = i,
      time = time,
      value = value,
      shape = shape,
      tension = tension,
      selected = selected,
    }
  end

  return {
    trackIndex = idx,
    envelopeIndex = env_idx,
    envelopeName = env_name or "",
    points = points,
    returned = #points,
    total = point_count,
    offset = start_idx,
    hasMore = end_idx < point_count - 1,
  }
end

function handlers.insert_envelope_point(params)
  local idx = params.trackIndex
  local env_idx = params.envelopeIndex
  if idx == nil then return nil, "trackIndex required" end
  if env_idx == nil then return nil, "envelopeIndex required" end
  if params.time == nil then return nil, "time required" end
  if params.value == nil then return nil, "value required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local env_count = reaper.CountTrackEnvelopes(track)
  if env_idx >= env_count then
    return nil, "Envelope " .. env_idx .. " not found (track has " .. env_count .. " envelopes)"
  end

  local env = reaper.GetTrackEnvelope(track, env_idx)
  local shape = params.shape or 0
  local tension = params.tension or 0

  reaper.Undo_BeginBlock()
  local ok = reaper.InsertEnvelopePoint(env, params.time, params.value, shape, tension, false, true)
  reaper.Envelope_SortPoints(env)
  reaper.Undo_EndBlock("MCP: Insert envelope point", -1)

  if not ok then return nil, "Failed to insert envelope point" end

  return {
    success = true,
    trackIndex = idx,
    envelopeIndex = env_idx,
    time = params.time,
    value = params.value,
    totalPoints = reaper.CountEnvelopePoints(env),
  }
end

function handlers.delete_envelope_point(params)
  local idx = params.trackIndex
  local env_idx = params.envelopeIndex
  local pt_idx = params.pointIndex
  if idx == nil then return nil, "trackIndex required" end
  if env_idx == nil then return nil, "envelopeIndex required" end
  if pt_idx == nil then return nil, "pointIndex required" end

  local track = reaper.GetTrack(0, idx)
  if not track then return nil, "Track " .. idx .. " not found" end

  local env_count = reaper.CountTrackEnvelopes(track)
  if env_idx >= env_count then
    return nil, "Envelope " .. env_idx .. " not found (track has " .. env_count .. " envelopes)"
  end

  local env = reaper.GetTrackEnvelope(track, env_idx)
  local point_count = reaper.CountEnvelopePoints(env)
  if pt_idx >= point_count then
    return nil, "Point " .. pt_idx .. " not found (envelope has " .. point_count .. " points)"
  end

  reaper.Undo_BeginBlock()
  reaper.DeleteEnvelopePoint(env, pt_idx)
  reaper.Undo_EndBlock("MCP: Delete envelope point", -1)

  return { success = true, totalPoints = reaper.CountEnvelopePoints(env) }
end

-- =============================================================================
-- Command dispatcher
-- =============================================================================

local function process_command(filename)
  local path = bridge_dir .. filename
  local content = read_file(path)
  if not content then return end

  local cmd = json_decode(content)
  if not cmd or not cmd.id or not cmd.type then
    -- Invalid command, remove file
    os.remove(path)
    return
  end

  -- Dispatch to handler
  local handler = handlers[cmd.type]
  local response = {}

  if handler then
    local data, err = handler(cmd.params or {})
    if err then
      response = { id = cmd.id, success = false, error = err, timestamp = os.time() * 1000 }
    else
      response = { id = cmd.id, success = true, data = data, timestamp = os.time() * 1000 }
    end
  else
    response = {
      id = cmd.id,
      success = false,
      error = "Unknown command type: " .. tostring(cmd.type),
      timestamp = os.time() * 1000,
    }
  end

  -- Write response
  local response_path = bridge_dir .. "response_" .. cmd.id .. ".json"
  write_file(response_path, json_encode(response))

  -- Remove command file
  os.remove(path)
end

-- =============================================================================
-- Heartbeat
-- =============================================================================

local function write_heartbeat()
  local heartbeat = {
    timestamp = os.time() * 1000,
    reaperVersion = reaper.GetAppVersion(),
    projectName = select(2, reaper.EnumProjects(-1)) or "",
  }
  write_file(bridge_dir .. "heartbeat.json", json_encode(heartbeat))
end

-- =============================================================================
-- Main defer loop
-- =============================================================================

local function main_loop()
  local now = reaper.time_precise()

  -- Poll for commands at interval
  if now - last_poll >= POLL_INTERVAL then
    last_poll = now
    local files = list_files(bridge_dir, "command_")
    for _, filename in ipairs(files) do
      process_command(filename)
    end
  end

  -- Write heartbeat at interval
  if now - last_heartbeat >= HEARTBEAT_INTERVAL then
    last_heartbeat = now
    write_heartbeat()
  end

  reaper.defer(main_loop)
end

-- =============================================================================
-- Startup
-- =============================================================================

reaper.ShowConsoleMsg("MCP Bridge: Started\n")
reaper.ShowConsoleMsg("MCP Bridge: Bridge directory: " .. bridge_dir .. "\n")
reaper.ShowConsoleMsg("MCP Bridge: Polling every " .. (POLL_INTERVAL * 1000) .. "ms\n")

-- Write initial heartbeat
write_heartbeat()

-- Start the loop
main_loop()
