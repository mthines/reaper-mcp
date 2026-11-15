-- mcp_render_lib.lua — renders tracks (post-FX) to temp WAVs for the analysis tools.
-- Pure logic over an injected ReaScript API (and an optional io/os table), unit-tested via
-- wasmoon against a fake. Loaded by mcp_bridge.lua.
--
-- REAPER can only render through its progress window, which takes focus, so the point of this
-- lib is to render as rarely as possible:
--   * a cache keeps the last renders (per track and range) and hands them out again until the
--     project changes: any command that writes (`note_write`) or any change REAPER's own
--     project state counter sees, a render older than TTL, or a file that is gone;
--   * several tracks go through ONE stem render when they do not feed each other;
--   * on macOS the app that had focus is brought back after the render.
-- The cache owns its files (the server never deletes them): it evicts the oldest past
-- MAX_ENTRIES / MAX_BYTES and `purge` removes the rest on exit.

local M = {}

M.PREFIX = "mcp_render_"
M.LEGACY_PREFIX = "mcp_aes_"
M.SAMPLE_RATE = 44100
M.MAX_ENTRIES = 12
M.MAX_BYTES = 1500 * 1024 * 1024
M.TTL = 600 -- seconds
M.MAX_TRACKS = 16
M.REAPER_BUNDLE = "com.cockos.reaper"
M.MAX_DRY_SECONDS = 120 -- a dry read blocks REAPER while it reads: longer ranges go to a real render
M.DRY_CHUNK = 220500    -- samples per channel read at a time (5 s at 44100), so memory stays small
M.JUNCTION_MARGIN = 0.5 -- s: an item end this close before the range still counts as inside it
M.JUNCTION_REACH = 5.5  -- s: how far after an item's end another item makes it a junction (a read is 5 s)

local epoch = 0   -- bumped by every command that writes: a parameter set through the API may not move REAPER's counter
local cache = {}  -- oldest first: { key, path, bytes, at, stamp }
local passes = 0  -- makes every render's file names unique within one bridge run

