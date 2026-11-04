-- mcp_fxstate_lib.lua — read and replace one VST3 plugin's saved state in a track chunk.
--
-- Pure logic: every function takes the ReaScript API as `api` and `ctx` = { plan, dir, read, write }, so it
-- runs under a fake API in unit tests. Loaded by mcp_bridge.lua with dofile.
--
-- The state is megabytes, so it never travels inside the command JSON: the caller names a file inside the
-- bridge's data folder and this lib reads or writes it (line 1: base64 header, line 2: base64 state).
--
-- Why a new FXID on write: with the same FXID REAPER keeps the loaded instance and ignores the new state
-- (verified on Vital, 2026-11-04). The VST3 length fields are the caller's job (libs/extension-api).

local M = {}

local WRAP = 280
local FX_TAGS = { VST = true, JS = true, AU = true, CLAP = true, DX = true, VIDEO_EFFECT = true }

local function split_lines(chunk)
  local lines = {}
  for line in (chunk .. "\n"):gmatch("(.-)\r?\n") do lines[#lines + 1] = line end
  if lines[#lines] == "" then lines[#lines] = nil end
  return lines
end

local function trim(s) return s:match("^%s*(.-)%s*$") end

local function norm(path) return (tostring(path):gsub("\\", "/")) end

--- A file this lib may touch: inside the bridge folder, named fxstate_<id>.in/.out, no "..".
local function allowed_file(path, dir)
  if type(path) ~= "string" or type(dir) ~= "string" then return false end
  local p, d = norm(path), norm(dir)
  if d:sub(-1) ~= "/" then d = d .. "/" end
  if p:sub(1, #d) ~= d or p:find("..", 1, true) then return false end
  return p:sub(#d + 1):match("^fxstate_[%w%-]+%.%a+$") ~= nil
end

--- The FX of a track chunk in chain order: { open, close, tag, header, name, fxid_line } (1-based line numbers).
--- Returns list, lines, chain_end or nil, err.
local function list_fx(chunk, plan)
  local lines = split_lines(chunk)
  local cs, ce = plan.find_block(lines, "FXCHAIN")
  if not cs then return nil, "the track has no FX chain" end
  local fx, current, d = {}, nil, 1
  for i = cs + 1, ce - 1 do
    local t = trim(lines[i])
    if t:sub(1, 1) == "<" then
      if d == 1 then
        local tag = t:match("^<(%u[%u_%d]*)")
        if tag == "CONTAINER" then
          return nil, "FX containers are not supported yet (this track's chain has one)"
        end
        current = nil
        if FX_TAGS[tag] then
          current = { open = i, tag = tag, header = t, name = t:match('^<%u[%u_%d]*%s+"([^"]*)"') or "" }
          fx[#fx + 1] = current
        end
      end
      d = d + 1
    elseif t == ">" then
      d = d - 1
      if d == 1 and current and not current.close then current.close = i end
    elseif d == 1 and t:match("^FXID%s") and #fx > 0 and not fx[#fx].fxid_line then
      fx[#fx].fxid_line = i
    end
  end
  return fx, lines, ce
end

local function locate(api, params, ctx)
  local track_ref = params.trackIndex
  if track_ref == nil then return nil, "trackIndex is required" end
  local fx_index = tonumber(params.fxIndex)
  if not fx_index or fx_index < 0 or fx_index ~= math.floor(fx_index) then
    return nil, "fxIndex must be a whole number, 0 or more"
  end
  local r, err = ctx.plan.resolve_track(api, track_ref, {})
  if not r then return nil, err end
  local ok, chunk = api.GetTrackStateChunk(r.track, "", false)
  if not ok or not chunk or chunk == "" then return nil, "could not read the track's state" end
  local fx, lines = list_fx(chunk, ctx.plan)
  if not fx then return nil, lines end
  local target = fx[fx_index + 1]
  if not target then return nil, "FX " .. fx_index .. " not found (the track has " .. #fx .. " FX)" end
  if target.tag ~= "VST" or not target.name:match("^VST3") then
    return nil, "FX " .. fx_index .. " (" .. target.name .. ") is not a VST3 plugin; only VST3 state is supported"
  end
  if not target.close then return nil, "FX " .. fx_index .. " has an unreadable state block" end
  return { track = r.track, fx = target, lines = lines, index = fx_index }
end

--- Read one VST3's state into params.outFile. Returns { name, format }.
function M.get_fx_state(api, params, ctx)
  if not allowed_file(params.outFile, ctx.dir) then return nil, "outFile must be an fxstate_* file in the bridge folder" end
  local loc, err = locate(api, params, ctx)
  if not loc then return nil, err end
  local data = {}
  for i = loc.fx.open + 1, loc.fx.close - 1 do
    local t = trim(loc.lines[i])
    if t ~= "" then data[#data + 1] = t end
  end
  if #data < 2 then return nil, "FX " .. loc.index .. " has no saved state to read" end
  local ok, werr = ctx.write(params.outFile, data[1] .. "\n" .. table.concat(data, "", 2) .. "\n")
  if not ok then return nil, "could not write " .. tostring(params.outFile) .. ": " .. tostring(werr) end
  return { name = loc.fx.name, format = "vst3" }
end

--- Replace one VST3's state with the file params.inFile and give it a new FXID so REAPER reloads it.
function M.set_fx_state(api, params, ctx)
  if not allowed_file(params.inFile, ctx.dir) then return nil, "inFile must be an fxstate_* file in the bridge folder" end
  local text = ctx.read(params.inFile)
  if not text then return nil, "could not read " .. tostring(params.inFile) end
  local header, state = text:match("^([^\n]+)\n([^\n]+)\n?")
  local b64 = "^[A-Za-z0-9+/]+=?=?$"
  if not header or not state or not header:match(b64) or not state:match(b64) then
    return nil, "inFile must hold two base64 lines: the header, then the state"
  end

  local loc, err = locate(api, params, ctx)
  if not loc then return nil, err end
  if params.expectName and not loc.fx.name:find(tostring(params.expectName), 1, true) then
    return nil, "FX " .. loc.index .. " is '" .. loc.fx.name .. "', not '" .. tostring(params.expectName) .. "'; nothing changed"
  end
  if not loc.fx.fxid_line then return nil, "FX " .. loc.index .. " has no FXID to renew; nothing changed" end

  local out = {}
  for i = 1, loc.fx.open do out[#out + 1] = loc.lines[i] end
  out[#out + 1] = header
  for at = 1, #state, WRAP do out[#out + 1] = state:sub(at, at + WRAP - 1) end
  for i = loc.fx.close, #loc.lines do
    if i == loc.fx.fxid_line then
      out[#out + 1] = loc.lines[i]:match("^(%s*)") .. "FXID " .. api.genGuid("")
    else
      out[#out + 1] = loc.lines[i]
    end
  end

  api.Undo_BeginBlock()
  local ok = api.SetTrackStateChunk(loc.track, table.concat(out, "\n") .. "\n", false)
  api.Undo_EndBlock("MCP: Set FX state (" .. loc.fx.name .. ")", -1)
  if not ok then return nil, "REAPER refused the new track state" end
  return { name = loc.fx.name, fxIndex = loc.index }
end

return M
