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
-- Render settings + render
-- ---------------------------------------------------------------------------

-- Sink fourccs as REAPER stores them (byte-reversed).
M.FORMATS = { wav = "evaw", aiff = "ffia", flac = "calf", mp3 = "l3pm", ogg = "vggo", opus = "SggO" }
M.BOUNDS = { custom = 0, project = 1, time_selection = 2, all_regions = 3, selected_items = 4, selected_regions = 5 }

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

local function format_name(stored)
  if not stored or stored == "" then return nil end
  for name, cc in pairs(M.FORMATS) do
    if stored == cc then return name end
  end
  local cc = b64decode(stored):sub(1, 4)
  for name, want in pairs(M.FORMATS) do
    if cc == want then return name end
  end
  return "other:" .. cc
end

local function bounds_name(flag)
  for name, v in pairs(M.BOUNDS) do
    if v == flag then return name end
  end
  return tostring(flag)
end

local function render_targets(api)
  local _, s = api.GetSetProjectInfo_String(0, "RENDER_TARGETS", "", false)
  local out = {}
  for t in (s or ""):gmatch("[^;]+") do out[#out + 1] = t end
  return out
end

--- get_render_settings
function M.get_render(api)
  local _, dir = api.GetSetProjectInfo_String(0, "RENDER_FILE", "", false)
  local _, pattern = api.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", false)
  local _, fmt = api.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)
  local _, fmt2 = api.GetSetProjectInfo_String(0, "RENDER_FORMAT2", "", false)
  return {
    outputDirectory = dir or "",
    filePattern = pattern or "",
    format = format_name(fmt),
    secondaryFormat = format_name(fmt2) or "none",
    bounds = bounds_name(math.floor(api.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, false))),
    startTime = api.GetSetProjectInfo(0, "RENDER_STARTPOS", 0, false),
    endTime = api.GetSetProjectInfo(0, "RENDER_ENDPOS", 0, false),
    sampleRate = math.floor(api.GetSetProjectInfo(0, "RENDER_SRATE", 0, false)),
    channels = math.floor(api.GetSetProjectInfo(0, "RENDER_CHANNELS", 0, false)),
    targets = render_targets(api),
  }
end

local function is_int(v) return type(v) == "number" and v == math.floor(v) end

--- set_render_settings: any subset of the fields get_render returns (minus
--- targets). sampleRate 0 = the project rate.
function M.set_render(api, p)
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
  if p.sampleRate ~= nil and not (is_int(p.sampleRate) and (p.sampleRate == 0 or (p.sampleRate >= 8000 and p.sampleRate <= 768000))) then
    return nil, "sampleRate must be 0 (project rate) or 8000-768000 — nothing changed"
  end
  if p.channels ~= nil and not (is_int(p.channels) and p.channels >= 1 and p.channels <= 64) then
    return nil, "channels must be 1-64 — nothing changed"
  end
  for _, k in ipairs({ "startTime", "endTime" }) do
    if p[k] ~= nil and (type(p[k]) ~= "number" or p[k] < 0) then return nil, k .. " must be >= 0 — nothing changed" end
  end
  local s = p.startTime or api.GetSetProjectInfo(0, "RENDER_STARTPOS", 0, false)
  local e = p.endTime or api.GetSetProjectInfo(0, "RENDER_ENDPOS", 0, false)
  if (p.startTime ~= nil or p.endTime ~= nil) and e <= s then
    return nil, "endTime must be after startTime — nothing changed"
  end
  for _, k in ipairs({ "outputDirectory", "filePattern" }) do
    if p[k] ~= nil and type(p[k]) ~= "string" then return nil, k .. " must be a string — nothing changed" end
  end
  if p.filePattern == "" then return nil, "filePattern must not be empty — nothing changed" end

  edit(api, "Set render settings", function()
    if p.outputDirectory ~= nil then api.GetSetProjectInfo_String(0, "RENDER_FILE", p.outputDirectory, true) end
    if p.filePattern ~= nil then api.GetSetProjectInfo_String(0, "RENDER_PATTERN", p.filePattern, true) end
    if fourcc then api.GetSetProjectInfo_String(0, "RENDER_FORMAT", fourcc, true) end
    if fourcc2 then api.GetSetProjectInfo_String(0, "RENDER_FORMAT2", fourcc2, true) end
    if p.bounds ~= nil then api.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", M.BOUNDS[p.bounds], true) end
    if p.startTime ~= nil then api.GetSetProjectInfo(0, "RENDER_STARTPOS", p.startTime, true) end
    if p.endTime ~= nil then api.GetSetProjectInfo(0, "RENDER_ENDPOS", p.endTime, true) end
    if p.sampleRate ~= nil then api.GetSetProjectInfo(0, "RENDER_SRATE", p.sampleRate, true) end
    if p.channels ~= nil then api.GetSetProjectInfo(0, "RENDER_CHANNELS", p.channels, true) end
  end)
  return M.get_render(api)
end

--- render_project: render with the project's current render settings
--- (synchronous; blocks REAPER until done). Refuses when a target file
--- already exists (REAPER would ask whether to overwrite) unless overwrite,
--- which deletes those files first.
function M.render(api, p, fs)
  local settings = M.get_render(api)
  local targets = settings.targets
  if #targets == 0 then
    return nil, "refused: the render settings name no output file — set outputDirectory and filePattern with set_render_settings"
  end
  for _, t in ipairs(targets) do
    if not (t:sub(1, 1) == "/" or t:match("^%a:[/\\]")) then
      return nil, "refused: render target '" .. t .. "' is not an absolute path (unsaved project?) — set outputDirectory to an absolute directory"
    end
  end
  -- Seen live: a render whose secondary format was a sink outside this list
  -- (a project template's video sink) left a modal dialog open.
  for _, f in ipairs({ settings.format or "unset", settings.secondaryFormat }) do
    if f == "unset" or f:sub(1, 6) == "other:" then
      return nil, "refused: render format '" .. f .. "' is not one of wav, aiff, flac, mp3, ogg, opus (other encoders can open a dialog) — set format / secondaryFormat with set_render_settings"
    end
  end
  if settings.bounds == "time_selection" then
    local s, e = api.GetSet_LoopTimeRange(false, false, 0, 0, false)
    if e <= s then return nil, "refused: bounds is time_selection but there is no time selection" end
  elseif settings.bounds == "custom" and settings.endTime <= settings.startTime then
    return nil, "refused: custom bounds have endTime <= startTime"
  end
  local existing = {}
  for _, t in ipairs(targets) do
    if fs.exists(t) then existing[#existing + 1] = t end
  end
  if #existing > 0 and p.overwrite ~= true then
    return nil, "refused: " .. table.concat(existing, ", ") .. " already exists (REAPER would ask whether to overwrite) — pass overwrite: true to replace"
  end
  for _, t in ipairs(existing) do fs.remove(t) end
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
  return { rendered = true, files = files, missing = missing, bounds = settings.bounds, format = settings.format }
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
    local _, num, den = api.TimeMap_GetTimeSigAtTime(0, 0)
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

return M
