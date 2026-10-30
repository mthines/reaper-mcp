-- =============================================================================
-- Snapshots on the status page (apps/bridge-ui, Snapshots view)
-- =============================================================================
-- The page lists the project's mixer snapshots, restores one with a click (A/B
-- while listening) and saves a new one, through REAPER's web interface ExtState:
--
--   snap_seen = <page clock ms>   The page pings this on every poll while the view is open.
--                                 While it keeps changing, the folder is re-read about once a
--                                 second; ExtState `snapshots` is rewritten only when the list
--                                 (or the current snapshot) changed.
--   snap_req  = <id>-<token>-<op>-<hex name>[-<hex field>…]
--                                 op: restore | delete <name>, save <name>-<description>,
--                                 edit <name>-<new name>-<description>. The token is the bridge's per-run control
--                                 token, only readable from the status feed (REAPER's web server
--                                 sends no CORS headers), so another site can't make it count.
--                                 Name and description travel hex-encoded: no URL or `;` escaping.
--
-- A request runs as an ordinary snapshot_restore / _save / _delete / _edit command through the
-- bridge's dispatcher (ctx.run): logged on the page, refused in read-only or paused
-- mode, one undo point per restore. The answer is published in `snapshots.result`.
--
-- It also registers the keybindable snapshot scripts as actions (M.register_actions).
--
-- Loaded by mcp_bridge.lua (keeps the bridge under Lua's 200-locals limit).
-- =============================================================================

local M = {}

local ctx
local cache = {}            -- path -> { size, entry }
local seen_value, seen_at = "", -math.huge
local last_scan = -math.huge
local last_sig
local result                -- the answer to the page's latest request
local WATCH_S = 5           -- keep watching the folder this long after the page's last ping
local SCAN_S = 1            -- re-read the folder at most this often while watched
local NAME_MAX, DESC_MAX, LIST_MAX = 128, 500, 200

-- Persisted by the snapshot action scripts too (mcp_snapshot_lib.lua): next/prev continue from here
local CURRENT_SECTION, CURRENT_KEY = "MCP_Snapshots", "current_name"

-- ctx: api (reaper), section (ExtState section), dir() and storage() (where snapshots live),
-- decode (full JSON decoder), encode (JSON encoder), read_file, token() (control token),
-- run(cmd) -> response (the bridge's dispatcher, returns { success, data, error }).
function M.init(c)
  ctx = c
end

-- The keybindable snapshot scripts setup copies next to the bridge. `reaper-mcp setup` lists them in
-- reaper-kb.ini while REAPER is closed (ensureSnapshotActions() in cli.ts); when REAPER was open, the
-- bridge adds the missing ones when it starts. Returns the scripts it added.
M.ACTION_SCRIPTS = { "mcp_snapshot_quick_save.lua", "mcp_snapshot_next.lua", "mcp_snapshot_prev.lua" }

function M.register_actions(api, scripts_dir, kb_text)
  local added = {}
  if type(api.AddRemoveReaScript) ~= "function" then return added end
  local listed = {}
  for line in (kb_text or ""):gmatch("[^\r\n]+") do
    if line:sub(1, 4) == "SCR " then
      for _, f in ipairs(M.ACTION_SCRIPTS) do
        if line:find(f, 1, true) then listed[f] = true end
      end
    end
  end
  for _, f in ipairs(M.ACTION_SCRIPTS) do
    local path = scripts_dir .. f
    local fh = not listed[f] and io.open(path, "rb")
    if fh then
      fh:close()
      if (api.AddRemoveReaScript(true, 0, path, true) or 0) > 0 then added[#added + 1] = f end
    end
  end
  return added
end

local function file_size(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local size = f:seek("end")
  f:close()
  return size
end

-- Metadata of one snapshot file, wherever its keys sit: files written by the bridge before
-- metadata-first saves have description after the (large) mixerState.
local function read_entry(path)
  local content = ctx.read_file(path)
  if not content then return nil end
  local ok, snap = pcall(ctx.decode, content)
  if not ok or type(snap) ~= "table" or type(snap.name) ~= "string" or snap.name == "" then return nil end
  local state = type(snap.mixerState) == "table" and snap.mixerState or {}
  local tracks = type(state.tracks) == "table" and #state.tracks or tonumber(snap.trackCount)
  local desc = type(snap.description) == "string" and snap.description or ""
  return {
    name = snap.name,
    description = desc:sub(1, DESC_MAX),
    timestamp = tonumber(snap.timestamp) or 0,
    trackCount = tracks,
    scoped = state.scoped == true or snap.scoped == true,
    fullChunk = state.fullChunk == true or snap.fullChunk == true,
  }
end

-- Every snapshot in the folder, newest first. A file is read again only when its size changed.
function M.list()
  local api, dir = ctx.api, ctx.dir()
  api.EnumerateFiles(dir, -1) -- REAPER caches directory listings; -1 re-reads this one
  local list, present = {}, {}
  local i = 0
  while true do
    local fn = api.EnumerateFiles(dir, i)
    if not fn then break end
    if fn:match("%.json$") then
      local path = dir .. fn
      local size = file_size(path)
      local c = cache[path]
      if not c or c.size ~= size then
        c = { size = size, entry = read_entry(path) }
        cache[path] = c
      end
      present[path] = true
      if c.entry then list[#list + 1] = c.entry end
    end
    i = i + 1
  end
  for path in pairs(cache) do
    if not present[path] then cache[path] = nil end
  end
  table.sort(list, function(a, b)
    if a.timestamp == b.timestamp then return a.name < b.name end
    return a.timestamp > b.timestamp
  end)
  for k = LIST_MAX + 1, #list do list[k] = nil end
  return list
end

local function current_name()
  local v = ctx.api.GetExtState(CURRENT_SECTION, CURRENT_KEY)
  return v ~= "" and v or nil
end

-- A restore from anywhere (page, agent) becomes the current snapshot, as the next/prev actions do
function M.after_command(cmd, response)
  if cmd.type == "snapshot_restore" and response.success and type(cmd.params) == "table" and type(cmd.params.name) == "string" then
    ctx.api.SetExtState(CURRENT_SECTION, CURRENT_KEY, cmd.params.name, false)
  end
  -- A save (page or agent) can replace a file with one of the same size: read that file again.
  -- Deleted files drop out of the cache on the next list().
  local data = type(response.data) == "table" and response.data or {}
  if (cmd.type == "snapshot_save" or cmd.type == "snapshot_edit") and type(data.path) == "string" then
    cache[data.path] = nil
  end
  if cmd.type == "snapshot_save" or cmd.type == "snapshot_delete" or cmd.type == "snapshot_restore" or cmd.type == "snapshot_edit" then
    last_scan = -math.huge -- re-read on the next watched tick
  end
end

local function unhex(s)
  return (s:gsub("%x%x", function(h) return string.char(tonumber(h, 16)) end))
end

-- Runs one page request; returns true when it was valid (and ran)
local function handle(req)
  local id, token, op, rest = req:match("^(%d+)%-(%x+)%-(%a+)%-([%x%-]*)$")
  if not id or token ~= ctx.token() then return false end
  local fields = {}
  for h in (rest .. "-"):gmatch("(%x*)%-") do
    if #h % 2 ~= 0 then return false end
    fields[#fields + 1] = unhex(h)
  end
  local name = (fields[1] or ""):sub(1, NAME_MAX)
  if name == "" then return false end
  local cmd = { id = "page-" .. id, source = "page" }
  if op == "restore" or op == "delete" then
    cmd.type, cmd.params = "snapshot_" .. op, { name = name }
  elseif op == "save" then
    cmd.type, cmd.params = "snapshot_save", { name = name, description = (fields[2] or ""):sub(1, DESC_MAX) }
  elseif op == "edit" and fields[2] and fields[2] ~= "" then
    cmd.type = "snapshot_edit"
    cmd.params = { name = name, newName = fields[2]:sub(1, NAME_MAX), description = (fields[3] or ""):sub(1, DESC_MAX) }
  else
    return false
  end
  local response = ctx.run(cmd) or {}
  local data = type(response.data) == "table" and response.data or {}
  result = {
    id = id, op = op, name = op == "edit" and cmd.params.newName or name, ok = response.success == true,
    error = response.error, warnings = data.warnings, tracksRestored = data.tracksRestored,
  }
  return true
end

local function signature(storage, current, list)
  local parts = { storage, current or "" }
  for _, e in ipairs(list) do
    parts[#parts + 1] = table.concat({ e.name, e.description, tostring(e.timestamp), tostring(e.trackCount),
      tostring(e.scoped), tostring(e.fullChunk) }, "\1")
  end
  if result then parts[#parts + 1] = "result:" .. result.id end
  return table.concat(parts, "\2")
end

local function publish(list)
  local storage, current = ctx.storage(), current_name()
  local sig = signature(storage, current, list)
  if sig == last_sig then return end
  last_sig = sig
  ctx.api.SetExtState(ctx.section, "snapshots", ctx.encode({
    v = 1, storage = storage, current = current, snapshots = list, result = result,
  }), false)
end

-- Called every defer tick. now: seconds (reaper.time_precise)
function M.poll(now)
  local api, section = ctx.api, ctx.section
  local req = api.GetExtState(section, "snap_req")
  local handled = false
  if req ~= "" then
    api.DeleteExtState(section, "snap_req", false)
    handled = handle(req)
  end
  local ping = api.GetExtState(section, "snap_seen")
  if ping ~= "" and ping ~= seen_value then
    -- a fresh ping after a pause: read the folder now
    if now - seen_at >= WATCH_S then last_scan = -math.huge end
    seen_value, seen_at = ping, now
  end
  local watched = now - seen_at < WATCH_S
  if not handled and not (watched and now - last_scan >= SCAN_S) then return end
  last_scan = now
  publish(M.list())
end

return M
