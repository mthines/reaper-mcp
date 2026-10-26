-- mcp_actions_lib.lua — REAPER action proxy and selection setters.
--
-- Pure logic: every function takes the ReaScript API as `api`, so it runs
-- under a fake API in unit tests. Loaded by mcp_bridge.lua with dofile and
-- passed to mcp_plan_lib.lua (run_plan ops) through its ctx.
--
-- Command ids of custom actions, scripts and extension actions are assigned
-- per session; the stable handle is the named id ("_aee8…", "_SWS_…"), which
-- every result carries.

local M = {}

-- Sections with a command entry point. Inline MIDI editor and media explorer
-- have none, so they are not offered.
M.SECTIONS = { main = 0, midi_editor = 32060, midi_event_list = 32061 }

-- App-level actions that would end, replace or switch away from the project
-- the agent works in. Refused even with allowDialog. Lua patterns matched
-- against the lowercased name; REAPER lists some with a "File:" prefix and
-- some without ("Close current project tab", "New project tab").
local DENY_PATTERNS = {
  "^file: quit", "^quit reaper",
  "^file: close", "^close project", "^close all projects", "^close current project",
  "^file: new project", "^new project$", "^new project %(", "^new project tab",
  "^file: open project", "^open project$", "^open project%.%.%.", "^open project in new tab",
  "^project tabs: close", "^project tabs: switch to",
  -- Anywhere in the name: SWS and item actions that open or switch to another project.
  "switch to .*project tab", "send next action to .*project tab",
  "new project tab", "in new tab", "%(new tab",
  "open project,", "open project %(", "open projects from", "open last project",
  "open related project", "open associated", "open reaper project",
}

local function section_id(name)
  if name == nil or name == "" then return 0 end
  local id = M.SECTIONS[name]
  if not id then error("unknown section '" .. tostring(name) .. "' (use main, midi_editor or midi_event_list)", 0) end
  return id
end

local function handle(api, sec)
  return api.SectionFromUniqueID and api.SectionFromUniqueID(sec) or sec
end

local function enumerate(api, sec, visit)
  local h = handle(api, sec)
  local i = 0
  while true do
    local id, name = api.kbd_enumerateActions(h, i)
    if not id or id <= 0 then return end
    if visit(id, name or "") then return end
    i = i + 1
  end
end

local function named_id(api, id)
  local s = api.ReverseNamedCommandLookup(id)
  if s and s ~= "" then return s:sub(1, 1) == "_" and s or "_" .. s end
  return nil
end

local function trim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end

function M.is_dialog(name)
  name = trim(name)
  return name:sub(-3) == "..." or name:sub(-3) == "\226\128\166" -- "…"
end

function M.deny_reason(name)
  local lower = trim(name):lower()
  for _, p in ipairs(DENY_PATTERNS) do
    if lower:find(p) then
      return "'" .. trim(name) .. "' would close or replace the project the agent is working in"
    end
  end
  return nil
end

local function unsaved_project(api)
  if not api.EnumProjects then return false end
  local _, path = api.EnumProjects(-1, "")
  return path == nil or path == ""
end

--- Whether running `name` opens a modal dialog: a "..." name, or any Save
--- (project, all projects, new version) on a project that was never saved,
--- where REAPER asks where to save it.
function M.opens_dialog(api, name)
  if M.is_dialog(name) then return true end
  return trim(name):lower():sub(1, 10) == "file: save" and unsaved_project(api)
end

local function step_id(api, s)
  local n = tonumber(s)
  if n then return n end
  local id = api.NamedCommandLookup(s:sub(1, 1) == "_" and s or "_" .. s)
  return id and id > 0 and id or nil
end

--- Check an action and, for a Custom: macro, every step it runs (nested
--- macros too), since running the macro runs them all. Returns the deny
--- reason, or nil, and a label of what opens a dialog, or nil.
local function inspect(api, id, name, sec, macros, seen)
  local denied = M.deny_reason(name)
  if denied then return denied, nil end
  local dialog = M.opens_dialog(api, name) and ("'" .. trim(name) .. "'") or nil
  local nid = macros and named_id(api, id)
  local macro = nid and macros[nid]
  if not macro or seen[nid] then return nil, dialog end
  seen[nid] = true
  local h = handle(api, sec)
  for k, s in ipairs(macro.steps) do
    local sid = step_id(api, s)
    local sname = sid and api.kbd_getTextFromCmd(sid, h)
    if sname and sname ~= "" then
      local d, g = inspect(api, sid, sname, sec, macros, seen)
      if d then return "macro step " .. k .. ": " .. d, nil end
      dialog = dialog or (g and ("macro step " .. k .. " " .. g))
    end
  end
  return nil, dialog
end

