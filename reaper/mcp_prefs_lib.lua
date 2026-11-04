-- =============================================================================
-- Shared tokens for the status page (apps/bridge-ui, Settings → LoreKit)
-- =============================================================================
-- The page keeps the viewer's read-only LoreKit token (lk_ro_) in ~/.config/reaper-mcp/lorekit.json instead of the
-- browser's localStorage, which is per origin (dev server :8098, REAPER's :8099, a PWA window) and
-- is wiped with the browser's site data. One file means every way of opening the page, and every
-- reinstall, sees the same tokens. Through REAPER's web interface ExtState (the page has no file access):
--
--   lorekit_tokens = {"v":1,"read":…,"req":…,"ok":…,"error":…}
--                                 Published once on start and after every request. REAPER's web server
--                                 answers anyone who can reach its port, so only a READ-ONLY token goes
--                                 through here: a token that doesn't start with lk_ro_ is refused, and the
--                                 write token (lk_rw_, publishing into LoreKit's built-in layer) stays in
--                                 the browser, never in this file or in ExtState.
--   tokens_req = <id>-<control token>-<hex read>
--                                 Replaces the token (an empty hex removes it). The control token is
--                                 the bridge's per-run token, only readable from the status feed.
--
-- The file is JSON {"readToken":…}, created with mode 600 where chmod exists. A file that holds anything
-- else (an earlier version also kept a publishToken) is rewritten without it when the bridge starts.
-- Loaded by mcp_bridge.lua (keeps the bridge under Lua's 200-locals limit).
-- =============================================================================

local M = {}

local ctx
local loaded = false
local state = { read = nil }
local TOKEN_MAX = 512
local FILE = "lorekit.json"

-- The folder of the shared config: $XDG_CONFIG_HOME/reaper-mcp, else ~/.config/reaper-mcp (macOS and Linux),
-- %APPDATA%/reaper-mcp on Windows. getenv is injected so it can be tested.
function M.default_dir(getenv, windows)
  local xdg = getenv("XDG_CONFIG_HOME")
  if xdg and xdg ~= "" then return (xdg:gsub("\\", "/")) .. "/reaper-mcp/" end
  if windows then
    local appdata = getenv("APPDATA")
    if appdata and appdata ~= "" then return (appdata:gsub("\\", "/")) .. "/reaper-mcp/" end
  end
  local home = getenv("HOME") or getenv("USERPROFILE")
  if not home or home == "" then return nil end
  return (home:gsub("\\", "/")) .. "/.config/reaper-mcp/"
end

-- ctx: api (reaper), section (ExtState section), dir (the config folder with a trailing slash, or nil),
-- decode, encode (JSON), read_file, token() (the control token), chmod(path) (owner-only access; optional).
function M.init(c)
  ctx = c
end

-- Only a read-only token: a write token must never reach the file or the web interface
local function valid_token(t)
  return type(t) == "string" and #t <= TOKEN_MAX and t:sub(1, 6) == "lk_ro_" and #t > 6 and not t:find("%c") and not t:find("%s")
end

-- Returns true when the file held more than the read token and needs rewriting
local function load()
  state = { read = nil }
  local text = ctx.dir and ctx.read_file(ctx.dir .. FILE)
  if not text then return false end
  local ok, data = pcall(ctx.decode, text)
  if not ok or type(data) ~= "table" then return false end
  if valid_token(data.readToken) then state.read = data.readToken end
  for k in pairs(data) do if k ~= "readToken" then return true end end
  return false
end

local function publish(req, ok, err)
  ctx.api.SetExtState(ctx.section, "lorekit_tokens", ctx.encode({
    v = 1, read = state.read, req = req, ok = ok, error = err,
    -- the page tells "no file to share" from "the bridge can't write one"
    writable = ctx.dir ~= nil,
  }), false)
end

local function save()
  if not ctx.dir then return nil, "No home folder to keep the tokens in" end
  ctx.api.RecursiveCreateDirectory(ctx.dir, 0)
  local path = ctx.dir .. FILE
  -- Create the file and close its permissions before a token goes in it
  local f, err = io.open(path, "w")
  if not f then return nil, err or "Can't write " .. path end
  f:close()
  if ctx.chmod then pcall(ctx.chmod, path) end
  f = io.open(path, "w")
  if not f then return nil, "Can't write " .. path end
  f:write(ctx.encode({ readToken = state.read }))
  f:close()
  return true
end

local function unhex(s)
  if #s % 2 ~= 0 then return nil end
  return (s:gsub("%x%x", function(h) return string.char(tonumber(h, 16)) end))
end

local function handle(req)
  local id, token, read_hex = req:match("^([%w_]+)%-(%w+)%-(%x*)$")
  -- Anything but a request carrying this run's control token is ignored, like the snapshot requests
  if not id or token ~= ctx.token() then return end
  local read = unhex(read_hex)
  if read == nil then return publish(id, false, "Malformed request") end
  if read ~= "" and not valid_token(read) then return publish(id, false, "Only a read-only token (lk_ro_…) is kept here") end
  local before = state.read
  state.read = read ~= "" and read or nil
  local ok, err = save()
  if not ok then state.read = before end
  publish(id, ok and true or false, err)
end

-- Called every defer tick
function M.poll()
  if not loaded then
    loaded = true
    -- An older file also kept the write token: take it out
    if load() then save() end
    publish(nil, true)
  end
  local req = ctx.api.GetExtState(ctx.section, "tokens_req")
  if req ~= "" then
    ctx.api.DeleteExtState(ctx.section, "tokens_req", false)
    handle(req)
  end
end

return M
