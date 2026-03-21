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
