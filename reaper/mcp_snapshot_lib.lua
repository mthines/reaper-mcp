-- =============================================================================
-- MCP Snapshot Library — shared helpers for snapshot action scripts + GUI
-- =============================================================================
-- Single source of truth for path resolution, JSON encode/decode, listing,
-- mixer-state capture, full restore, and save. Loaded via dofile() by the
-- snapshot action scripts (next/prev/quick-save) and the Snapshot Manager GUI,
-- so all of them share ONE save/restore implementation (no drift).
--
-- Uses only built-in REAPER APIs (no ReaImGui, no SWS required). CF_Json_Parse
-- is used opportunistically when present, but a pure-Lua decoder is the
-- guaranteed fallback.
-- =============================================================================

local M = {}

-- ExtState section for persisting the current snapshot across action calls.
-- Keyed by snapshot NAME (not list position) so add/delete/re-sort can't make
-- next/prev jump to an unrelated snapshot.
M.EXT_SECTION = "MCP_Snapshots"
M.EXT_KEY_NAME = "current_name"

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

-- Atomic write: write to a temp file, then rename over the target. Prevents a
-- crash mid-write from corrupting (or truncating) an existing snapshot.
function M.write_file_atomic(path, content)
  local tmp = path .. ".tmp"
  local f = io.open(tmp, "wb")
  if not f then
    return M.write_file(path, content)  -- temp not writable; best-effort direct
  end
  f:write(content)
  f:close()
  -- POSIX rename atomically replaces; Windows rename fails if dest exists, so
  -- remove first and retry. Fall back to a direct write if rename can't work.
  local ok = os.rename(tmp, path)
  if not ok then
    os.remove(path)
    ok = os.rename(tmp, path)
  end
  if not ok then
    os.remove(tmp)
    return M.write_file(path, content)
  end
  return true
end

-- =============================================================================
-- Base64 (standard alphabet)
-- =============================================================================
-- Used to store REAPER track state chunks inside the snapshot JSON: chunks
-- contain quotes, newlines and {GUID} braces that a naive JSON round-trip can
-- mangle. Base64's alphabet (A-Za-z0-9+/=) is safe for both the encoder above
-- and the decoder below. Mirrors the implementation in mcp_bridge.lua so the
-- action scripts and the MCP tool capture plugin internal state identically.

local B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local B64_LOOKUP = {}
for _b = 1, #B64_CHARS do B64_LOOKUP[B64_CHARS:sub(_b, _b)] = _b - 1 end