local function shortcuts(api, sec, id)
  if not api.CountActionShortcuts then return {} end
  local h = handle(api, sec)
  local out = {}
  for k = 0, api.CountActionShortcuts(h, id) - 1 do
    local ok, desc = api.GetActionShortcutDesc(h, id, k, "")
    if ok and desc and desc ~= "" then out[#out + 1] = desc end
  end
  return out
end

local function section_name(sec)
  for name, id in pairs(M.SECTIONS) do if id == sec then return name end end
  return tostring(sec)
end

--- `macros` (from parse_kb) is optional; with it a macro is flagged by its steps.
function M.describe(api, sec, id, name, macros)
  local denied, dialog = inspect(api, id, name, sec, macros, {})
  return {
    id = id,
    namedId = named_id(api, id),
    name = name,
    section = section_name(sec),
    toggle = api.GetToggleCommandStateEx(sec, id), -- -1: not a toggle
    shortcuts = shortcuts(api, sec, id),
    opensDialog = dialog ~= nil,
    denied = denied,
  }
end

--- search_actions: every query word must appear (case-insensitive) in the
--- name or named id. Returns at most `limit` actions plus the total count.
function M.search(api, params, kb_text)
  local sec = section_id(params.section)
  local macros = M.parse_kb(kb_text)
  local limit = math.max(1, math.min(tonumber(params.limit) or 20, 100))
  local words = {}
  for w in tostring(params.query or ""):lower():gmatch("%S+") do words[#words + 1] = w end

  local found, total = {}, 0
  enumerate(api, sec, function(id, name)
    local hay = name:lower() .. " " .. (named_id(api, id) or ""):lower()
    for _, w in ipairs(words) do
      if not hay:find(w, 1, true) then return false end
    end
    total = total + 1
    if #found < limit then found[#found + 1] = M.describe(api, sec, id, name, macros) end
    return false
  end)
  return { section = section_name(sec), query = params.query or "", total = total, returned = #found, actions = found }
end

--- Resolve an action reference to (id, name). Accepts a command id (number
--- or digit string), a named id with or without the leading underscore, or
--- an exact action name (case-insensitive, must be unique).
function M.resolve(api, ref, sec)
  sec = sec or 0
  local h = handle(api, sec)
  local function by_id(id)
    local name = api.kbd_getTextFromCmd(id, h)
    if not name or name == "" then return nil, "no action with id " .. id .. " in section " .. section_name(sec) end
    return id, name
  end

  if type(ref) == "number" then return by_id(math.floor(ref)) end
  if type(ref) ~= "string" or trim(ref) == "" then return nil, "action reference missing" end
  ref = trim(ref)
  if ref:match("^%d+$") then return by_id(tonumber(ref)) end

  if not ref:find("%s") then
    local id = api.NamedCommandLookup(ref:sub(1, 1) == "_" and ref or "_" .. ref)
    if id and id > 0 then return by_id(id) end
    if ref:sub(1, 1) == "_" then return nil, "no action with named id " .. ref end
  end

  local want, hits = ref:lower(), {}
  enumerate(api, sec, function(id, name)
    if trim(name):lower() == want then hits[#hits + 1] = { id = id, name = name } end
    return false
  end)
  if #hits == 1 then return hits[1].id, hits[1].name end
  if #hits > 1 then
    local ids = {}
    for k = 1, math.min(#hits, 4) do ids[k] = tostring(hits[k].id) end
    return nil, "action name '" .. ref .. "' is ambiguous (ids " .. table.concat(ids, ", ") .. ") — use an id"
  end
  return nil, "no action named '" .. ref .. "' — use search_actions to find it"
end

--- Why an action must not run now, or nil when it may. Pass `macros` (from
--- parse_kb) so a Custom: macro is judged by the steps it runs.
function M.check_runnable(api, id, name, sec, allow_dialog, macros)
  local denied, dialog = inspect(api, id, name, sec, macros, {})
  if denied then return "refused: " .. denied end
  if dialog and not allow_dialog then
    return "refused: " .. dialog .. " opens a dialog, which blocks REAPER (and this bridge) until a person closes it — pass allowDialog only when someone is at the screen"
  end
  if sec ~= 0 and not api.MIDIEditor_GetActive() then
    return "'" .. trim(name) .. "' is a MIDI editor action, but no MIDI editor is open"
  end
  return nil
end

--- Run a resolved, checked action. No undo block of its own (callers own it).
function M.exec(api, id, sec)
  if sec == 0 then
    api.Main_OnCommandEx(id, 0, 0)
  elseif sec == M.SECTIONS.midi_editor then
    api.MIDIEditor_OnCommand(api.MIDIEditor_GetActive(), id)
  else
    api.MIDIEditor_LastFocused_OnCommand(id, true)
  end
  return api.GetToggleCommandStateEx(sec, id)
end

--- run_action: resolve, refuse unsafe actions, run once in an undo block.
function M.run(api, params, kb_text)
  local sec = section_id(params.section)
  local id, name = M.resolve(api, params.action, sec)
  if not id then return nil, name end
  local macros = M.parse_kb(kb_text)
  local refused = M.check_runnable(api, id, name, sec, params.allowDialog == true, macros)
  if refused then return nil, refused end

  api.Undo_BeginBlock()
  local ok, toggle = pcall(M.exec, api, id, sec)
  api.Undo_EndBlock("MCP: " .. trim(name), -1)
  if not ok then return nil, "action '" .. trim(name) .. "' failed: " .. tostring(toggle) end
  if api.UpdateArrange then api.UpdateArrange() end
  local out = M.describe(api, sec, id, name, macros)
  out.ran = true
  out.toggle = toggle
  return out
end

--- Parse reaper-kb.ini: Custom: macros (ACT) and scripts (SCR), keyed by
--- named id with a leading underscore.
function M.parse_kb(text)
  local macros, scripts = {}, {}
  for line in (text or ""):gmatch("[^\r\n]+") do
    local sec, id, name, rest = line:match('^ACT%s+%d+%s+(%d+)%s+"([^"]*)"%s+"([^"]*)"%s*(.*)$')
    if sec then
      local steps = {}
      for s in rest:gmatch("%S+") do steps[#steps + 1] = s end
      macros["_" .. id] = { name = name, section = tonumber(sec), steps = steps }
    else
      local ssec, sid, sname, path = line:match('^SCR%s+%d+%s+(%d+)%s+(%S+)%s+"([^"]*)"%s+(.+)$')
      if ssec then scripts["_" .. sid] = { name = sname, section = tonumber(ssec), path = (trim(path):gsub('^"(.*)"$', "%1")) } end
    end
  end
  return macros, scripts
end

--- get_action: details, plus a macro's steps or a script's path.
function M.get(api, params, kb_text)
  local sec = section_id(params.section)
  local id, name = M.resolve(api, params.action, sec)
  if not id then return nil, name end
  local macros, scripts = M.parse_kb(kb_text)
  local out = M.describe(api, sec, id, name, macros)
  local macro = out.namedId and macros[out.namedId]
  if macro then
    out.kind = "custom"
    out.steps = {}
    for k, s in ipairs(macro.steps) do
      local sid = step_id(api, s)
      local sname = sid and api.kbd_getTextFromCmd(sid, handle(api, sec)) or nil
      out.steps[k] = { action = s, id = sid, name = (sname ~= "" and sname) or "(no such action in this REAPER — the macro step does nothing)" }
    end
  elseif out.namedId and scripts[out.namedId] then
    out.kind = "script"
    out.scriptPath = scripts[out.namedId].path
  else
    out.kind = out.namedId and "extension" or "native"
  end
  return out
end

-- ---------------------------------------------------------------------------
-- Selection
-- ---------------------------------------------------------------------------

local function selected_tracks(api)
  local out = {}
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    if api.IsTrackSelected(tr) then
      local _, name = api.GetTrackName(tr)
      out[#out + 1] = { index = i, name = name }
    end
  end
  return out
end

--- Select tracks. `tracks` are MediaTracks already resolved by the caller;
--- mode "replace" (default) clears the selection first, "add" keeps it.
function M.select_tracks(api, tracks, mode)
  if mode ~= "add" then
    for i = 0, api.CountTracks(0) - 1 do api.SetTrackSelected(api.GetTrack(0, i), false) end
  end
  for _, tr in ipairs(tracks) do api.SetTrackSelected(tr, true) end
  return selected_tracks(api)
end

--- set_selected_tracks: resolve every ref first (via the injected resolver)
--- so an unknown track changes nothing.
function M.set_selected_tracks(api, refs, mode, resolve_track)
  if type(refs) ~= "table" or #refs == 0 then return nil, "tracks array required" end
  local tracks = {}
  for k, ref in ipairs(refs) do
    local res, err = resolve_track(api, ref, {})
    if not res then return nil, "tracks[" .. (k - 1) .. "]: " .. err .. " — selection unchanged" end
    tracks[k] = res.track
  end
  return { selected = M.select_tracks(api, tracks, mode) }
end

--- set_selected_items: items are { trackIndex, itemIndex } like the media
--- tools. All are resolved before the selection changes.
function M.set_selected_items(api, items, mode)
  if type(items) ~= "table" or #items == 0 then return nil, "items array required" end
  local found = {}
  for k, it in ipairs(items) do
    local tr = api.GetTrack(0, tonumber(it.trackIndex) or -1)
    local item = tr and api.GetTrackMediaItem(tr, tonumber(it.itemIndex) or -1)
    if not item then
      return nil, "items[" .. (k - 1) .. "]: no item " .. tostring(it.itemIndex) .. " on track " .. tostring(it.trackIndex) .. " — selection unchanged"
    end
    found[k] = item
  end
  if mode ~= "add" then api.SelectAllMediaItems(0, false) end
  for _, item in ipairs(found) do api.SetMediaItemSelected(item, true) end
  if api.UpdateArrange then api.UpdateArrange() end

  local selected = {}
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    for j = 0, api.CountTrackMediaItems(tr) - 1 do
      if api.IsMediaItemSelected(api.GetTrackMediaItem(tr, j)) then
        selected[#selected + 1] = { trackIndex = i, itemIndex = j }
      end
    end
  end
  return { selected = selected }
end

M.section_id = section_id
return M
