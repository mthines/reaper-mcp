-- mcp_extensions_lib.lua — run a Lua command that an extension ships (extension_call).
--
-- An extension's handlers live in <bridge folder>/extensions/<name>/handlers.lua (the server copies the file
-- there when it loads the extension) and return a table of command functions:
--
--   return { my_command = function(params, host) ... return data end }     -- or: return nil, "refusal"
--
-- `host` = { reaper, plan, fxstate, json_decode }. Extensions are trusted code the user installed; this lib
-- only makes sure a command can name nothing outside its own file. Loaded by mcp_bridge.lua with dofile.

local M = {}

local cache = {} -- extension name -> { src, mod }: reloaded when the file's text changes

function M.call(api, params, ctx)
  local name, command = params.extension, params.command
  if type(name) ~= "string" or not name:match("^[a-z][a-z0-9%-]+$") or #name > 32 then
    return nil, "invalid extension name"
  end
  if type(command) ~= "string" or not command:match("^[%a_][%w_]*$") then
    return nil, "invalid command name"
  end

  local path = ctx.dir .. name .. "/handlers.lua"
  local src = ctx.read(path)
  if not src then
    return nil, "extension '" .. name .. "' has no Lua handlers installed; its manifest needs a \"lua\" file and the server must have loaded it"
  end

  local entry = cache[name]
  if not entry or entry.src ~= src then
    local chunk, cerr = load(src, "@" .. path, "t")
    if not chunk then return nil, "extension '" .. name .. "': handlers.lua does not compile: " .. tostring(cerr) end
    local ok, mod = pcall(chunk)
    if not ok then return nil, "extension '" .. name .. "': handlers.lua failed to load: " .. tostring(mod) end
    if type(mod) ~= "table" then return nil, "extension '" .. name .. "': handlers.lua must return a table of commands" end
    entry = { src = src, mod = mod }
    cache[name] = entry
  end

  local fn = entry.mod[command]
  if type(fn) ~= "function" then return nil, "extension '" .. name .. "' has no Lua command '" .. command .. "'" end

  local args = {}
  if type(params.paramsJson) == "string" and params.paramsJson ~= "" then
    local decoded, derr = ctx.plan.json_decode(params.paramsJson)
    if derr then return nil, "paramsJson is not valid JSON: " .. tostring(derr) end
    args = type(decoded) == "table" and decoded or {}
  end

  -- A crash inside the handler is the bridge's "Handler error:", a system fault: it is not caught here.
  return fn(args, { reaper = api, plan = ctx.plan, fxstate = ctx.fxstate, json_decode = ctx.plan.json_decode })
end

return M
