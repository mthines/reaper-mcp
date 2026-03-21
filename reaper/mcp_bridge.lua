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

local function json_decode(str)
  -- Use REAPER 7+ built-in JSON if available, otherwise basic parser
  if reaper.CF_Json_Parse then
    local ok, val = reaper.CF_Json_Parse(str)
    if ok then return val end
  end

  -- Fallback: use Lua pattern matching for our simple JSON format
  -- This handles the flat command objects we receive
  local obj = {}
  -- Extract string values: "key": "value"
  for k, v in str:gmatch('"([^"]+)"%s*:%s*"([^"]*)"') do
    obj[k] = v
  end
  -- Extract number values: "key": 123.456
  for k, v in str:gmatch('"([^"]+)"%s*:%s*(-?%d+%.?%d*)') do
    if not obj[k] then obj[k] = tonumber(v) end
  end
  -- Extract nested params object
  local params_str = str:match('"params"%s*:%s*(%b{})')
  if params_str then
    obj.params = {}
    for k, v in params_str:gmatch('"([^"]+)"%s*:%s*"([^"]*)"') do
      obj.params[k] = v
    end
    for k, v in params_str:gmatch('"([^"]+)"%s*:%s*(-?%d+%.?%d*)') do
      if not obj.params[k] then obj.params[k] = tonumber(v) end
    end
  end
  return obj
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

    tracks[#tracks + 1] = {
      index = i,
      name = name,
      volume = to_db(vol),
      volumeRaw = vol,
      pan = pan,
      mute = mute ~= 0,
      solo = solo ~= 0,
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
    local _, preset = reaper.TrackFX_GetPreset(track, i)
    fx_list[#fx_list + 1] = {
      index = i,
      name = fx_name,
      enabled = enabled,
      preset = preset or "",
    }
  end

  return {
    index = idx,
    name = name,
    volume = to_db(vol),
    volumeRaw = vol,
    pan = pan,
    mute = mute ~= 0,
    solo = solo ~= 0,
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
