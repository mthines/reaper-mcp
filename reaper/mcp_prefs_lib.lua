-- =============================================================================
-- Shared tokens for the status page (apps/bridge-ui, Settings → LoreKit)
-- =============================================================================
-- The page keeps the viewer's LoreKit tokens in ~/.config/reaper-mcp/lorekit.json instead of the
-- browser's localStorage, which is per origin (dev server :8098, REAPER's :8099, a PWA window) and
-- is wiped with the browser's site data. One file means every way of opening the page, and every
-- reinstall, sees the same tokens. Through REAPER's web interface ExtState (the page has no file access):
--
--   lorekit_tokens = {"v":1,"read":…,"publish":…,"req":…,"ok":…,"error":…}
--                                 Published once on start and after every request. `read` is the
--                                 lk_ro_ token, `publish` the lk_rw_ one (null when unset). REAPER's
--                                 web server answers anyone who can reach its port, so this is only as
--                                 private as that port is: keep it on localhost.
--   tokens_req = <id>-<control token>-<hex read>-<hex publish>
--                                 Replaces both tokens (an empty hex removes one). The control token is
--                                 the bridge's per-run token, only readable from the status feed.
--
-- The file is JSON {"readToken":…,"publishToken":…}, created with mode 600 where chmod exists.
-- Loaded by mcp_bridge.lua (keeps the bridge under Lua's 200-locals limit).
-- =============================================================================

local M = {}

local ctx
local loaded = false
local state = { read = nil, publish = nil }
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

local function valid_token(t)
  return type(t) == "string" and #t > 0 and #t <= TOKEN_MAX and not t:find("%c") and not t:find("%s")
end

local function load()
  state = { read = nil, publish = nil }
  local text = ctx.dir and ctx.read_file(ctx.dir .. FILE)
  if not text then return end
  local ok, data = pcall(ctx.decode, text)
  if not ok or type(data) ~= "table" then return end
  if valid_token(data.readToken) then state.read = data.readToken end
  if valid_token(data.publishToken) then state.publish = data.publishToken end
end

local function publish(req, ok, err)
  ctx.api.SetExtState(ctx.section, "lorekit_tokens", ctx.encode({
    v = 1, read = state.read, publish = state.publish, req = req, ok = ok, error = err,
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
  f:write(ctx.encode({ readToken = state.read, publishToken = state.publish }))
  f:close()
  return true
end

local function unhex(s)
  if #s % 2 ~= 0 then return nil end
  return (s:gsub("%x%x", function(h) return string.char(tonumber(h, 16)) end))
end

local function handle(req)
  local id, token, read_hex, publish_hex = req:match("^([%w_]+)%-(%w+)%-(%x*)%-(%x*)$")
  -- Anything but a request carrying this run's control token is ignored, like the snapshot requests
  if not id or token ~= ctx.token() then return end
  local read, pub = unhex(read_hex), unhex(publish_hex)
  if read == nil or pub == nil then return publish(id, false, "Malformed request") end
  if (read ~= "" and not valid_token(read)) or (pub ~= "" and not valid_token(pub)) then
    return publish(id, false, "A token has spaces or is too long")
  end
  local before = { read = state.read, publish = state.publish }
  state.read, state.publish = read ~= "" and read or nil, pub ~= "" and pub or nil
  local ok, err = save()
  if not ok then state = before end
  publish(id, ok and true or false, err)
end

-- Called every defer tick
function M.poll()
  if not loaded then
    loaded = true
    load()
    publish(nil, true)
  end
  local req = ctx.api.GetExtState(ctx.section, "tokens_req")
  if req ~= "" then
    ctx.api.DeleteExtState(ctx.section, "tokens_req", false)
    handle(req)
  end
end

return M
