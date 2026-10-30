-- mcp_project_lib.lua — project operations, tempo map and marker editing.
--
-- Pure logic: every function takes the ReaScript API as `api` (and, where a
-- file is involved, an `fs` table: exists(path), dir_exists(path),
-- remove(path)), so it runs under a fake API in unit tests. Loaded by
-- mcp_bridge.lua with dofile.
--
-- Every function returns a result table, or nil and a reason. A refused
-- request is validated in full before the first write, so it changes nothing.
-- Nothing here opens a dialog: a save without a path on a never-saved
-- project, and a render over existing files, are refused instead.

local M = {}

local UNDO_ALL = -1

local function edit(api, label, fn)
  api.Undo_BeginBlock()
  local ok, err = pcall(fn)
  api.Undo_EndBlock("MCP: " .. label, UNDO_ALL)
  if not ok then error(err, 0) end
end

local function is_int(v) return type(v) == "number" and v == math.floor(v) end

local function project_path(api)
  local _, path = api.EnumProjects(-1, "")
  return path or ""
end

-- ---------------------------------------------------------------------------
-- Undo / redo
-- ---------------------------------------------------------------------------

local function undo_state(api)
  return { nextUndo = api.Undo_CanUndo2(0), nextRedo = api.Undo_CanRedo2(0) }
end

--- undo_project: undo the last undo point and report its label.
function M.undo(api)
  local label = api.Undo_CanUndo2(0)
  if not label or label == "" then return nil, "nothing to undo" end
  api.Undo_DoUndo2(0)
  if api.UpdateArrange then api.UpdateArrange() end
  if api.UpdateTimeline then api.UpdateTimeline() end
  local out = undo_state(api)
  out.undone = label
  return out
end

--- redo_project: redo the last undone point and report its label.
function M.redo(api)
  local label = api.Undo_CanRedo2(0)
  if not label or label == "" then return nil, "nothing to redo" end
  api.Undo_DoRedo2(0)
  if api.UpdateArrange then api.UpdateArrange() end
  if api.UpdateTimeline then api.UpdateTimeline() end
  local out = undo_state(api)
  out.redone = label
  return out
end

-- ---------------------------------------------------------------------------
-- Save
-- ---------------------------------------------------------------------------

local function parent_dir(path)
  return path:match("^(.*)[/\\][^/\\]*$")
end

--- save_project. Without a path, saves the project where it already lives; a
--- project that was never saved is refused (REAPER would ask where to save it
--- in a dialog, which blocks the bridge). With a path, writes the project to
--- that .rpp file; an existing different file is refused unless overwrite.
--- A path writes a copy (Main_SaveProjectEx, verified live): the open project
--- keeps its own path, so the result says savedAsCopy.
function M.save(api, params, fs)
  local current = project_path(api)
  local path = params.path
  if path == nil or path == "" then
    if current == "" then
      return nil, "refused: the project was never saved, so REAPER would open a Save As dialog — pass path (an absolute .rpp path) to save it"
    end
    api.Main_SaveProject(0, false)
    if not fs.exists(current) then return nil, "save failed: " .. current .. " does not exist after saving" end
    return { saved = true, path = current }
  end

  if type(path) ~= "string" or not path:lower():match("%.rpp$") then
    return nil, "path must end in .rpp"
  end
  if not (path:sub(1, 1) == "/" or path:match("^%a:[/\\]")) then
    return nil, "path must be absolute"
  end
  local dir = parent_dir(path)
  if not dir or not fs.dir_exists(dir) then
    return nil, "directory " .. tostring(dir) .. " does not exist"
  end
  if path ~= current and fs.exists(path) and params.overwrite ~= true then
    return nil, "refused: " .. path .. " already exists — pass overwrite: true to replace it"
  end
  api.Main_SaveProjectEx(0, path, 0)
  if not fs.exists(path) then return nil, "save failed: " .. path .. " does not exist after saving" end
  local now = project_path(api)
  return { saved = true, path = path, projectPath = now, savedAsCopy = now ~= path }
end

-- ---------------------------------------------------------------------------
-- Project settings + transport options
-- ---------------------------------------------------------------------------

M.METRONOME = 40364 -- Options: Toggle metronome (global, not per project)

--- get_project_settings
function M.get_settings(api)
  local _, title = api.GetSetProjectInfo_String(0, "PROJECT_TITLE", "", false)
  local _, author = api.GetSetProjectInfo_String(0, "PROJECT_AUTHOR", "", false)
  return {
    path = project_path(api),
    sampleRate = math.floor(api.GetSetProjectInfo(0, "PROJECT_SRATE", 0, false)),
    useProjectSampleRate = api.GetSetProjectInfo(0, "PROJECT_SRATE_USE", 0, false) == 1,
    title = title or "",
    author = author or "",
    notes = api.GetSetProjectNotes(0, false, ""),
    ["repeat"] = api.GetSetRepeatEx(0, -1) == 1,
    metronome = api.GetToggleCommandState(M.METRONOME) == 1,
  }
end

--- set_project_settings: any subset of get_settings' fields (minus path).
function M.set_settings(api, p)
  if p.sampleRate ~= nil and not (is_int(p.sampleRate) and p.sampleRate >= 8000 and p.sampleRate <= 768000) then
    return nil, "sampleRate must be an integer 8000-768000 — nothing changed"
  end
  for _, k in ipairs({ "title", "author", "notes" }) do
    if p[k] ~= nil and type(p[k]) ~= "string" then return nil, k .. " must be a string — nothing changed" end
  end
  for _, k in ipairs({ "useProjectSampleRate", "repeat", "metronome" }) do
    if p[k] ~= nil and type(p[k]) ~= "boolean" then return nil, k .. " must be true or false — nothing changed" end
  end

  local any = false
  for _, k in ipairs({ "sampleRate", "useProjectSampleRate", "title", "author", "notes" }) do
    if p[k] ~= nil then any = true end
  end
  if any then edit(api, "Set project settings", function()
    if p.sampleRate ~= nil then api.GetSetProjectInfo(0, "PROJECT_SRATE", p.sampleRate, true) end
    if p.useProjectSampleRate ~= nil then api.GetSetProjectInfo(0, "PROJECT_SRATE_USE", p.useProjectSampleRate and 1 or 0, true) end
    if p.title ~= nil then api.GetSetProjectInfo_String(0, "PROJECT_TITLE", p.title, true) end
    if p.author ~= nil then api.GetSetProjectInfo_String(0, "PROJECT_AUTHOR", p.author, true) end
    if p.notes ~= nil then api.GetSetProjectNotes(0, true, p.notes) end
  end) end
  -- Transport options are not undoable in REAPER; set outside the undo block.
  if p["repeat"] ~= nil then api.GetSetRepeatEx(0, p["repeat"] and 1 or 0) end
  if p.metronome ~= nil and (api.GetToggleCommandState(M.METRONOME) == 1) ~= p.metronome then
    api.Main_OnCommand(M.METRONOME, 0)
  end
  return M.get_settings(api)