local function num(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function int(v) return num(v) and v == math.floor(v) end

local function mkenv(e)
  e = e or {}
  local o = e.os or os
  return { io = e.io or io, os = o, now = e.now or o.time }
end

--- A command that may change what a render sounds like ran: every cached render is stale
function M.note_write() epoch = epoch + 1 end

--- Forget everything without touching files (tests)
function M.reset() epoch = 0; cache = {}; passes = 0 end

function M.cached_count() return #cache end

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

local function file_info(env, path)
  local f = env.io.open(path, "rb")
  if not f then return nil end
  local magic = f:read(4)
  local size = 0
  if f.seek then
    local ok, s = pcall(f.seek, f, "end")
    if ok and num(s) then size = s end
  end
  f:close()
  return { wav = magic == "RIFF", magic = magic, bytes = size }
end

local function remove_file(env, path) pcall(env.os.remove, path) end

local function temp_dir(reaper, env)
  local dir
  if reaper.GetTempPath then
    dir = reaper.GetTempPath()
  else
    local t = env.os.tmpname()
    dir = t:match("^(.+)[/\\][^/\\]+$") or "/tmp"
    env.os.remove(t)
  end
  if dir:sub(-1) ~= "/" and dir:sub(-1) ~= "\\" then dir = dir .. "/" end
  return dir
end

-- ---------------------------------------------------------------------------
-- Cache
-- ---------------------------------------------------------------------------

-- The project's state as the cache sees it: our write counter plus REAPER's own. nil when REAPER
-- cannot say, which turns the cache off.
local function stamp_parts(reaper)
  if not reaper.GetProjectStateChangeCount then return nil end
  return epoch, reaper.GetProjectStateChangeCount(0)
end
local function stamp_of(reaper)
  local e, c = stamp_parts(reaper)
  return e and (e .. ":" .. tostring(c)) or nil
end

local function drop(env, i)
  local entry = table.remove(cache, i)
  if entry then remove_file(env, entry.path) end
end

-- Entries from another project state, past their TTL or whose file is gone
local function drop_stale(env, stamp)
  local now = env.now()
  for i = #cache, 1, -1 do
    local e = cache[i]
    if stamp == nil or e.stamp ~= stamp or now - e.at > M.TTL then
      drop(env, i)
    elseif not file_info(env, e.path) then
      table.remove(cache, i)
    end
  end
end

local function lookup(env, key)
  for i, e in ipairs(cache) do
    if e.key == key then
      table.remove(cache, i)
      cache[#cache + 1] = e -- most recently used last
      return e
    end
  end
end

local function store(env, entry)
  for i = #cache, 1, -1 do
    if cache[i].key == entry.key then drop(env, i) end
  end
  cache[#cache + 1] = entry
  local total = 0
  for _, e in ipairs(cache) do total = total + e.bytes end
  -- Never evict the render just made, even when it alone is over the budget
  while #cache > 1 and (#cache > M.MAX_ENTRIES or total > M.MAX_BYTES) do
    total = total - cache[1].bytes
    drop(env, 1)
  end
end

--- Delete every cached render (bridge exit)
function M.purge(e)
  local env = mkenv(e)
  while #cache > 0 do drop(env, #cache) end
end

--- Delete renders a previous bridge run left in the temp folder
function M.sweep(reaper, e)
  local env = mkenv(e)
  if not reaper.EnumerateFiles then return 0 end
  local dir = temp_dir(reaper, env)
  local doomed = {}
  local i = 0
  while true do
    local name = reaper.EnumerateFiles(dir, i)
    if not name then break end
    if name:sub(-4) == ".wav" and (name:sub(1, #M.PREFIX) == M.PREFIX or name:sub(1, #M.LEGACY_PREFIX) == M.LEGACY_PREFIX) then
      doomed[#doomed + 1] = name
    end
    i = i + 1
  end
  for _, name in ipairs(doomed) do remove_file(env, dir .. name) end
  return #doomed
end

-- ---------------------------------------------------------------------------
-- Focus (macOS)
-- ---------------------------------------------------------------------------

local function is_mac(reaper)
  local name = reaper.GetOS and reaper.GetOS() or ""
  return name:find("^OSX") ~= nil or name:find("^macOS") ~= nil
end

local function current_front(reaper)
  if not (is_mac(reaper) and reaper.ExecProcess) then return nil end
  local ok, out = pcall(reaper.ExecProcess,
    "/bin/sh -c 'lsappinfo info -only bundleid \"$(lsappinfo front)\"'", 1500)
  if not ok or type(out) ~= "string" then return nil end
  local id = out:match('"CFBundleIdentifier"%s*=%s*"([^"]+)"')
  -- The id goes on a command line: only the characters a bundle id has
  if not id or not id:match("^[%w%.%-_]+$") then return nil end
  return id
end

--- Bundle id of the app that has focus, when it is not REAPER (nil: nothing to bring back)
function M.front_app(reaper)
  local id = current_front(reaper)
  return id ~= M.REAPER_BUNDLE and id or nil
end

--- Bring the app front_app saw back to the front, if REAPER (its render window) now has focus. Someone
--- who switched to another app during a long render is left where they went.
function M.restore_front(reaper, id)
  if not id or not reaper.ExecProcess then return false end
  if current_front(reaper) ~= M.REAPER_BUNDLE then return false end
  local ok = pcall(reaper.ExecProcess, "/usr/bin/open -b " .. id, 2000)
  return ok
end

-- ---------------------------------------------------------------------------
-- Render
-- ---------------------------------------------------------------------------

local function track_name(reaper, track, index, master)
  if master then return "MASTER" end
  local name = ({reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)})[2] or ""
  if name == "" then name = "Track " .. (index + 1) end
  return name
end

local function track_id(reaper, t)
  if t.master then return "master" end
  return reaper.GetTrackGUID and reaper.GetTrackGUID(t.track) or ("#" .. t.index)
end

-- Two tracks feed each other (folder parent/child, a send between them): rendered together, the
-- one's stem could carry the other, so they never share a render
local function related(reaper, a, b)
  local function ancestor(x, y)
    if not reaper.GetParentTrack then return false end
    local p = reaper.GetParentTrack(y)
    local guard = 0
    while p and guard < 64 do
      if p == x then return true end
      p = reaper.GetParentTrack(p)
      guard = guard + 1
    end
    return false
  end
  local function sends(x, y)
    if not (reaper.GetTrackNumSends and reaper.GetTrackSendInfo_Value) then return false end
    for i = 0, reaper.GetTrackNumSends(x, 0) - 1 do
      if reaper.GetTrackSendInfo_Value(x, 0, i, "P_DESTTRACK") == y then return true end
    end
    return false
  end
  return ancestor(a, b) or ancestor(b, a) or sends(a, b) or sends(b, a)
end

local function capture(reaper)
  local s = {}
  local function str(key) return ({reaper.GetSetProjectInfo_String(0, key, "", false)})[2] or "" end
  local function val(key) return reaper.GetSetProjectInfo(0, key, 0, false) end
  s.file, s.pattern, s.format, s.format2 = str("RENDER_FILE"), str("RENDER_PATTERN"), str("RENDER_FORMAT"), str("RENDER_FORMAT2")
  s.bounds, s.settings = val("RENDER_BOUNDSFLAG"), val("RENDER_SETTINGS")
  s.start, s.stop = val("RENDER_STARTPOS"), val("RENDER_ENDPOS")
  s.srate, s.channels = val("RENDER_SRATE"), val("RENDER_CHANNELS")
  -- Delivery processing set_render_settings stores in the project: an analysis render must hear the raw mix
  s.normalize, s.dither = val("RENDER_NORMALIZE"), val("RENDER_DITHER")
  s.count = reaper.CountTracks(0)
  s.solo, s.selected = {}, {}
  for i = 0, s.count - 1 do
    local t = reaper.GetTrack(0, i)
    s.solo[i] = reaper.GetMediaTrackInfo_Value(t, "I_SOLO")
    s.selected[i] = reaper.IsTrackSelected(t)
  end
  return s
end

local function restore(reaper, s)
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE", s.file, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", s.pattern, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", s.format, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT2", s.format2, true)
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", s.bounds, true)
  reaper.GetSetProjectInfo(0, "RENDER_SETTINGS", s.settings, true)
  reaper.GetSetProjectInfo(0, "RENDER_STARTPOS", s.start, true)
  reaper.GetSetProjectInfo(0, "RENDER_ENDPOS", s.stop, true)
  reaper.GetSetProjectInfo(0, "RENDER_SRATE", s.srate, true)
  reaper.GetSetProjectInfo(0, "RENDER_CHANNELS", s.channels, true)
  reaper.GetSetProjectInfo(0, "RENDER_NORMALIZE", s.normalize, true)
  reaper.GetSetProjectInfo(0, "RENDER_DITHER", s.dither, true)
  for i = 0, s.count - 1 do
    local t = reaper.GetTrack(0, i)
    reaper.SetMediaTrackInfo_Value(t, "I_SOLO", s.solo[i] or 0)
    reaper.SetTrackSelected(t, s.selected[i] or false)
  end
end

-- Output, bounds and format a render of the analysis tools always uses
local function apply_common(reaper, dir, start, stop)
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE", dir, true)
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, true) -- custom time range
  reaper.GetSetProjectInfo(0, "RENDER_STARTPOS", start, true)
  reaper.GetSetProjectInfo(0, "RENDER_ENDPOS", stop, true)
  -- WAV at 44100 Hz stereo, whatever the user last rendered. "evaw" is REAPER's WAV fourcc
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "evaw", true)
  -- No secondary file: a format that cannot write at this rate (a video format a new project inherits)
  -- stops the render on a modal error, which blocks the bridge until someone closes it
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT2", "", true)
  reaper.GetSetProjectInfo(0, "RENDER_SRATE", M.SAMPLE_RATE, true)
  reaper.GetSetProjectInfo(0, "RENDER_CHANNELS", 2, true)
  reaper.GetSetProjectInfo(0, "RENDER_NORMALIZE", 0, true)
  reaper.GetSetProjectInfo(0, "RENDER_DITHER", 0, true)
end

local function solo_only(reaper, count, targets)
  for i = 0, count - 1 do reaper.SetMediaTrackInfo_Value(reaper.GetTrack(0, i), "I_SOLO", 0) end
  local first = true
  for _, t in ipairs(targets) do
    if not t.master then
      reaper.SetMediaTrackInfo_Value(t.track, "I_SOLO", 1)
      if first then reaper.SetOnlyTrackSelected(t.track); first = false else reaper.SetTrackSelected(t.track, true) end
    end
  end
end

-- One REAPER render for a group: the master mix alone, one track, or several unrelated tracks as
-- stems of the selection. Sets t.path on every target it rendered; leaves the rest for a fallback.
local function render_group(reaper, env, ctx, group)
  passes = passes + 1
  local base = M.PREFIX .. ctx.id .. "_" .. passes
  local master = group[1].master
  -- Render mode: 0 = the master mix; 3 = stems of the SELECTED tracks only (2 lists no target in
  -- REAPER 7 and silently renders the master mix instead)
  reaper.GetSetProjectInfo(0, "RENDER_SETTINGS", master and 0 or 3, true)
  solo_only(reaper, ctx.saved.count, group)
  if #group == 1 then
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", base, true)
    group[1].expect = ctx.dir .. base .. ".wav"
  else
    -- One file per stem: the pattern names the track number, and the targets REAPER lists tell which file is whose
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", base .. "_$tracknumber", true)
    local listed = ({reaper.GetSetProjectInfo_String(0, "RENDER_TARGETS", "", false)})[2] or ""
    local byNumber = {}
    for target in listed:gmatch("[^;\n]+") do
      local file = target:match("([^/\\]+)$") or target
      local n = file:match("^" .. base:gsub("%p", "%%%0") .. "_(%d+)")
      if n then byNumber[tonumber(n)] = target end
    end
    for _, t in ipairs(group) do
      t.expect = byNumber[t.index + 1]
      if not t.expect then return false end -- not what we predicted: nothing rendered, the caller goes one by one
    end
  end
  -- Action 42230 = render with the most recent settings, auto-close the dialog. Synchronous: it
  -- blocks the defer loop until the render is done
  reaper.Main_OnCommand(42230, 0)
  for _, t in ipairs(group) do t.rendered = t.expect end
  return true
end

-- ---------------------------------------------------------------------------
-- Dry read
-- ---------------------------------------------------------------------------
-- A render opens REAPER's progress window, which takes focus and blocks the UI. For tools that only
-- need the track's own audio, the audio accessor reads it in-process instead: the items as they
-- play (stretch markers, rate and item edits applied) BEFORE track FX, pan and the fader, with no
-- window and no focus change. It cannot hear what the track does not carry itself (a folder's
-- children, audio arriving by send, a MIDI instrument), so those tracks still get a real render.

local function has_accessor(reaper)
  return reaper.CreateTrackAudioAccessor and reaper.GetAudioAccessorSamples
    and reaper.DestroyAudioAccessor and reaper.new_array and true or false
end

-- The track's playback offset in seconds (0 when it is off); what a render hears
local function play_offset_s(reaper, track)
  local flag = reaper.GetMediaTrackInfo_Value(track, "I_PLAY_OFFSET_FLAG")
  if flag & 1 ~= 0 then return 0 end
  local v = reaper.GetMediaTrackInfo_Value(track, "D_PLAY_OFFSET")
  if flag & 2 ~= 0 then
    local srate = reaper.GetSetProjectInfo(0, "PROJECT_SRATE", 0, false)
    if not srate or srate <= 0 then srate = M.SAMPLE_RATE end
    return v / srate
  end
  return v
end

-- Take FX the accessor hears: REAPER's own (JS:, Cockos). A third-party take FX (Melodyne seen live,
-- REAPER 7.40) can make it return silence, so such an item is left to a real render.
local function take_fx_readable(reaper, take)
  if not reaper.TakeFX_GetCount then return true end
  for k = 0, reaper.TakeFX_GetCount(take) - 1 do
    local _, name = reaper.TakeFX_GetFXName(take, k, "")
    name = tostring(name or "")
    if not (name:match("^JS:") or name:find("(Cockos)", 1, true)) then return false end
  end
  return true
end

-- Whether a dry read of this track over the range says what the track plays: audio items only,
-- not a folder parent, not the master, and a range short enough to read in one go
local function dry_eligible(reaper, t, start, stop)
  if t.master or not has_accessor(reaper) then return false end
  if stop - start > M.MAX_DRY_SECONDS then return false end
  if reaper.GetMediaTrackInfo_Value(t.track, "I_FOLDERDEPTH") == 1 then return false end
  -- audio arriving by send is not in the track's own items
  if reaper.GetTrackNumSends and reaper.GetTrackNumSends(t.track, -1) > 0 then return false end
  local off = play_offset_s(reaper, t.track)
  if start - off < 0 then return false end -- the accessor has no audio before the project start
  local audio = false
  local spans = {}
  for j = 0, reaper.CountTrackMediaItems(t.track) - 1 do
    local item = reaper.GetTrackMediaItem(t.track, j)
    local p = reaper.GetMediaItemInfo_Value(item, "D_POSITION") + off
    local l = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
    spans[#spans + 1] = { p, p + l }
    if p < stop and p + l > start then
      local take = reaper.GetActiveTake(item)
      if take and not reaper.TakeIsMIDI(take) then audio = true else return false end
      if not take_fx_readable(reaper, take) then return false end
    end
  end
  if not audio then return false end
  -- Where one item ends and another plays on right after it (a split, a crossfade, an overlap), the
  -- accessor can run the first item's source on into a read that crosses its end, with different
  -- audio each time (seen live in REAPER 7.40). Reads that start after the junction, or end before
  -- it, are exact: only a range with such a junction in it is left to a real render.
  for _, a in ipairs(spans) do
    if a[2] > start - M.JUNCTION_MARGIN and a[2] < stop then
      for _, b in ipairs(spans) do
        if b ~= a and b[1] < a[2] + M.JUNCTION_REACH and b[2] > a[2] then return false end
      end
    end
  end
  return true
end

local function pcm24(x)
  if x ~= x then return 0 end
  local v = math.floor(x * 8388607 + 0.5)
  if v > 8388607 then return 8388607 elseif v < -8388608 then return -8388608 end
  return v
end

-- Interleaved float samples -> little-endian 24-bit PCM
local function pack24(samples, count)
  local parts, i = {}, 1
  while i <= count do
    local m = math.min(1536, count - i + 1)
    local ints = {}
    for k = 1, m do ints[k] = pcm24(samples[i + k - 1]) end
    parts[#parts + 1] = string.pack("<" .. string.rep("i3", m), table.unpack(ints))
    i = i + m
  end
  return table.concat(parts)
end

-- The spans of project time the track's items cover (sorted, merged), moved by the playback offset
local function item_spans(reaper, track, off)
  local spans = {}
  for j = 0, reaper.CountTrackMediaItems(track) - 1 do
    local item = reaper.GetTrackMediaItem(track, j)
    local p = reaper.GetMediaItemInfo_Value(item, "D_POSITION") + off
    local e = p + reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
    spans[#spans + 1] = { p, e }
  end
  table.sort(spans, function(a, b) return a[1] < b[1] end)
  local merged = {}
  for _, sp in ipairs(spans) do
    local last = merged[#merged]
    if last and sp[1] <= last[2] then
      if sp[2] > last[2] then last[2] = sp[2] end
    else
      merged[#merged + 1] = { sp[1], sp[2] }
    end
  end
  return merged
end

-- Silence the frames of an interleaved stereo chunk that no item covers (the accessor plays on
-- past the end of an item whose source goes on). t0 = project time of the first frame.
local function silence_outside(samples, frames, t0, sr, spans)
  local function frame_at(t) return math.max(0, math.min(frames, math.floor((t - t0) * sr + 0.5))) end
  local function zero(a, b) for k = a, b - 1 do samples[k * 2 + 1] = 0; samples[k * 2 + 2] = 0 end end
  local pos = 0
  for _, sp in ipairs(spans) do
    local a, b = frame_at(sp[1]), frame_at(sp[2])
    if a > pos then zero(pos, a) end
    if b > pos then pos = b end
    if pos >= frames then return end
  end
  zero(pos, frames)
end

-- Read [start, stop) of a track's own audio into a 24-bit stereo WAV at SAMPLE_RATE. true, or false + reason
-- (the half-written file is removed).
local function dry_read(reaper, env, path, track, start, stop)
  local sr = M.SAMPLE_RATE
  local total = math.floor((stop - start) * sr + 0.5)
  local f = env.io.open(path, "wb")
  if not f then return false, "cannot write " .. path end
  local bytes = total * 6
  f:write("RIFF", string.pack("<I4", 36 + bytes), "WAVEfmt ", string.pack("<I4I2I2I4I4I2I2", 16, 1, 2, sr, sr * 6, 6, 24),
    "data", string.pack("<I4", bytes))
  local acc = reaper.CreateTrackAudioAccessor(track)
  -- What a render also hears: the track's playback offset and polarity switch
  local off = play_offset_s(reaper, track)
  local sign = reaper.GetMediaTrackInfo_Value(track, "B_PHASE") ~= 0 and -1 or 1
  local spans = item_spans(reaper, track, off)
  local ok, err = pcall(function()
    local done = 0
    while done < total do
      local n = math.min(M.DRY_CHUNK, total - done)
      local t0 = start + done / sr
      local buf = reaper.new_array(n * 2)
      local ret = reaper.GetAudioAccessorSamples(acc, sr, 2, t0 - off, n, buf)
      if ret < 0 then error("audio accessor read failed (" .. tostring(ret) .. ")") end
      if ret == 0 then
        -- the accessor has no audio here: silence
        f:write(string.rep("\0", n * 6))
      else
        local samples = buf.table(1, n * 2)
        silence_outside(samples, n, t0, sr, spans)
        if sign < 0 then for k = 1, n * 2 do samples[k] = -samples[k] end end
        f:write(pack24(samples, n * 2))
      end
      done = done + n
    end
  end)
  pcall(reaper.DestroyAudioAccessor, acc)
  f:close()
  if not ok then remove_file(env, path); return false, tostring(err) end
  return true
end

local function playback_info(reaper, t)
  local offset_ms, inverted = 0, false
  if not t.master then
    local flag = reaper.GetMediaTrackInfo_Value(t.track, "I_PLAY_OFFSET_FLAG")
    if flag & 1 == 0 then
      local v = reaper.GetMediaTrackInfo_Value(t.track, "D_PLAY_OFFSET")
      local srate = reaper.GetSetProjectInfo(0, "PROJECT_SRATE", 0, false)
      if not srate or srate <= 0 then srate = M.SAMPLE_RATE end
      offset_ms = (flag & 2 ~= 0) and (v / srate * 1000) or (v * 1000)
    end
    inverted = reaper.GetMediaTrackInfo_Value(t.track, "B_PHASE") ~= 0
  end
  return offset_ms, inverted
end

--- Render (or reuse) the given tracks over a range.
--- params: trackIndices (0-based, -1 = master), startTime, endTime, commandId, fresh (skip the
--- cache), restoreFocus (false: leave focus where the render put it).
--- Returns { tracks = { per track, in order }, rendered = n, cached = n } or nil, error.
function M.render_tracks(reaper, params, e)
  local env = mkenv(e)
  local indices = params.trackIndices
  if type(indices) ~= "table" or #indices == 0 then return nil, "Missing required param: trackIndices" end
  if #indices > M.MAX_TRACKS then return nil, "Too many tracks: max " .. M.MAX_TRACKS .. " per call" end
  if not (num(params.startTime) and num(params.endTime)) then return nil, "Missing required params: startTime, endTime" end
  if params.endTime <= params.startTime then return nil, "endTime must be greater than startTime" end

  -- Resolve everything before anything is touched
  local seen, targets = {}, {}
  for i, idx in ipairs(indices) do
    if not (int(idx) and idx >= -1) then return nil, "Bad track index: " .. tostring(idx) end
    if seen[idx] then return nil, "trackIndices must not repeat a track" end
    seen[idx] = true
    local master = idx == -1
    local track = master and reaper.GetMasterTrack(0) or reaper.GetTrack(0, idx)
    if not track then return nil, "Track " .. tostring(idx) .. " not found" end
    targets[i] = { index = idx, track = track, master = master, name = track_name(reaper, track, idx, master) }
    targets[i].key = string.format("%s|%.4f|%.4f", track_id(reaper, targets[i]), params.startTime, params.endTime)
    -- dry: read the track's own audio instead of rendering it, where that says what the track plays.
    -- A dry read is cached under its own key: it is not what a render of the track sounds like.
    if params.dry == true and dry_eligible(reaper, targets[i], params.startTime, params.endTime) then
      targets[i].planned_dry = true
      targets[i].key = targets[i].key .. "|dry"
    end
  end

  local stamp = stamp_of(reaper)
  drop_stale(env, stamp)
  local cached = 0
  local missing = {}
  for _, t in ipairs(targets) do
    local hit = stamp and params.fresh ~= true and lookup(env, t.key)
    if hit then
      t.path, t.cached, t.dry = hit.path, true, t.planned_dry == true
      cached = cached + 1
    else
      missing[#missing + 1] = t
    end
  end

  -- Dry reads first: no window, no focus change. A track whose read fails is rendered after all.
  local dry_count = 0
  if #missing > 0 and params.dry == true then
    local rest = {}
    local id = tostring(params.commandId or env.now()):gsub("-", ""):sub(1, 16)
    for _, t in ipairs(missing) do
      local done = false
      if t.planned_dry then
        passes = passes + 1
        local path = temp_dir(reaper, env) .. M.PREFIX .. "dry_" .. id .. "_" .. passes .. ".wav"
        local ok, res = pcall(dry_read, reaper, env, path, t.track, params.startTime, params.endTime)
        if ok and res then
          local info = file_info(env, path)
          t.path, t.dry, done = path, true, true
          dry_count = dry_count + 1
          if stamp and info then store(env, { key = t.key, path = path, bytes = info.bytes, at = env.now(), stamp = stamp }) end
        else
          t.planned_dry = false
          t.key = t.key:gsub("|dry$", "")
        end
      end
      if not done then rest[#rest + 1] = t end
    end
    missing = rest
  end

  if #missing > 0 then
    local ctx = {
      id = tostring(params.commandId or env.now()):gsub("-", ""):sub(1, 16),
      dir = temp_dir(reaper, env),
      saved = capture(reaper),
    }
    local front = params.restoreFocus ~= false and M.front_app(reaper) or nil

    local ok, err = pcall(function()
      apply_common(reaper, ctx.dir, params.startTime, params.endTime)
      -- The master is its own render. The tracks go together where they do not feed each other
      local groups, loose = {}, {}
      for _, t in ipairs(missing) do
        if t.master then
          groups[#groups + 1] = { t }
        else
          local placed = false
          for _, g in ipairs(loose) do
            local free = true
            for _, o in ipairs(g) do if related(reaper, t.track, o.track) then free = false; break end end
            if free then g[#g + 1] = t; placed = true; break end
          end
          if not placed then loose[#loose + 1] = { t } end
        end
      end
      for _, g in ipairs(loose) do groups[#groups + 1] = g end
      for _, g in ipairs(groups) do
        if not render_group(reaper, env, ctx, g) then
          -- The stems' files could not be told apart: one render per track instead
          for _, t in ipairs(g) do render_group(reaper, env, ctx, { t }) end
        end
      end
    end)

    local restored, rerr = pcall(restore, reaper, ctx.saved)
    if not restored then
      reaper.ShowConsoleMsg("[reaper-mcp] Warning: failed to restore render settings: " .. tostring(rerr) .. "\n")
    end
    M.restore_front(reaper, front)
    if not ok then return nil, "Render failed: " .. tostring(err) end

    -- Our own settings writes may have moved REAPER's counter: renders cached before this pass are
    -- still good when nothing else changed since the lookup, so they follow the counter
    local after = stamp_of(reaper)
    if stamp and after and after ~= stamp then
      for _, c in ipairs(cache) do if c.stamp == stamp then c.stamp = after end end
    end

    for _, t in ipairs(missing) do
      local path = t.rendered
      local info = path and file_info(env, path)
      if not info then
        return nil, "Render produced no output file at: " .. tostring(path or t.expect)
      end
      -- RENDER_FORMAT was set to "evaw"; if REAPER ignored it the file could be any codec the user last rendered.
      -- Fail here rather than in the sidecar with a confusing "Cannot read audio file"
      if not info.wav then
        remove_file(env, path)
        return nil, "Render produced a non-WAV file (RENDER_FORMAT may not have been applied). " ..
          "First 4 bytes: " .. (info.magic and string.format("%q", info.magic) or "<empty>")
      end
      t.path = path
      if after then
        store(env, { key = t.key, path = path, bytes = info.bytes, at = env.now(), stamp = after })
      end
    end
  end

  local out = {}
  for i, t in ipairs(targets) do
    local offset_ms, inverted = playback_info(reaper, t)
    out[i] = {
      trackIndex = t.index,
      trackName = t.name,
      wavPath = t.path,
      durationSeconds = params.endTime - params.startTime,
      sampleRate = M.SAMPLE_RATE,
      channelCount = 2,
      playOffsetMs = offset_ms,
      phaseInverted = inverted,
      cached = t.cached == true,
      -- true: the track's own audio before its FX, pan and fader (read, not rendered)
      dry = t.dry == true,
      -- The cache deletes its files itself: callers must leave them alone
      cacheOwned = true,
    }
  end
  return { tracks = out, rendered = #missing, cached = cached, dryRead = dry_count }
end

--- One track: the shape render_track_to_wav has always returned
function M.render_track(reaper, params, e)
  if params.trackIndex == nil then return nil, "Missing required param: trackIndex" end
  local p = {}
  for k, v in pairs(params) do p[k] = v end
  p.trackIndices = { params.trackIndex }
  local res, err = M.render_tracks(reaper, p, e)
  if not res then return nil, err end
  return res.tracks[1]
end

return M