function M.base64_encode(data)
  if not data or data == "" then return "" end
  local out = {}
  local len = #data
  local i = 1
  while i <= len do
    local b1 = data:byte(i)
    local b2 = (i + 1 <= len) and data:byte(i + 1) or 0
    local b3 = (i + 2 <= len) and data:byte(i + 2) or 0
    local n = b1 * 65536 + b2 * 256 + b3
    local c1 = math.floor(n / 262144) % 64
    local c2 = math.floor(n / 4096) % 64
    local c3 = math.floor(n / 64) % 64
    local c4 = n % 64
    out[#out + 1] = B64_CHARS:sub(c1 + 1, c1 + 1)
    out[#out + 1] = B64_CHARS:sub(c2 + 1, c2 + 1)
    out[#out + 1] = (i + 1 <= len) and B64_CHARS:sub(c3 + 1, c3 + 1) or '='
    out[#out + 1] = (i + 2 <= len) and B64_CHARS:sub(c4 + 1, c4 + 1) or '='
    i = i + 3
  end
  return table.concat(out)
end

function M.base64_decode(data)
  if not data or data == "" then return "" end
  data = data:gsub('[^A-Za-z0-9+/]', '')  -- strip padding/whitespace/newlines
  local out = {}
  local len = #data
  local i = 1
  while i <= len do
    local c1 = B64_LOOKUP[data:sub(i, i)] or 0
    local c2 = B64_LOOKUP[data:sub(i + 1, i + 1)] or 0
    local c3 = B64_LOOKUP[data:sub(i + 2, i + 2)]
    local c4 = B64_LOOKUP[data:sub(i + 3, i + 3)]
    local n = c1 * 262144 + c2 * 4096 + (c3 or 0) * 64 + (c4 or 0)
    out[#out + 1] = string.char(math.floor(n / 65536) % 256)
    if c3 ~= nil then out[#out + 1] = string.char(math.floor(n / 256) % 256) end
    if c4 ~= nil then out[#out + 1] = string.char(n % 256) end
    i = i + 4
  end
  return table.concat(out)
end

-- =============================================================================
-- Minimal JSON encode
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
    if val ~= val then return "null" end           -- NaN
    if val == math.huge or val == -math.huge then return "null" end  -- inf
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

-- =============================================================================
-- JSON decode
-- =============================================================================
-- A real recursive-descent decoder: string-aware (braces/brackets inside string
-- values never confuse it) and arbitrarily nested. This is what lets restore
-- read the full mixerState (FX params, sends) safely — the old brace-counting
-- approach miscounted on FX names containing { } [ ] characters.

local function json_decode_pure(str)
  local pos = 1
  local len = #str
  local parse_value  -- forward declaration

  local function skip_ws()
    local _, e = str:find('^[ \t\r\n]+', pos)
    if e then pos = e + 1 end
  end

  local function parse_string()
    pos = pos + 1  -- skip opening quote
    local buf = {}
    while pos <= len do
      local ch = str:sub(pos, pos)
      if ch == '"' then
        pos = pos + 1
        return table.concat(buf)
      elseif ch == '\\' then
        local nx = str:sub(pos + 1, pos + 1)
        if nx == 'n' then buf[#buf + 1] = '\n'; pos = pos + 2
        elseif nx == 't' then buf[#buf + 1] = '\t'; pos = pos + 2
        elseif nx == 'r' then buf[#buf + 1] = '\r'; pos = pos + 2
        elseif nx == 'b' then buf[#buf + 1] = '\b'; pos = pos + 2
        elseif nx == 'f' then buf[#buf + 1] = '\f'; pos = pos + 2
        elseif nx == 'u' then
          local cp = tonumber(str:sub(pos + 2, pos + 5), 16)
          if cp and cp < 128 then buf[#buf + 1] = string.char(cp)
          else buf[#buf + 1] = '?' end  -- non-ASCII \u (our encoder never emits these)
          pos = pos + 6
        else buf[#buf + 1] = nx; pos = pos + 2 end  -- \" \\ \/ and any other
      else
        buf[#buf + 1] = ch
        pos = pos + 1
      end
    end
    return table.concat(buf)  -- unterminated; best-effort
  end

  local function parse_number()
    local num_str = str:match('^%-?%d+%.?%d*[eE]?[%-+]?%d*', pos)
    if not num_str or num_str == "" then
      pos = pos + 1
      return 0
    end
    pos = pos + #num_str
    return tonumber(num_str) or 0
  end

  local function parse_object()
    pos = pos + 1  -- skip {
    local obj = {}
    skip_ws()
    if str:sub(pos, pos) == '}' then pos = pos + 1; return obj end
    while pos <= len do
      skip_ws()
      if str:sub(pos, pos) ~= '"' then break end
      local key = parse_string()
      skip_ws()
      if str:sub(pos, pos) ~= ':' then break end
      pos = pos + 1
      obj[key] = parse_value()
      skip_ws()
      local c = str:sub(pos, pos)
      if c == ',' then pos = pos + 1
      elseif c == '}' then pos = pos + 1; return obj
      else break end
    end
    return obj
  end

  local function parse_array()
    pos = pos + 1  -- skip [
    local arr = {}
    skip_ws()
    if str:sub(pos, pos) == ']' then pos = pos + 1; return arr end
    while pos <= len do
      arr[#arr + 1] = parse_value()
      skip_ws()
      local c = str:sub(pos, pos)
      if c == ',' then pos = pos + 1
      elseif c == ']' then pos = pos + 1; return arr
      else break end
    end
    return arr
  end

  parse_value = function()
    skip_ws()
    local ch = str:sub(pos, pos)
    if ch == '{' then return parse_object()
    elseif ch == '[' then return parse_array()
    elseif ch == '"' then return parse_string()
    elseif ch == '-' or ch:match('%d') then return parse_number()
    else
      local word = str:match('^[%a]+', pos)
      if word == 'true' then pos = pos + 4; return true
      elseif word == 'false' then pos = pos + 5; return false
      elseif word == 'null' then pos = pos + 4; return nil
      else
        pos = pos + (word and #word or 1)  -- unknown bareword (inf/nan); treat as 0
        return 0
      end
    end
  end

  return parse_value()
end

function M.json_decode(str)
  if type(str) ~= "string" then return nil end
  if reaper.CF_Json_Parse then
    local ok, val = reaper.CF_Json_Parse(str)
    if ok and type(val) == "table" then return val end
  end
  local ok, val = pcall(json_decode_pure, str)
  if ok then return val end
  return nil
end

-- =============================================================================
-- Flat top-level parser (cheap metadata reads for the snapshot list)
-- =============================================================================

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
      elseif next_ch == 'r' then result[#result + 1] = '\r'
      elseif next_ch == 'b' then result[#result + 1] = '\b'
      elseif next_ch == 'f' then result[#result + 1] = '\f'
      elseif next_ch == 'u' and str:sub(i + 2, i + 5):match('^%x%x%x%x$') then
        result[#result + 1] = utf8.char(tonumber(str:sub(i + 2, i + 5), 16))
        i = i + 4
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

-- Rough track count for legacy snapshots that don't store trackCount (capped).
local function count_tracks(content)
  local mixer_start = content:find('"mixerState"')
  if not mixer_start then return nil end
  local tracks_start = content:find('"tracks"', mixer_start)
  if not tracks_start then return nil end
  local arr_start = content:find('%[', tracks_start)
  if not arr_start then return nil end
  local cnt, depth, i = 0, 0, arr_start
  while i <= math.min(#content, arr_start + 50000) do
    local ch = content:sub(i, i)
    if ch == '[' or ch == '{' then
      depth = depth + 1
      if ch == '{' and depth == 2 then cnt = cnt + 1 end
    elseif ch == ']' or ch == '}' then
      depth = depth - 1
      if depth == 0 then break end
    end
    i = i + 1
  end
  return cnt > 0 and cnt or nil
end

-- Read just the metadata (name/description/timestamp/trackCount) cheaply.
-- save_snapshot writes metadata BEFORE mixerState, so the prefix is flat and
-- string-safe to parse. Falls back to a whole-file flat parse for old files.
local function read_snapshot_meta(content)
  local ms = content:find('"mixerState"')
  local prefix = ms and content:sub(1, ms - 1) or content
  local ok, obj = pcall(M.parse_flat_object, prefix)
  if ok and obj and obj.name then
    obj.timestamp = tonumber(obj.timestamp) or 0
    obj.trackCount = obj.trackCount and tonumber(obj.trackCount) or nil
    return obj
  end
  local ok2, obj2 = pcall(M.parse_flat_object, content)
  if ok2 and obj2 and obj2.name then
    obj2.timestamp = tonumber(obj2.timestamp) or 0
    obj2.trackCount = (obj2.trackCount and tonumber(obj2.trackCount)) or count_tracks(content)
    return obj2
  end
  return nil
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
        local meta = read_snapshot_meta(content)
        if meta and meta.name then
          result[#result + 1] = {
            name = meta.name,
            description = meta.description or "",
            timestamp = meta.timestamp or 0,
            trackCount = meta.trackCount,
            path = path,
          }
        end
      end
    end
    i = i + 1
  end
  -- Newest first, with a stable tiebreak (timestamps are 1-second granular, so
  -- before/after pairs saved in the same second must not reorder randomly).
  table.sort(result, function(a, b)
    if a.timestamp == b.timestamp then return a.name < b.name end
    return a.timestamp > b.timestamp
  end)
  return result
end

-- =============================================================================
-- Capture mixer state
-- =============================================================================

-- opts.fullChunk (default TRUE) — capture each track's exact state chunk
--   (GetTrackStateChunk), which faithfully reproduces every plugin's internal
--   state including Helix Native's internal SNAPSHOT selection. A param-VALUE
--   capture cannot do this: the Helix snapshot index lives in the opaque VST
--   chunk, not in the host-visible automatable parameter list, so a param-only
--   restore lands Helix on its default (clean) snapshot. This is the same fix
--   the MCP bridge uses; the action scripts share this lib so all of them
--   (quick-save / next / prev / manager) get faithful capture at once.
--   Set fullChunk=false for the legacy lightweight param-value capture.
function M.capture_mixer_state(opts)
  opts = opts or {}
  local full_chunk = opts.fullChunk ~= false  -- default true
  local state = { version = 2, fullChunk = full_chunk and true or false, tracks = {} }
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(track)
    local vol  = reaper.GetMediaTrackInfo_Value(track, "D_VOL")
    local pan  = reaper.GetMediaTrackInfo_Value(track, "D_PAN")
    local mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE")
    local solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")
    local color = reaper.GetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR")

    local track_entry = {
      index = i, name = name, color = color,
      volume = vol, pan = pan,
      mute = mute ~= 0, solo = solo ~= 0,
    }

    if full_chunk then
      -- Exact, complete track state: FX chain + each plugin's internal VST state
      -- (incl. Helix snapshot selection), routing, envelopes. Base64 so the
      -- chunk's quotes/newlines/{GUID} braces survive the JSON round-trip.
      local ok, chunk = reaper.GetTrackStateChunk(track, "", false)
      if ok and chunk and chunk ~= "" then
        track_entry.chunkB64 = M.base64_encode(chunk)
      end
    else
      -- Legacy lightweight capture: FX bypass/offline + param values + sends.
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

      track_entry.fx = fx_states
      track_entry.sends = sends
      track_entry.fxEnabled = fx_enabled
    end

    state.tracks[i + 1] = track_entry
  end
  return state
end

-- =============================================================================
-- Save
-- =============================================================================

function M.snapshot_exists(name)
  local f = io.open(M.snapshot_path(name), "rb")
  if f then f:close(); return true end
  return false
end

-- Captures and writes a snapshot. Metadata is written BEFORE mixerState so the
-- list can read name/timestamp/trackCount from a cheap, string-safe prefix.
-- Returns: ok, err, trackCount, path
function M.save_snapshot(name, description)
  if not name or name == "" then return false, "name required" end
  M.ensure_snapshot_dir()
  local state = M.capture_mixer_state()
  local ts = os.time() * 1000
  local content = "{"
    .. '"name":' .. json_encode_string(name) .. ","
    .. '"description":' .. json_encode_string(description or "") .. ","
    .. '"timestamp":' .. tostring(ts) .. ","
    .. '"trackCount":' .. tostring(#state.tracks) .. ","
    .. '"mixerState":' .. M.json_encode(state)
    .. "}"
  local path = M.snapshot_path(name)
  if not M.write_file_atomic(path, content) then
    return false, "Failed to write: " .. path
  end
  return true, nil, #state.tracks, path
end

-- =============================================================================
-- Restore (FULL v2 restore — parity with the MCP bridge)
-- =============================================================================
-- opts.restoreTrackMeta  (default false) — also restore track name + color
-- opts.restoreSendLevels (default true)  — restore send volume/pan/mute
-- Returns: ok, err, tracksRestored, warnings
function M.restore_snapshot(snap, opts)
  opts = opts or {}
  local restore_meta  = opts.restoreTrackMeta == true
  local restore_sends = opts.restoreSendLevels ~= false

  local content = M.read_file(snap.path)
  if not content then return false, "File not found" end

  local data = M.json_decode(content)
  if type(data) ~= "table" or type(data.mixerState) ~= "table" then
    return false, "Could not parse snapshot"
  end

  local state = data.mixerState
  local version = tonumber(state.version) or 1
  local tracks = state.tracks
  if type(tracks) ~= "table" then return false, "No tracks in snapshot" end

  local warnings = {}
  local function truthy(v) return v == true or v == "true" or v == 1 end

  reaper.Undo_BeginBlock()
  local restored = 0

  for _, ts in ipairs(tracks) do
    if type(ts) == "table" and ts.index ~= nil then
      local track = reaper.GetTrack(0, tonumber(ts.index))
      if track then
        -- Track identity check: warn (don't block) if the track at this index
        -- isn't the one that was saved — tracks may have been added/reordered.
        if ts.name and ts.name ~= "" then
          local _, cur = reaper.GetTrackName(track)
          if cur and cur ~= ts.name then
            warnings[#warnings + 1] = "Track " .. tostring(ts.index)
              .. ": is now '" .. cur .. "' (saved as '" .. ts.name .. "')"
          end
        end

        if ts.chunkB64 then
          -- Exact restore: replace the entire track state from the saved chunk.
          -- This faithfully reproduces each plugin's internal state (incl. Helix
          -- Native snapshot selection) which a parameter-value restore cannot.
          -- The chunk is this track's own state only, so sibling/child tracks
          -- (e.g. guitars under a folder) are untouched.
          if reaper.SetTrackStateChunk(track, M.base64_decode(ts.chunkB64), false) then
            restored = restored + 1
          else
            warnings[#warnings + 1] = "Track " .. tostring(ts.index) .. ": SetTrackStateChunk failed"
          end
        else
        -- Basic mixer state (all versions)
        if ts.volume ~= nil then reaper.SetMediaTrackInfo_Value(track, "D_VOL", tonumber(ts.volume)) end
        if ts.pan ~= nil then reaper.SetMediaTrackInfo_Value(track, "D_PAN", tonumber(ts.pan)) end
        if ts.mute ~= nil then reaper.SetMediaTrackInfo_Value(track, "B_MUTE", truthy(ts.mute) and 1 or 0) end
        if ts.solo ~= nil then reaper.SetMediaTrackInfo_Value(track, "I_SOLO", truthy(ts.solo) and 1 or 0) end

        -- Track metadata (v2, opt-in)
        if restore_meta and version >= 2 then
          if ts.name then reaper.GetSetMediaTrackInfo_String(track, "P_NAME", ts.name, true) end
          local col = tonumber(ts.color)
          if col and col ~= 0 then reaper.SetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR", col) end
        end

        -- FX state (v2: enabled/offline + params; v1: bypass only)
        if version >= 2 and type(ts.fx) == "table" then
          for j, fx in ipairs(ts.fx) do
            local fx_idx = j - 1
            if fx_idx < reaper.TrackFX_GetCount(track) then
              if fx.enabled ~= nil then reaper.TrackFX_SetEnabled(track, fx_idx, truthy(fx.enabled)) end
              if fx.offline ~= nil then reaper.TrackFX_SetOffline(track, fx_idx, truthy(fx.offline)) end
              -- Restore params only if the plugin name matches (avoid applying
              -- wrong values to a different plugin at the same chain index).
              if type(fx.params) == "table" and #fx.params > 0 then
                local _, cur_name = reaper.TrackFX_GetFXName(track, fx_idx)
                if cur_name == fx.name then
                  for p, val in ipairs(fx.params) do
                    reaper.TrackFX_SetParam(track, fx_idx, p - 1, tonumber(val) or 0)
                  end
                else
                  warnings[#warnings + 1] = "Track " .. tostring(ts.index) .. " FX " .. fx_idx
                    .. ": plugin changed, params skipped"
                end
              end
            end
          end
        elseif type(ts.fxEnabled) == "table" then
          for j, en in ipairs(ts.fxEnabled) do
            local fx_idx = j - 1
            if fx_idx < reaper.TrackFX_GetCount(track) then
              reaper.TrackFX_SetEnabled(track, fx_idx, truthy(en))
            end
          end
        end

        -- Send levels (v2, default on) — matched by destination track index
        if version >= 2 and restore_sends and type(ts.sends) == "table" then
          local send_count = reaper.GetTrackNumSends(track, 0)
          for _, sv in ipairs(ts.sends) do
            for s = 0, send_count - 1 do
              local dest = reaper.GetTrackSendInfo_Value(track, 0, s, "P_DESTTRACK")
              if dest then
                local dest_idx = reaper.GetMediaTrackInfo_Value(dest, "IP_TRACKNUMBER") - 1
                if dest_idx == tonumber(sv.destTrackIndex) then
                  reaper.SetTrackSendInfo_Value(track, 0, s, "D_VOL", tonumber(sv.volume) or 1)
                  reaper.SetTrackSendInfo_Value(track, 0, s, "D_PAN", tonumber(sv.pan) or 0)
                  reaper.SetTrackSendInfo_Value(track, 0, s, "B_MUTE", truthy(sv.muted) and 1 or 0)
                  break
                end
              end
            end
          end
        end

        restored = restored + 1
        end  -- close: chunkB64 vs legacy param-value restore
      end
    end
  end

  reaper.Undo_EndBlock("MCP Snapshot: Restore '" .. snap.name .. "'", -1)
  reaper.TrackList_AdjustWindows(false)
  reaper.UpdateArrange()
  return true, nil, restored, warnings
end

-- =============================================================================
-- Delete
-- =============================================================================

function M.delete_snapshot(snap)
  local ok, err = os.remove(snap.path)
  if not ok then return false, err or "unknown error" end
  return true
end

-- =============================================================================
-- Persisted current-snapshot (by name) for A/B next/prev
-- =============================================================================

function M.get_current_name()
  local v = reaper.GetExtState(M.EXT_SECTION, M.EXT_KEY_NAME)
  if v == "" then return nil end
  return v
end

function M.set_current_name(name)
  reaper.SetExtState(M.EXT_SECTION, M.EXT_KEY_NAME, name or "", false)
end

-- =============================================================================
-- Toast (brief feedback in the REAPER help bar)
-- =============================================================================

function M.toast(msg)
  reaper.Help_Set(msg, false)
end

return M