end

-- ---------------------------------------------------------------------------
-- Tempo map
-- ---------------------------------------------------------------------------

--- Same shape as the bridge's get_tempo_map.
function M.tempo_map(api)
  local count = api.CountTempoTimeSigMarkers(0)
  local markers = {}
  for i = 0, count - 1 do
    local _, timepos, _, _, bpm, num, den, linear = api.GetTempoTimeSigMarker(0, i)
    markers[#markers + 1] = {
      index = i, position = timepos, bpm = bpm,
      timeSigNumerator = num, timeSigDenominator = den, linearTempo = linear,
    }
  end
  if count == 0 then
    local num, den = api.TimeMap_GetTimeSigAtTime(0, 0)
    markers[1] = { index = 0, position = 0, bpm = api.Master_GetTempo(), timeSigNumerator = num, timeSigDenominator = den, linearTempo = false }
  end
  return { markers = markers, count = #markers, tempoMarkerCount = count }
end

local function check_tempo_fields(p)
  if p.bpm ~= nil and (type(p.bpm) ~= "number" or p.bpm <= 0 or p.bpm > 960) then
    return "bpm must be > 0 and <= 960 — nothing changed"
  end
  if p.position ~= nil and (type(p.position) ~= "number" or p.position < 0) then
    return "position must be >= 0 seconds — nothing changed"
  end
  if p.timeSigNumerator ~= nil and not (is_int(p.timeSigNumerator) and p.timeSigNumerator >= 1 and p.timeSigNumerator <= 255) then
    return "timeSigNumerator must be 1-255 — nothing changed"
  end
  if p.timeSigDenominator ~= nil then
    local d = p.timeSigDenominator
    local ok = false
    for _, v in ipairs({ 1, 2, 4, 8, 16, 32, 64 }) do if d == v then ok = true end end
    if not ok then return "timeSigDenominator must be 1, 2, 4, 8, 16, 32 or 64 — nothing changed" end
  end
  if (p.timeSigNumerator == nil) ~= (p.timeSigDenominator == nil) then
    return "give timeSigNumerator and timeSigDenominator together — nothing changed"
  end
  return nil
end

local function tempo_count(api) return api.CountTempoTimeSigMarkers(0) end

local function check_tempo_index(api, idx)
  if not is_int(idx) or idx < 0 or idx >= tempo_count(api) then
    return "no tempo marker " .. tostring(idx) .. " (the project has " .. tempo_count(api) .. ") — nothing changed"
  end
  return nil
end

local function done_tempo(api)
  if api.UpdateTimeline then api.UpdateTimeline() end
  return M.tempo_map(api)
end

--- add_tempo_marker: { position (s), bpm, timeSigNumerator?, timeSigDenominator?, linear? }
function M.add_tempo_marker(api, p)
  if p.position == nil or p.bpm == nil then return nil, "position and bpm required" end
  local err = check_tempo_fields(p)
  if err then return nil, err end
  local before = tempo_count(api)
  edit(api, "Add tempo marker", function()
    api.SetTempoTimeSigMarker(0, -1, p.position, -1, -1, p.bpm,
      p.timeSigNumerator or 0, p.timeSigDenominator or 0, p.linear == true)
  end)
  local out = done_tempo(api)
  -- REAPER replaces a marker already at that position instead of adding one.
  if out.tempoMarkerCount == before then out.replacedExisting = true end
  return out
end

--- edit_tempo_marker: { index, position?, bpm?, timeSigNumerator?, timeSigDenominator?, linear? }
function M.edit_tempo_marker(api, p)
  local err = check_tempo_index(api, p.index) or check_tempo_fields(p)
  if err then return nil, err end
  local _, timepos, _, _, bpm, num, den, linear = api.GetTempoTimeSigMarker(0, p.index)
  local lin = linear
  if p.linear ~= nil then lin = p.linear == true end
  edit(api, "Edit tempo marker", function()
    api.SetTempoTimeSigMarker(0, p.index, p.position or timepos, -1, -1, p.bpm or bpm,
      p.timeSigNumerator or (num > 0 and num or 0), p.timeSigDenominator or (den > 0 and den or 0), lin)
  end)
  return done_tempo(api)
end

--- delete_tempo_marker: { index }
function M.delete_tempo_marker(api, p)
  local err = check_tempo_index(api, p.index)
  if err then return nil, err end
  local before = tempo_count(api)
  edit(api, "Delete tempo marker", function() api.DeleteTempoTimeSigMarker(0, p.index) end)
  if tempo_count(api) == before then
    -- Seen live (REAPER 7.40): the start marker carrying the time signature
    -- reports success but stays. Say so rather than claim a deletion.
    return nil, "REAPER did not delete tempo marker " .. p.index .. " (the marker at the project start cannot be removed this way) — nothing changed; use edit_tempo_marker or set_project_tempo to change it"
  end
  return done_tempo(api)
end

--- set_project_tempo: { bpm }. Sets the tempo at the project start: with no
--- tempo markers the project BPM; with a marker at 0 that marker's BPM;
--- otherwise a marker is added at 0 (REAPER's SetCurrentBPM would add one at
--- the edit cursor instead, so it is only used with no markers).
function M.set_tempo(api, p)
  if p.bpm == nil then return nil, "bpm required" end
  local err = check_tempo_fields({ bpm = p.bpm })
  if err then return nil, err end
  if tempo_count(api) == 0 then
    edit(api, "Set project tempo", function() api.SetCurrentBPM(0, p.bpm, false) end)
  else
    local _, timepos, _, _, _, num, den, linear = api.GetTempoTimeSigMarker(0, 0)
    edit(api, "Set project tempo", function()
      if timepos <= 1e-9 then
        api.SetTempoTimeSigMarker(0, 0, timepos, -1, -1, p.bpm, num > 0 and num or 0, den > 0 and den or 0, linear)
      else
        api.SetTempoTimeSigMarker(0, -1, 0, -1, -1, p.bpm, 0, 0, false)
      end
    end)
  end
  return done_tempo(api)
end

-- ---------------------------------------------------------------------------
-- Markers and regions
-- ---------------------------------------------------------------------------

local function find_marker(api, isrgn, number)
  local _, nm, nr = api.CountProjectMarkers(0)
  for i = 0, nm + nr - 1 do
    local _, rgn, pos, rend, name, idx, color = api.EnumProjectMarkers3(0, i)
    if rgn == isrgn and idx == number then
      return { pos = pos, rend = rend, name = name, color = color }
    end
  end
  return nil
end

local function native_color(c)
  if c == 0 then return 0 end
  return c | 0x1000000
end

local function edit_marker_or_region(api, p, isrgn)
  local key = isrgn and "regionIndex" or "markerIndex"
  local kind = isrgn and "region" or "marker"
  local number = p[key]
  if not is_int(number) then return nil, key .. " required" end
  local m = find_marker(api, isrgn, number)
  if not m then return nil, "no " .. kind .. " " .. number .. " — nothing changed" end
  if p.name ~= nil and type(p.name) ~= "string" then return nil, "name must be a string — nothing changed" end
  if p.color ~= nil and not (is_int(p.color) and p.color >= 0) then return nil, "color must be a native color int >= 0 — nothing changed" end

  local pos, rend = m.pos, m.rend
  if isrgn then
    pos, rend = p.start or pos, p["end"] or rend
    if type(pos) ~= "number" or pos < 0 or type(rend) ~= "number" or rend <= pos then
      return nil, "region end must be after start (both >= 0) — nothing changed"
    end
  else
    pos = p.position or pos
    if type(pos) ~= "number" or pos < 0 then return nil, "position must be >= 0 — nothing changed" end
  end
  local name = p.name or m.name
  -- color 0 means "leave unchanged" to SetProjectMarker4; keep the current one.
  local color = p.color ~= nil and native_color(p.color) or m.color
  local flags = (name == "") and 1 or 0 -- &1: clear the name

  edit(api, "Edit " .. kind, function()
    api.SetProjectMarker4(0, number, isrgn, pos, rend, name, color, flags)
  end)
  if api.UpdateArrange then api.UpdateArrange() end
  local now = find_marker(api, isrgn, number)
  if isrgn then
    return { index = number, name = now.name, start = now.pos, ["end"] = now.rend, color = now.color }
  end
  return { index = number, name = now.name, position = now.pos, color = now.color }
end

--- edit_marker: { markerIndex, name?, position?, color? }
function M.edit_marker(api, p) return edit_marker_or_region(api, p, false) end

--- edit_region: { regionIndex, name?, start?, end?, color? }
function M.edit_region(api, p) return edit_marker_or_region(api, p, true) end

-- ---------------------------------------------------------------------------
-- Render settings + render
-- ---------------------------------------------------------------------------
--
-- Encodings below were read off REAPER 7.40 (render probes, 2026-10-30):
--   RENDER_FORMAT is base64 of fourcc + config. wav: evaw + int16 bits (16, 24,
--   0x21 = 32-bit int, 0x20 = 32-bit float) + flags; aiff: ffia + int16 bits;
--   flac: calf + int32 bits + int32 compression; mp3: l3pm + int32 kbps, with
--   the same kbps again at byte 24.
--   RENDER_SETTINGS source bits: 0 master, 1 master + stems, 3 stems of the
--   selected tracks (2 lists no target in REAPER 7), 8 region render matrix
--   (needs region bounds), 32/64 selected items (via master), 128 selected
--   tracks via master; 512 embeds metadata.
--   RENDER_NORMALIZE: &1 on, &14 mode, &64 limit, &128 limit on true peak,
--   &256 only normalize files that are too loud; targets are linear amplitude.
--   RENDER_DITHER: &1/&2 dither / noise shaping on the master, &4/&8 on stems.
--   CalculateNormalization's target is in dB: with 0 the gain is the level.

-- Sink fourccs as REAPER stores them (byte-reversed).
M.FORMATS = { wav = "evaw", aiff = "ffia", flac = "calf", mp3 = "l3pm", ogg = "vggo", opus = "SggO" }
M.BOUNDS = { custom = 0, project = 1, time_selection = 2, all_regions = 3, selected_items = 4, selected_regions = 5 }
M.SOURCES = {
  master = 0, master_and_stems = 1, stems = 3, region_matrix = 8,
  selected_items = 32, selected_items_via_master = 64, selected_via_master = 128,
}
local SOURCE_MASK = 1 | 2 | 8 | 32 | 64 | 128
local EMBED_METADATA = 512
M.NORMALIZE = { lufs_i = 0, rms = 2, peak = 4, true_peak = 6, lufs_m_max = 8, lufs_s_max = 10 }
local NORM_ON, NORM_MODE, NORM_LIMIT, NORM_LIMIT_TP, NORM_TOO_LOUD = 1, 14, 64, 128, 256
-- Bit depth names per format → the code REAPER stores
local BIT_DEPTHS = {
  wav = { ["16"] = 16, ["24"] = 24, ["32"] = 0x21, ["32f"] = 0x20 },
  aiff = { ["16"] = 16, ["24"] = 24 },
  flac = { ["16"] = 16, ["24"] = 24 },
}
local MP3_BITRATES = { 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320 }
-- Friendly metadata fields → the RENDER_METADATA keys each one writes (WAV INFO/BWF/AXML, MP3 ID3, OGG/FLAC Vorbis)
M.METADATA = {
  title = { "ID3:TIT2", "INFO:INAM", "VORBIS:TITLE" },
  artist = { "ID3:TPE1", "INFO:IART", "VORBIS:ARTIST" },
  album = { "ID3:TALB", "INFO:IPRD", "VORBIS:ALBUM" },
  genre = { "ID3:TCON", "INFO:IGNR", "VORBIS:GENRE" },
  year = { "ID3:TYER", "INFO:ICRD", "VORBIS:DATE" },
  isrc = { "ID3:TSRC", "AXML:ISRC", "VORBIS:ISRC" },
  comment = { "ID3:COMM", "INFO:ICMT", "VORBIS:COMMENT" },
  description = { "BWF:Description" },
}
local MAX_ANALYZED = 16
local MAX_METADATA_KEYS = 64

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function b64decode(s)
  s = s:gsub("[^%w%+/=]", "")
  local out, bits, n = {}, 0, 0
  for i = 1, #s do
    local c = s:sub(i, i)
    if c == "=" then break end
    bits = (bits << 6) | (B64:find(c, 1, true) - 1)
    n = n + 6
    if n >= 8 then
      n = n - 8
      out[#out + 1] = string.char((bits >> n) & 0xFF)
    end
  end
  return table.concat(out)
end

local function b64encode(s)
  local out = {}
  for i = 1, #s, 3 do
    local a, b, c = s:byte(i, i + 2)
    local n = (a << 16) | ((b or 0) << 8) | (c or 0)
    for k = 3, 0, -1 do
      local idx = (n >> (k * 6)) & 63
      out[#out + 1] = B64:sub(idx + 1, idx + 1)
    end
    if not b then out[#out - 1] = "="; out[#out] = "=" elseif not c then out[#out] = "=" end
  end
  return table.concat(out)
end

-- The stored format as { name, raw config bytes } (name "other:<fourcc>" for sinks outside the list)
local function format_of(stored)
  if not stored or stored == "" then return nil end
  for name, cc in pairs(M.FORMATS) do
    if stored == cc then return name, cc end
  end
  local raw = b64decode(stored)
  local cc = raw:sub(1, 4)
  for name, want in pairs(M.FORMATS) do
    if cc == want then return name, raw end
  end
  return "other:" .. cc, raw
end

local function format_name(stored) return (format_of(stored)) end

-- Bit depth / bitrate as configured in the stored blob (nil when REAPER keeps its defaults)
local function format_options(name, raw)
  if not raw or #raw < 6 then return {} end
  if name == "wav" or name == "aiff" or name == "flac" then
    local code = name == "flac" and #raw >= 8 and string.unpack("<i4", raw, 5) or string.unpack("<I2", raw, 5)
    for label, c in pairs(BIT_DEPTHS[name]) do
      if c == code then return { bitDepth = label } end
    end
    return { bitDepth = tostring(code) }
  elseif name == "mp3" and #raw >= 8 then
    return { mp3Bitrate = string.unpack("<i4", raw, 5) }
  end
  return {}
end

-- The new blob for format `name` with a bit depth or bitrate; `raw` is the current config when it is the same format
local function build_format(name, raw, bit_depth, kbps)
  if name == "flac" then
    local level = raw and #raw >= 12 and string.unpack("<i4", raw, 9) or 5
    return b64encode("calf" .. string.pack("<i4i4", BIT_DEPTHS.flac[bit_depth], level) .. (raw and raw:sub(13) or ""))
  elseif name == "wav" or name == "aiff" then
    local rest = raw and #raw >= 6 and raw:sub(7) or (name == "wav" and "\0" or "")
    return b64encode(M.FORMATS[name] .. string.pack("<I2", BIT_DEPTHS[name][bit_depth]) .. rest)
  elseif name == "mp3" then
    if raw and #raw >= 28 then
      return b64encode(raw:sub(1, 4) .. string.pack("<i4", kbps) .. raw:sub(9, 24) .. string.pack("<i4", kbps) .. raw:sub(29))
    end
    return b64encode("l3pm" .. string.pack("<i4i4i4i4i4i4i4", kbps, 0, 5, -1, 4, kbps, 0))
  end
end

local function name_of(map, value)
  for name, v in pairs(map) do
    if v == value then return name end
  end
  return tostring(value)
end

local function source_name(settings)
  local s = math.floor(settings) & SOURCE_MASK
  if s & 8 ~= 0 then return "region_matrix" end
  if s & 128 ~= 0 then return "selected_via_master" end
  if s & 64 ~= 0 then return "selected_items_via_master" end
  if s & 32 ~= 0 then return "selected_items" end
  if s & 2 ~= 0 then return "stems" end
  if s & 1 ~= 0 then return "master_and_stems" end
  return "master"
end

local function to_db(lin)
  if type(lin) ~= "number" or lin <= 0 then return nil end
  return math.floor(20 * math.log(lin, 10) * 100 + 0.5) / 100
end

local function render_targets(api)
  local _, s = api.GetSetProjectInfo_String(0, "RENDER_TARGETS", "", false)
  local out = {}
  for t in (s or ""):gmatch("[^;]+") do out[#out + 1] = t end
  return out
end

local function metadata_keys(api)
  local _, list = api.GetSetProjectInfo_String(0, "RENDER_METADATA", "", false)
  local keys = {}
  for k in (list or ""):gmatch("[^;]+") do
    if #keys >= MAX_METADATA_KEYS then break end
    keys[#keys + 1] = k
  end
  return keys
end

local function read_metadata(api)
  local out = {}
  for _, k in ipairs(metadata_keys(api)) do
    local _, v = api.GetSetProjectInfo_String(0, "RENDER_METADATA", k, false)
    out[k] = v or ""
  end
  return out
end

-- Region render matrix rows: regions that render at least one track
local function region_matrix(api)
  local rows = {}
  if not api.EnumRegionRenderMatrix then return rows end
  local _, nm, nr = api.CountProjectMarkers(0)
  local master = api.GetMasterTrack(0)
  for i = 0, nm + nr - 1 do
    local _, rgn, _, _, name, idx = api.EnumProjectMarkers3(0, i)
    if rgn then
      local tracks = {}
      local j = 0
      while true do
        local tr = api.EnumRegionRenderMatrix(0, idx, j)
        if not tr then break end
        if tr == master then tracks[#tracks + 1] = "master"
        else local _, n = api.GetTrackName(tr); tracks[#tracks + 1] = n or "" end
        j = j + 1
      end
      if #tracks > 0 then rows[#rows + 1] = { regionIndex = idx, name = name, tracks = tracks } end
    end
  end
  return rows
end

--- get_render_settings
function M.get_render(api)
  local _, dir = api.GetSetProjectInfo_String(0, "RENDER_FILE", "", false)
  local _, pattern = api.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", false)
  local _, fmt = api.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)
  local _, fmt2 = api.GetSetProjectInfo_String(0, "RENDER_FORMAT2", "", false)
  local name, raw = format_of(fmt)
  local settings = api.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, false)
  local norm = math.floor(api.GetSetProjectInfo(0, "RENDER_NORMALIZE", 0, false))
  local dither = math.floor(api.GetSetProjectInfo(0, "RENDER_DITHER", 0, false))
  local out = {
    outputDirectory = dir or "",
    filePattern = pattern or "",
    format = name,
    secondaryFormat = format_name(fmt2) or "none",
    source = source_name(settings),
    bounds = name_of(M.BOUNDS, math.floor(api.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, false))),
    startTime = api.GetSetProjectInfo(0, "RENDER_STARTPOS", 0, false),
    endTime = api.GetSetProjectInfo(0, "RENDER_ENDPOS", 0, false),
    sampleRate = math.floor(api.GetSetProjectInfo(0, "RENDER_SRATE", 0, false)),
    channels = math.floor(api.GetSetProjectInfo(0, "RENDER_CHANNELS", 0, false)),
    dither = dither & 1 ~= 0,
    noiseShaping = dither & 2 ~= 0,
    normalize = norm & NORM_ON ~= 0 and name_of(M.NORMALIZE, norm & NORM_MODE) or "off",
    normalizeTarget = to_db(api.GetSetProjectInfo(0, "RENDER_NORMALIZE_TARGET", 0, false)),
    normalizeOnlyTooLoud = norm & NORM_TOO_LOUD ~= 0,
    limit = norm & NORM_LIMIT ~= 0,
    limitCeiling = to_db(api.GetSetProjectInfo(0, "RENDER_BRICKWALL", 0, false)),
    limitTruePeak = norm & NORM_LIMIT_TP ~= 0,
    embedMetadata = math.floor(settings) & EMBED_METADATA ~= 0,
    metadata = read_metadata(api),
    targets = render_targets(api),
  }
  for k, v in pairs(format_options(name, raw)) do out[k] = v end
  if out.source == "region_matrix" then out.regionMatrix = region_matrix(api) end
  return out
end

local function bool_or_nil(p, keys)
  for _, k in ipairs(keys) do
    if p[k] ~= nil and type(p[k]) ~= "boolean" then return k .. " must be true or false — nothing changed" end
  end
end

local function number_in(p, k, lo, hi, unit)
  if p[k] ~= nil and not (type(p[k]) == "number" and p[k] >= lo and p[k] <= hi) then
    return k .. " must be " .. lo .. " to " .. hi .. (unit or "") .. " — nothing changed"
  end
end

-- Region index → its region number check, plus the tracks it should render (resolved)
local function resolve_matrix(api, rows, resolve)
  if type(rows) ~= "table" then return nil, "regionMatrix must be a list of { regionIndex, tracks } — nothing changed" end
  local out = {}
  for i, row in ipairs(rows) do
    if type(row) ~= "table" or not is_int(row.regionIndex) then
      return nil, "regionMatrix[" .. i .. "].regionIndex required — nothing changed"
    end
    if not find_marker(api, true, row.regionIndex) then
      return nil, "regionMatrix: no region " .. row.regionIndex .. " — nothing changed"
    end
    if type(row.tracks) ~= "table" then return nil, "regionMatrix[" .. i .. "].tracks must be a list — nothing changed" end
    local tracks = {}
    for _, ref in ipairs(row.tracks) do
      local res, err = resolve(api, ref, {})
      if not res then return nil, "regionMatrix: " .. err .. " — nothing changed" end
      tracks[#tracks + 1] = res.track
    end
    out[#out + 1] = { region = row.regionIndex, tracks = tracks }
  end
  return out
end

--- set_render_settings: any subset of the fields get_render returns (minus
--- targets). sampleRate 0 = the project rate. `resolve` resolves track refs
--- (regionMatrix); a refused request changes nothing.
function M.set_render(api, p, resolve)
  local cur = M.get_render(api)
  local _, stored = api.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)
  local _, cur_raw = format_of(stored)
  local fourcc
  if p.format ~= nil then
    fourcc = M.FORMATS[tostring(p.format):lower()]
    if not fourcc then
      local names = {}
      for k in pairs(M.FORMATS) do names[#names + 1] = k end
      table.sort(names)
      return nil, "unsupported render format '" .. tostring(p.format) .. "' (use " .. table.concat(names, ", ") .. ") — nothing changed"
    end
  end
  local fourcc2
  if p.secondaryFormat ~= nil then
    local f2 = tostring(p.secondaryFormat):lower()
    fourcc2 = (f2 == "none") and "" or M.FORMATS[f2]
    if not fourcc2 then
      return nil, "unsupported secondary render format '" .. tostring(p.secondaryFormat) .. "' (use none or a format) — nothing changed"
    end
  end
  if p.bounds ~= nil and M.BOUNDS[p.bounds] == nil then
    return nil, "unknown bounds '" .. tostring(p.bounds) .. "' (use custom, project, time_selection, all_regions, selected_items or selected_regions) — nothing changed"
  end
  if p.source ~= nil and M.SOURCES[p.source] == nil then
    return nil, "unknown source '" .. tostring(p.source) .. "' (use master, stems, master_and_stems, selected_via_master, region_matrix, selected_items or selected_items_via_master) — nothing changed"
  end
  local source = p.source or cur.source
  local bounds = p.bounds or cur.bounds
  if (p.source ~= nil or p.bounds ~= nil) and source == "region_matrix" and bounds ~= "all_regions" and bounds ~= "selected_regions" then
    return nil, "source region_matrix renders regions: set bounds to all_regions or selected_regions — nothing changed"
  end
  if p.regionMatrix ~= nil and source ~= "region_matrix" then
    return nil, "regionMatrix applies to source region_matrix — nothing changed"
  end
  if p.sampleRate ~= nil and not (is_int(p.sampleRate) and (p.sampleRate == 0 or (p.sampleRate >= 8000 and p.sampleRate <= 768000))) then
    return nil, "sampleRate must be 0 (project rate) or 8000-768000 — nothing changed"
  end
  if p.channels ~= nil and not (is_int(p.channels) and p.channels >= 1 and p.channels <= 64) then
    return nil, "channels must be 1-64 — nothing changed"
  end
  for _, k in ipairs({ "startTime", "endTime" }) do
    if p[k] ~= nil and (type(p[k]) ~= "number" or p[k] < 0) then return nil, k .. " must be >= 0 — nothing changed" end
  end
  local s = p.startTime or cur.startTime
  local e = p.endTime or cur.endTime
  if (p.startTime ~= nil or p.endTime ~= nil) and e <= s then
    return nil, "endTime must be after startTime — nothing changed"
  end
  for _, k in ipairs({ "outputDirectory", "filePattern" }) do
    if p[k] ~= nil and type(p[k]) ~= "string" then return nil, k .. " must be a string — nothing changed" end
  end
  if p.filePattern == "" then return nil, "filePattern must not be empty — nothing changed" end

  -- Format options apply to the primary format: the new one, else the current one
  local fmt = p.format and tostring(p.format):lower() or cur.format
  local blob
  if p.bitDepth ~= nil then
    local depths = BIT_DEPTHS[fmt]
    if not depths then return nil, "bitDepth applies to wav, aiff and flac (format is " .. tostring(fmt) .. "; mp3 takes mp3Bitrate) — nothing changed" end
    if not depths[tostring(p.bitDepth)] then
      local names = {}
      for k in pairs(depths) do names[#names + 1] = k end
      table.sort(names)
      return nil, fmt .. " bitDepth must be one of " .. table.concat(names, ", ") .. " — nothing changed"
    end
  end
  if p.mp3Bitrate ~= nil then
    if fmt ~= "mp3" then return nil, "mp3Bitrate applies to format mp3 (format is " .. tostring(fmt) .. ") — nothing changed" end
    local ok = false
    for _, kb in ipairs(MP3_BITRATES) do if kb == p.mp3Bitrate then ok = true end end
    if not ok then return nil, "mp3Bitrate must be one of " .. table.concat(MP3_BITRATES, ", ") .. " kbps — nothing changed" end
  end
  if p.bitDepth ~= nil or p.mp3Bitrate ~= nil then
    blob = build_format(fmt, cur.format == fmt and cur_raw ~= M.FORMATS[fmt] and cur_raw or nil, tostring(p.bitDepth), p.mp3Bitrate)
  end
  local err = bool_or_nil(p, { "dither", "noiseShaping", "normalizeOnlyTooLoud", "limit", "limitTruePeak", "embedMetadata" })
    or number_in(p, "normalizeTarget", -70, 0, " dB")
    or number_in(p, "limitCeiling", -30, 0, " dB")
  if err then return nil, err end
  if p.normalize ~= nil and p.normalize ~= "off" and M.NORMALIZE[p.normalize] == nil then
    return nil, "unknown normalize '" .. tostring(p.normalize) .. "' (use off, lufs_i, rms, peak, true_peak, lufs_m_max or lufs_s_max) — nothing changed"
  end
  if p.normalize ~= nil and p.normalize ~= "off" and p.normalizeTarget == nil and cur.normalizeTarget == nil then
    return nil, "normalize needs normalizeTarget (dB) — nothing changed"
  end
  if p.limit == true and p.limitCeiling == nil and cur.limitCeiling == nil then
    return nil, "limit needs limitCeiling (dB) — nothing changed"
  end
  local meta = {}
  if p.metadata ~= nil then
    if type(p.metadata) ~= "table" then return nil, "metadata must be an object — nothing changed" end
    for field, v in pairs(p.metadata) do
      local keys = M.METADATA[field]
      if not keys then
        local names = {}
        for k in pairs(M.METADATA) do names[#names + 1] = k end
        table.sort(names)
        return nil, "unknown metadata field '" .. tostring(field) .. "' (use " .. table.concat(names, ", ") .. ", or metadataRaw for exact keys) — nothing changed"
      end
      if type(v) ~= "string" then return nil, "metadata." .. field .. " must be a string — nothing changed" end
      for _, k in ipairs(keys) do meta[#meta + 1] = { k, v } end
    end
  end
  if p.metadataRaw ~= nil then
    if type(p.metadataRaw) ~= "table" then return nil, "metadataRaw must be an object of KEY → value — nothing changed" end
    for k, v in pairs(p.metadataRaw) do
      if type(k) ~= "string" or not k:match("^%u[%u%d]*:[^|;]+$") then
        return nil, "metadataRaw key '" .. tostring(k) .. "' must look like SCHEME:FIELD (e.g. ID3:TCOM) — nothing changed"
      end
      if type(v) ~= "string" then return nil, "metadataRaw['" .. k .. "'] must be a string — nothing changed" end
      meta[#meta + 1] = { k, v }
    end
  end
  for _, kv in ipairs(meta) do
    if kv[2]:find("[\r\n]") then return nil, "metadata values must be one line (" .. kv[1] .. ") — nothing changed" end
  end
  local matrix
  if p.regionMatrix ~= nil then
    if not resolve then return nil, "regionMatrix needs a track resolver — nothing changed" end
    local m, merr = resolve_matrix(api, p.regionMatrix, resolve)
    if not m then return nil, merr end
    matrix = m
  end

  edit(api, "Set render settings", function()
    if p.outputDirectory ~= nil then api.GetSetProjectInfo_String(0, "RENDER_FILE", p.outputDirectory, true) end
    if p.filePattern ~= nil then api.GetSetProjectInfo_String(0, "RENDER_PATTERN", p.filePattern, true) end
    if blob then api.GetSetProjectInfo_String(0, "RENDER_FORMAT", blob, true)
    elseif fourcc and fourcc ~= M.FORMATS[cur.format] then
      -- The bare fourcc means the format's defaults: write it only on a real change, or a restated
      -- format would drop the bit depth or bitrate already set
      api.GetSetProjectInfo_String(0, "RENDER_FORMAT", fourcc, true)
    end
    if fourcc2 then api.GetSetProjectInfo_String(0, "RENDER_FORMAT2", fourcc2, true) end
    if p.bounds ~= nil then api.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", M.BOUNDS[p.bounds], true) end
    if p.startTime ~= nil then api.GetSetProjectInfo(0, "RENDER_STARTPOS", p.startTime, true) end
    if p.endTime ~= nil then api.GetSetProjectInfo(0, "RENDER_ENDPOS", p.endTime, true) end
    if p.sampleRate ~= nil then api.GetSetProjectInfo(0, "RENDER_SRATE", p.sampleRate, true) end
    if p.channels ~= nil then api.GetSetProjectInfo(0, "RENDER_CHANNELS", p.channels, true) end
    local settings = math.floor(api.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, false))
    local new = settings
    if p.source ~= nil then new = (new & ~SOURCE_MASK) | M.SOURCES[p.source] end
    local embed = p.embedMetadata
    if embed == nil and #meta > 0 then embed = true end
    if embed ~= nil then new = embed and (new | EMBED_METADATA) or (new & ~EMBED_METADATA) end
    if new ~= settings then api.GetSetProjectInfo(0, "RENDER_SETTINGS", new, true) end
    if p.dither ~= nil or p.noiseShaping ~= nil then
      local d = math.floor(api.GetSetProjectInfo(0, "RENDER_DITHER", 0, false))
      if p.dither ~= nil then d = p.dither and (d | 1 | 4) or (d & ~(1 | 4)) end
      if p.noiseShaping ~= nil then d = p.noiseShaping and (d | 2 | 8) or (d & ~(2 | 8)) end
      api.GetSetProjectInfo(0, "RENDER_DITHER", d, true)
    end
    if p.normalize ~= nil or p.normalizeOnlyTooLoud ~= nil or p.limit ~= nil or p.limitTruePeak ~= nil then
      local n = math.floor(api.GetSetProjectInfo(0, "RENDER_NORMALIZE", 0, false))
      if p.normalize == "off" then n = n & ~NORM_ON
      elseif p.normalize ~= nil then n = (n & ~NORM_MODE) | NORM_ON | M.NORMALIZE[p.normalize] end
      if p.normalizeOnlyTooLoud ~= nil then n = p.normalizeOnlyTooLoud and (n | NORM_TOO_LOUD) or (n & ~NORM_TOO_LOUD) end
      if p.limit ~= nil then n = p.limit and (n | NORM_LIMIT) or (n & ~NORM_LIMIT) end
      if p.limitTruePeak ~= nil then n = p.limitTruePeak and (n | NORM_LIMIT_TP) or (n & ~NORM_LIMIT_TP) end
      api.GetSetProjectInfo(0, "RENDER_NORMALIZE", n, true)
    end
    if p.normalizeTarget ~= nil then api.GetSetProjectInfo(0, "RENDER_NORMALIZE_TARGET", 10 ^ (p.normalizeTarget / 20), true) end
    if p.limitCeiling ~= nil then api.GetSetProjectInfo(0, "RENDER_BRICKWALL", 10 ^ (p.limitCeiling / 20), true) end
    for _, kv in ipairs(meta) do api.GetSetProjectInfo_String(0, "RENDER_METADATA", kv[1] .. "|" .. kv[2], true) end
    for _, row in ipairs(matrix or {}) do
      -- Replace the region's row: drop what it rendered, then add the listed tracks
      local old = {}
      local j = 0
      while true do
        local tr = api.EnumRegionRenderMatrix(0, row.region, j)
        if not tr then break end
        old[#old + 1] = tr
        j = j + 1
      end
      for _, tr in ipairs(old) do api.SetRegionRenderMatrix(0, row.region, tr, -1) end
      for _, tr in ipairs(row.tracks) do api.SetRegionRenderMatrix(0, row.region, tr, 1) end
    end
  end)
  return M.get_render(api)
end

-- Loudness of a rendered file through REAPER's own normalization scan (any format REAPER reads)
local function measure_file(api, path)
  if not (api.PCM_Source_CreateFromFile and api.CalculateNormalization) then return { file = path } end
  local src = api.PCM_Source_CreateFromFile(path)
  if not src then return { file = path } end
  local out = { file = path, durationSeconds = math.floor(api.GetMediaSourceLength(src) * 1000 + 0.5) / 1000 }
  local function level(mode)
    local g = api.CalculateNormalization(src, mode, 0, 0, 0)
    if type(g) ~= "number" or g <= 0 or g ~= g or g == math.huge then return nil end
    return math.floor(-20 * math.log(g, 10) * 100 + 0.5) / 100
  end
  out.lufsIntegrated = level(0)
  out.truePeak = level(3)
  out.samplePeak = level(2)
  api.PCM_Source_Destroy(src)
  return out
end

local function is_absolute(path) return path:sub(1, 1) == "/" or path:match("^%a:[/\\]") ~= nil end

-- Everything render_core refuses before REAPER renders, as a reason (nil = fine)
local function render_refusal(api, settings, targets, fs, overwrite, hint)
  if #targets == 0 then
    if settings.source == "stems" or settings.source == "selected_via_master" or settings.source == "master_and_stems" then
      return "refused: source " .. settings.source .. " renders the selected tracks and none is selected — " .. (hint or "select tracks or pass tracks")
    end
    if settings.source == "selected_items" or settings.source == "selected_items_via_master" then
      return "refused: source " .. settings.source .. " renders the selected items and none is selected — select items with set_selected_items"
    end
    if settings.source == "region_matrix" then
      return "refused: the region render matrix lists no track for the rendered regions — set regionMatrix with set_render_settings"
    end
    return "refused: the render settings name no output file — set outputDirectory and filePattern with set_render_settings"
  end
  for _, t in ipairs(targets) do
    if not is_absolute(t) then
      return "refused: render target '" .. t .. "' is not an absolute path (unsaved project?) — set outputDirectory to an absolute directory"
    end
  end
  -- Seen live: a render whose secondary format was a sink outside this list
  -- (a project template's video sink) left a modal dialog open.
  for _, f in ipairs({ settings.format or "unset", settings.secondaryFormat }) do
    if f == "unset" or f:sub(1, 6) == "other:" then
      return "refused: render format '" .. f .. "' is not one of wav, aiff, flac, mp3, ogg, opus (other encoders can open a dialog) — set format / secondaryFormat with set_render_settings"
    end
  end
  if settings.bounds == "time_selection" then
    local s, e = api.GetSet_LoopTimeRange(false, false, 0, 0, false)
    if e <= s then return "refused: bounds is time_selection but there is no time selection" end
  elseif settings.bounds == "custom" and settings.endTime <= settings.startTime then
    return "refused: custom bounds have endTime <= startTime"
  end
  if overwrite ~= true then
    local existing = {}
    for _, t in ipairs(targets) do
      if fs.exists(t) then existing[#existing + 1] = t end
    end
    if #existing > 0 then
      return "refused: " .. table.concat(existing, ", ") .. " already exists (REAPER would ask whether to overwrite) — pass overwrite: true to replace"
    end
  end
end

-- Render with the current settings once the checks passed: delete existing targets
-- (overwrite), render, then measure what was written
local function render_core(api, settings, targets, fs, p)
  local existing, deleted = {}, {}
  for _, t in ipairs(targets) do
    if fs.exists(t) then existing[#existing + 1] = t end
  end
  for _, t in ipairs(existing) do
    fs.remove(t)
    -- A file that survives (open elsewhere, read-only) would make REAPER prompt.
    if fs.exists(t) then
      return nil, "refused: could not delete " .. t .. " to overwrite it (open in another program or read-only?)"
        .. (#deleted > 0 and ("; already deleted: " .. table.concat(deleted, ", ")) or "")
    end
    deleted[#deleted + 1] = t
  end
  for _, t in ipairs(targets) do
    local dir = parent_dir(t)
    if dir and api.RecursiveCreateDirectory then api.RecursiveCreateDirectory(dir, 0) end
  end

  -- 42230: File: Render project, using the most recent render settings, auto-close render dialog.
  api.Main_OnCommand(42230, 0)

  local files, missing = {}, {}
  for _, t in ipairs(targets) do
    if fs.exists(t) then files[#files + 1] = t else missing[#missing + 1] = t end
  end
  if #files == 0 then return nil, "render produced no file (expected " .. table.concat(targets, ", ") .. ")" end
  local out = { rendered = true, files = files, missing = missing, bounds = settings.bounds, format = settings.format, source = settings.source }
  out.bitDepth, out.mp3Bitrate = settings.bitDepth, settings.mp3Bitrate
  if settings.normalize ~= "off" then out.normalize, out.normalizeTarget = settings.normalize, settings.normalizeTarget end
  if settings.limit then out.limitCeiling, out.limitTruePeak = settings.limitCeiling, settings.limitTruePeak end
  if p.analyze ~= false then
    out.analysis = {}
    for i = 1, math.min(#files, MAX_ANALYZED) do out.analysis[i] = measure_file(api, files[i]) end
    if #files > MAX_ANALYZED then out.analysisSkipped = #files - MAX_ANALYZED end
  end
  return out
end

-- Selection of every track (the master included), to put back after a render that selected `tracks`
local function save_selection(api)
  local sel = { master = api.IsTrackSelected(api.GetMasterTrack(0)) }
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    sel[#sel + 1] = { tr, api.IsTrackSelected(tr) }
  end
  return sel
end

local function restore_selection(api, sel)
  for _, s in ipairs(sel) do api.SetTrackSelected(s[1], s[2]) end
  api.SetTrackSelected(api.GetMasterTrack(0), sel.master == true)
end

local function resolve_all(api, refs, resolve, what)
  if type(refs) ~= "table" then return nil, what .. " must be a list of track references" end
  local out = {}
  for _, ref in ipairs(refs) do
    local res, err = resolve(api, ref, {})
    if not res or not res.track then return nil, what .. ": " .. tostring(err or ("track " .. tostring(ref) .. " not found")) end
    out[#out + 1] = res.track
  end
  return out
end

local SELECTION_SOURCES = { stems = true, master_and_stems = true, selected_via_master = true }

--- render_project: render with the project's current render settings
--- (synchronous; blocks REAPER until done). Refuses when a target file
--- already exists (REAPER would ask whether to overwrite) unless overwrite,
--- which deletes those files first. `tracks` selects the tracks a stems
--- render uses, for this render only. Each file written is measured
--- (duration, LUFS-I, true peak, sample peak) unless analyze is false.
function M.render(api, p, fs, resolve)
  local settings = M.get_render(api)
  if p.tracks ~= nil then
    if not SELECTION_SOURCES[settings.source] then
      return nil, "refused: tracks applies to source stems, master_and_stems or selected_via_master (source is " .. settings.source .. ")"
    end
    if not resolve then return nil, "refused: tracks needs a track resolver" end
    local tracks, err = resolve_all(api, p.tracks, resolve, "tracks")
    if not tracks then return nil, "refused: " .. err end
    if #tracks == 0 then return nil, "refused: tracks is empty" end
    local sel = save_selection(api)
    for _, s in ipairs(sel) do api.SetTrackSelected(s[1], false) end
    api.SetTrackSelected(api.GetMasterTrack(0), false)
    for _, tr in ipairs(tracks) do api.SetTrackSelected(tr, true) end
    local ok, out, rerr = pcall(function()
      local targets = render_targets(api)
      local refusal = render_refusal(api, settings, targets, fs, p.overwrite)
      if refusal then return nil, refusal end
      return render_core(api, settings, targets, fs, p)
    end)
    restore_selection(api, sel)
    if not ok then error(out, 0) end
    return out, rerr
  end
  local targets = settings.targets
  local refusal = render_refusal(api, settings, targets, fs, p.overwrite)
  if refusal then return nil, refusal end
  return render_core(api, settings, targets, fs, p)
end

local MAX_VERSIONS = 16

-- The bridge decodes a command's top level only (no JSON parser in REAPER), so
-- nested params arrive as JSON strings; decode the ones the render tools take.
local JSON_FIELDS = { "metadata", "metadataRaw", "regionMatrix", "tracks", "versions" }
function M.decode_json_fields(p, json_decode)
  for _, k in ipairs(JSON_FIELDS) do
    if type(p[k]) == "string" then
      local ok, v, err = pcall(json_decode, p[k])
      if not ok or type(v) ~= "table" then
        return nil, k .. " is not valid JSON" .. ((err or (not ok and v)) and (" (" .. tostring(err or (type(v) == "table" and v.json) or v) .. ")") or "") .. " — nothing changed"
      end
      p[k] = v
    end
  end
  return p
end

--- render_versions: one render per version, each with its own tracks muted
--- (an instrumental mutes the vocals, a TV mix the lead vocal, …) and the
--- file pattern suffixed with the version name. Every reference, name and
--- target is checked before the first render; mutes and the file pattern are
--- put back afterwards, also when a render fails.
function M.render_versions(api, p, fs, resolve)
  local versions = p.versions
  if type(versions) ~= "table" or #versions == 0 then return nil, "versions must be a non-empty list of { name, mute }" end
  if #versions > MAX_VERSIONS then return nil, "at most " .. MAX_VERSIONS .. " versions per call" end
  local settings = M.get_render(api)
  local plan, seen = {}, {}
  for i, v in ipairs(versions) do
    if type(v) ~= "table" or type(v.name) ~= "string" or not v.name:match("^[%w][%w _%-%.]*$") then
      return nil, "versions[" .. i .. "].name must be letters, digits, space, - _ or . (it names the files) — nothing rendered"
    end
    if seen[v.name:lower()] then return nil, "version name '" .. v.name .. "' is used twice — nothing rendered" end
    seen[v.name:lower()] = true
    if v.filePattern ~= nil and (type(v.filePattern) ~= "string" or v.filePattern == "") then
      return nil, "versions[" .. i .. "].filePattern must be a non-empty string — nothing rendered"
    end
    local muted, err = resolve_all(api, v.mute or {}, resolve, "versions[" .. i .. "].mute")
    if not muted then return nil, err .. " — nothing rendered" end
    plan[i] = { name = v.name, pattern = v.filePattern or (settings.filePattern .. "-" .. v.name), muted = muted }
  end

  local base_pattern = settings.filePattern
  local mutes = {}
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    mutes[#mutes + 1] = { tr, api.GetMediaTrackInfo_Value(tr, "B_MUTE") }
  end
  local master = api.GetMasterTrack(0)
  local master_mute = api.GetMediaTrackInfo_Value(master, "B_MUTE")
  local function restore()
    for _, m in ipairs(mutes) do
      if api.GetMediaTrackInfo_Value(m[1], "B_MUTE") ~= m[2] then api.SetMediaTrackInfo_Value(m[1], "B_MUTE", m[2]) end
    end
    if api.GetMediaTrackInfo_Value(master, "B_MUTE") ~= master_mute then api.SetMediaTrackInfo_Value(master, "B_MUTE", master_mute) end
    api.GetSetProjectInfo_String(0, "RENDER_PATTERN", base_pattern, true)
  end

  local results = {}
  local ok, err = pcall(function()
    -- Targets per version (the pattern decides them), all checked before the first render
    local seen_target = {}
    for _, v in ipairs(plan) do
      api.GetSetProjectInfo_String(0, "RENDER_PATTERN", v.pattern, true)
      v.targets = render_targets(api)
      local refusal = render_refusal(api, settings, v.targets, fs, p.overwrite, "select the tracks to render first")
      if refusal then error({ refusal = "version " .. v.name .. ": " .. refusal .. " — nothing rendered" }) end
      for _, t in ipairs(v.targets) do
        -- Lowercased: paths differing only in case are one file on APFS and NTFS
        local key = t:lower()
        if seen_target[key] then error({ refusal = "versions " .. seen_target[key] .. " and " .. v.name .. " would both write " .. t .. " — give them distinct filePattern — nothing rendered" }) end
        seen_target[key] = v.name
      end
    end
    for _, v in ipairs(plan) do
      local mute_set = {}
      for _, tr in ipairs(v.muted) do mute_set[tr] = true end
      for _, m in ipairs(mutes) do
        local want = mute_set[m[1]] and 1 or m[2]
        if api.GetMediaTrackInfo_Value(m[1], "B_MUTE") ~= want then api.SetMediaTrackInfo_Value(m[1], "B_MUTE", want) end
      end
      local want_master = mute_set[master] and 1 or master_mute
      if api.GetMediaTrackInfo_Value(master, "B_MUTE") ~= want_master then api.SetMediaTrackInfo_Value(master, "B_MUTE", want_master) end
      api.GetSetProjectInfo_String(0, "RENDER_PATTERN", v.pattern, true)
      local out, rerr = render_core(api, settings, v.targets, fs, p)
      if not out then
        local done = {}
        for _, r in ipairs(results) do done[#done + 1] = r.name end
        error({ refusal = "version " .. v.name .. ": " .. rerr .. (#done > 0 and ("; rendered before it: " .. table.concat(done, ", ")) or "") })
      end
      local mutedNames = {}
      for _, tr in ipairs(v.muted) do
        if tr == master then mutedNames[#mutedNames + 1] = "master"
        else local _, n = api.GetTrackName(tr); mutedNames[#mutedNames + 1] = n or "" end
      end
      results[#results + 1] = { name = v.name, muted = mutedNames, files = out.files, missing = out.missing, analysis = out.analysis }
    end
  end)
  restore()
  if not ok then
    if type(err) == "table" and err.refusal then return nil, err.refusal end
    error(err, 0)
  end
  local out = { rendered = true, versions = results, format = settings.format, source = settings.source }
  out.bitDepth, out.mp3Bitrate = settings.bitDepth, settings.mp3Bitrate
  if settings.normalize ~= "off" then out.normalize, out.normalizeTarget = settings.normalize, settings.normalizeTarget end
  if settings.limit then out.limitCeiling, out.limitTruePeak = settings.limitCeiling, settings.limitTruePeak end
  return out
end

return M
