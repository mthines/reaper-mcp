-- mcp_items_lib.lua — items, takes, take FX, item color/fades, and FX
-- housekeeping (move/copy/rename FX, .RfxChain files, track templates).
--
-- Pure logic: every function takes the ReaScript API as `api` and a ctx:
--   ctx.plan  mcp_plan_lib.lua (chunk helpers shared with graft_fxchain)
--   ctx.fs    { exists(path), read(path), write(path, text), mkdir(dir), list(dir) -> files, dirs }
-- so it runs under a fake API and an in-memory file system in unit tests.
-- Loaded by mcp_bridge.lua with dofile.
--
-- Every function validates all of its input before the first write, so a
-- refused request changes nothing. Writes happen inside one undo block.

local M = {}

M.FADE_SHAPES = 7   -- C_FADEINSHAPE / C_FADEOUTSHAPE take 0..6
M.FX_CHAIN_EXT = ".RfxChain"
M.TEMPLATE_EXT = ".RTrackTemplate"

-- -----------------------------------------------------------------------------
-- Lookups (reads only)
-- -----------------------------------------------------------------------------

local function int(v)
  local n = tonumber(v)
  if not n or n ~= math.floor(n) then return nil end
  return n
end

local function get_track(api, idx, field)
  field = field or "trackIndex"
  local i = int(idx)
  if not i then return nil, field .. " required" end
  local tr = i >= 0 and api.GetTrack(0, i) or nil
  if not tr then return nil, "Track " .. i .. " not found" end
  return tr, i
end

local function get_item(api, p)
  local tr, err = get_track(api, p.trackIndex)
  if not tr then return nil, err end
  local i = int(p.itemIndex)
  if not i then return nil, "itemIndex required" end
  local n = api.CountTrackMediaItems(tr)
  if i < 0 or i >= n then
    return nil, "Item " .. i .. " not found (track has " .. n .. " items)"
  end
  return api.GetTrackMediaItem(tr, i), tr
end

-- Active take when takeIndex is absent.
local function get_take(api, item, take_index)
  local n = api.CountTakes(item)
  if take_index == nil then
    local take = api.GetActiveTake(item)
    if not take then return nil, "item has no takes" end
    return take
  end
  local i = int(take_index)
  if not i or i < 0 or i >= n then
    return nil, "Take " .. tostring(take_index) .. " not found (item has " .. n .. " takes)"
  end
  local take = api.GetTake(item, i)
  if not take then return nil, "Take " .. i .. " is an empty take slot" end
  return take
end

local function take_index_of(api, item, take)
  for i = 0, api.CountTakes(item) - 1 do
    if api.GetTake(item, i) == take then return i end
  end
  return -1
end

local function source_file(api, take)
  local src = api.GetMediaItemTake_Source(take)
  if not src then return "" end
  -- Documented as returning the name; some builds return (retval, name).
  local a, b = api.GetMediaSourceFileName(src, "")
  if type(b) == "string" then return b end
  return type(a) == "string" and a or ""
end

local function take_fx_count(api, take)
  return api.TakeFX_GetCount and api.TakeFX_GetCount(take) or 0
end

local function check_fx_index(count, idx, what)
  local i = int(idx)
  if not i then return nil, "fxIndex required" end
  if i < 0 or i >= count then
    return nil, "FX " .. i .. " not found (" .. what .. " has " .. count .. " FX)"
  end
  return i
end

local function track_fx_names(api, tr)
  local names = {}
  for i = 0, api.TrackFX_GetCount(tr) - 1 do
    local _, name = api.TrackFX_GetFXName(tr, i, "")
    names[#names + 1] = name or ""
  end
  return names
end

local function take_fx_list(api, take)
  local list = {}
  for i = 0, take_fx_count(api, take) - 1 do
    local _, name = api.TakeFX_GetFXName(take, i, "")
    list[#list + 1] = {
      fxIndex = i,
      name = name or "",
      enabled = api.TakeFX_GetEnabled(take, i),
      paramCount = api.TakeFX_GetNumParams(take, i),
    }
  end
  return list
end

local function with_undo(api, label, fn)
  api.Undo_BeginBlock()
  local ok, res, err = pcall(fn)
  api.Undo_EndBlock(label, -1)
  if api.UpdateArrange then api.UpdateArrange() end
  if not ok then return nil, tostring(res) end
  return res, err
end

-- -----------------------------------------------------------------------------
-- Insert an audio file as a new item
-- -----------------------------------------------------------------------------

local function basename(path)
  return path:match("([^/\\]+)$") or path
end

local function find_item_index(api, tr, item)
  for i = 0, api.CountTrackMediaItems(tr) - 1 do
    if api.GetTrackMediaItem(tr, i) == item then return i end
  end
  return -1
end

function M.insert_audio_file(api, p, ctx)
  local tr, track_idx = get_track(api, p.trackIndex)
  if not tr then return nil, track_idx end
  local path = p.filePath
  if type(path) ~= "string" or path == "" then return nil, "filePath required" end
  if not ctx.fs.exists(path) then return nil, "file not found: " .. path end
  local position = p.position
  if position == nil then position = api.GetCursorPosition() end
  position = tonumber(position)
  if not position or position < 0 then return nil, "position must be a number >= 0" end

  local src = api.PCM_Source_CreateFromFile(path)
  local length = src and api.GetMediaSourceLength(src) or 0
  if not src or not length or length <= 0 then
    if src and api.PCM_Source_Destroy then api.PCM_Source_Destroy(src) end
    return nil, "REAPER cannot read '" .. path .. "' as audio"
  end

  return with_undo(api, "MCP: Insert audio file " .. basename(path), function()
    local item = api.AddMediaItemToTrack(tr)
    local take = api.AddTakeToMediaItem(item)
    api.SetMediaItemTake_Source(take, src)
    api.SetMediaItemInfo_Value(item, "D_POSITION", position)
    api.SetMediaItemInfo_Value(item, "D_LENGTH", length)
    api.GetSetMediaItemTakeInfo_String(take, "P_NAME", basename(path), true)
    if api.UpdateItemInProject then api.UpdateItemInProject(item) end
    return {
      trackIndex = track_idx,
      itemIndex = find_item_index(api, tr, item),
      position = api.GetMediaItemInfo_Value(item, "D_POSITION"),
      length = api.GetMediaItemInfo_Value(item, "D_LENGTH"),
      takeName = basename(path),
      sourceFile = source_file(api, take),
    }
  end)
end

-- -----------------------------------------------------------------------------
-- Takes
-- -----------------------------------------------------------------------------

function M.list_takes(api, p)
  local item, tr = get_item(api, p)
  if not item then return nil, tr end
  local active = api.GetActiveTake(item)
  local takes = {}
  for i = 0, api.CountTakes(item) - 1 do
    local take = api.GetTake(item, i)
    if take then
      takes[#takes + 1] = {
        takeIndex = i,
        name = api.GetTakeName(take) or "",
        active = take == active,
        isMidi = api.TakeIsMIDI(take) == true,
        sourceFile = source_file(api, take),
        fxCount = take_fx_count(api, take),
      }
    else
      takes[#takes + 1] = { takeIndex = i, empty = true }
    end
  end
  return {
    trackIndex = int(p.trackIndex),
    itemIndex = int(p.itemIndex),
    activeTakeIndex = active and take_index_of(api, item, active) or -1,
    takes = takes,
  }
end

function M.set_active_take(api, p)
  local item, tr = get_item(api, p)
  if not item then return nil, tr end
  if p.takeIndex == nil then return nil, "takeIndex required" end
  local take, err = get_take(api, item, p.takeIndex)
  if not take then return nil, err end
  return with_undo(api, "MCP: Set active take", function()
    api.SetActiveTake(take)
    if api.UpdateItemInProject then api.UpdateItemInProject(item) end
    return M.list_takes(api, p)
  end)
end

-- -----------------------------------------------------------------------------
-- Take FX
-- -----------------------------------------------------------------------------

local function item_take(api, p)
  local item, tr = get_item(api, p)
  if not item then return nil, tr end
  local take, err = get_take(api, item, p.takeIndex)
  if not take then return nil, err end
  return take, item
end

local function take_fx_result(api, p, take, item, extra)
  local res = {
    trackIndex = int(p.trackIndex),
    itemIndex = int(p.itemIndex),
    takeIndex = take_index_of(api, item, take),
    fx = take_fx_list(api, take),
  }
  for k, v in pairs(extra or {}) do res[k] = v end
  return res
end

function M.get_take_fx(api, p)
  local take, item = item_take(api, p)
  if not take then return nil, item end
  if p.fxIndex == nil then return take_fx_result(api, p, take, item) end
  local fx, err = check_fx_index(take_fx_count(api, take), p.fxIndex, "take")
  if not fx then return nil, err end
  local params = {}
  for i = 0, api.TakeFX_GetNumParams(take, fx) - 1 do
    local value, min, max = api.TakeFX_GetParam(take, fx, i)
    local _, pname = api.TakeFX_GetParamName(take, fx, i, "")
    local _, formatted = api.TakeFX_GetFormattedParamValue(take, fx, i, "")
    params[#params + 1] = { paramIndex = i, name = pname or "", value = value, min = min, max = max, formatted = formatted or "" }
  end
  return take_fx_result(api, p, take, item, { fxIndex = fx, params = params })
end

function M.add_take_fx(api, p)
  local take, item = item_take(api, p)
  if not take then return nil, item end
  if type(p.fxName) ~= "string" or p.fxName == "" then return nil, "fxName required" end
  local added
  local res, err = with_undo(api, "MCP: Add take FX '" .. p.fxName .. "'", function()
    added = api.TakeFX_AddByName(take, p.fxName, -1)
    if added < 0 then return nil, "FX not found: " .. p.fxName end
    return true
  end)
  if not res then return nil, err end
  local _, name = api.TakeFX_GetFXName(take, added, "")
  return take_fx_result(api, p, take, item, { fxIndex = added, fxName = name })
end

function M.remove_take_fx(api, p)
  local take, item = item_take(api, p)
  if not take then return nil, item end
  local fx, err = check_fx_index(take_fx_count(api, take), p.fxIndex, "take")
  if not fx then return nil, err end
  local res, e2 = with_undo(api, "MCP: Remove take FX " .. fx, function()
    if not api.TakeFX_Delete(take, fx) then return nil, "Failed to remove take FX " .. fx end
    return true
  end)
  if not res then return nil, e2 end
  return take_fx_result(api, p, take, item, { removedFxIndex = fx })
end

function M.set_take_fx_parameter(api, p)
  local take, item = item_take(api, p)
  if not take then return nil, item end
  local fx, err = check_fx_index(take_fx_count(api, take), p.fxIndex, "take")
  if not fx then return nil, err end
  local param = int(p.paramIndex)
  local n = api.TakeFX_GetNumParams(take, fx)
  if not param or param < 0 or param >= n then
    return nil, "Parameter " .. tostring(p.paramIndex) .. " not found (FX has " .. n .. " parameters)"
  end
  local value = tonumber(p.value)
  if not value then return nil, "value must be a number" end
  local res, e2 = with_undo(api, "MCP: Set take FX parameter", function()
    if not api.TakeFX_SetParam(take, fx, param, value) then
      return nil, "Failed to set param " .. param .. " on take FX " .. fx
    end
    return true
  end)
  if not res then return nil, e2 end
  local now = api.TakeFX_GetParam(take, fx, param)
  local _, formatted = api.TakeFX_GetFormattedParamValue(take, fx, param, "")
  return {
    trackIndex = int(p.trackIndex), itemIndex = int(p.itemIndex),
    takeIndex = take_index_of(api, item, take), fxIndex = fx, paramIndex = param,
    value = now, formatted = formatted or "",
  }
end

-- -----------------------------------------------------------------------------
-- Item color and fades
-- -----------------------------------------------------------------------------

local function parse_color(s)
  if type(s) ~= "string" then return nil end
  local lower = s:lower()
  if lower == "none" or lower == "default" then return false end
  local hex = s:match("^#?(%x%x%x%x%x%x)$")
  if not hex then return nil end
  return tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
end

local function read_color(api, item)
  local c = math.floor(api.GetMediaItemInfo_Value(item, "I_CUSTOMCOLOR") or 0)
  if c & 0x1000000 == 0 then return "none" end
  local r, g, b = api.ColorFromNative(c & 0xFFFFFF)
  return string.format("#%02X%02X%02X", r, g, b)
end

function M.get_item_appearance(api, p)
  local item, tr = get_item(api, p)
  if not item then return nil, tr end
  local v = function(k) return api.GetMediaItemInfo_Value(item, k) end
  return {
    trackIndex = int(p.trackIndex),
    itemIndex = int(p.itemIndex),
    color = read_color(api, item),
    fadeInLength = v("D_FADEINLEN"),
    fadeInShape = math.floor(v("C_FADEINSHAPE")),
    fadeInCurve = v("D_FADEINDIR"),
    fadeOutLength = v("D_FADEOUTLEN"),
    fadeOutShape = math.floor(v("C_FADEOUTSHAPE")),
    fadeOutCurve = v("D_FADEOUTDIR"),
  }
end

function M.set_item_color(api, p)
  local item, tr = get_item(api, p)
  if not item then return nil, tr end
  local r, g, b = parse_color(p.color)
  if r == nil then return nil, "color must be \"#RRGGBB\" or \"none\" (got " .. tostring(p.color) .. ")" end
  local res, err = with_undo(api, "MCP: Set item color", function()
    local native = r and (api.ColorToNative(r, g, b) | 0x1000000) or 0
    api.SetMediaItemInfo_Value(item, "I_CUSTOMCOLOR", native)
    if api.UpdateItemInProject then api.UpdateItemInProject(item) end
    return true
  end)
  if not res then return nil, err end
  return M.get_item_appearance(api, p)
end

-- field -> { item key, validator }
local FADE_FIELDS = {
  { "fadeInLength", "D_FADEINLEN", "length" },
  { "fadeOutLength", "D_FADEOUTLEN", "length" },
  { "fadeInShape", "C_FADEINSHAPE", "shape" },
  { "fadeOutShape", "C_FADEOUTSHAPE", "shape" },
  { "fadeInCurve", "D_FADEINDIR", "curve" },
  { "fadeOutCurve", "D_FADEOUTDIR", "curve" },
}

function M.set_item_fades(api, p)
  local item, tr = get_item(api, p)
  if not item then return nil, tr end
  local sets = {}
  for _, f in ipairs(FADE_FIELDS) do
    local field, key, kind = f[1], f[2], f[3]
    if p[field] ~= nil then
      local v = tonumber(p[field])
      if kind == "length" and (not v or v < 0) then
        return nil, field .. " must be a number of seconds >= 0"
      elseif kind == "shape" and (not int(v) or v < 0 or v >= M.FADE_SHAPES) then
        return nil, field .. " must be an integer 0-6 (0 linear, 1 fast start, 2 fast end, 3 fast start steep, 4 fast end steep, 5 slow start/end, 6 slow start/end steep)"
      elseif kind == "curve" and (not v or v < -1 or v > 1) then
        return nil, field .. " must be between -1 and 1"
      end
      sets[#sets + 1] = { key, v }
    end
  end
  if #sets == 0 then return nil, "set at least one of fadeInLength, fadeOutLength, fadeInShape, fadeOutShape, fadeInCurve, fadeOutCurve" end
  local res, err = with_undo(api, "MCP: Set item fades", function()
    for _, s in ipairs(sets) do api.SetMediaItemInfo_Value(item, s[1], s[2]) end
    if api.UpdateItemInProject then api.UpdateItemInProject(item) end
    return true
  end)
  if not res then return nil, err end
  return M.get_item_appearance(api, p)
end

-- -----------------------------------------------------------------------------
-- Move, copy and rename one FX
-- -----------------------------------------------------------------------------

local function transfer_fx(api, p, is_move)
  local src, src_idx = get_track(api, p.trackIndex)
  if not src then return nil, src_idx end
  local fx, err = check_fx_index(api.TrackFX_GetCount(src), p.fxIndex, "track " .. src_idx)
  if not fx then return nil, err end
  local dst, dst_idx = src, src_idx
  if p.toTrackIndex ~= nil then
    dst, dst_idx = get_track(api, p.toTrackIndex, "toTrackIndex")
    if not dst then return nil, dst_idx end
  end
  local dst_count = api.TrackFX_GetCount(dst)
  -- Moving within one track: the FX leaves the chain first, so the last slot is count-1.
  local max_to = (is_move and dst == src) and dst_count - 1 or dst_count
  local to = p.toIndex == nil and max_to or int(p.toIndex)
  if not to or to < 0 or to > max_to then
    return nil, "toIndex must be 0-" .. max_to .. " (got " .. tostring(p.toIndex) .. ")"
  end
  if is_move and dst == src and to == fx then
    return nil, "FX " .. fx .. " is already at index " .. to
  end
  local verb = is_move and "Move" or "Copy"
  local res, e2 = with_undo(api, "MCP: " .. verb .. " FX " .. fx, function()
    api.TrackFX_CopyToTrack(src, fx, dst, to, is_move)
    return true
  end)
  if not res then return nil, e2 end
  local out = {
    trackIndex = src_idx, fxIndex = fx, toTrackIndex = dst_idx, toIndex = to,
    fx = track_fx_names(api, src),
  }
  if dst ~= src then out.toFx = track_fx_names(api, dst) end
  return out
end

function M.move_fx(api, p) return transfer_fx(api, p, true) end
function M.copy_fx(api, p) return transfer_fx(api, p, false) end

function M.rename_fx(api, p)
  local tr, idx = get_track(api, p.trackIndex)
  if not tr then return nil, idx end
  local fx, err = check_fx_index(api.TrackFX_GetCount(tr), p.fxIndex, "track " .. idx)
  if not fx then return nil, err end
  if type(p.name) ~= "string" then return nil, "name required (\"\" restores the plugin's own name)" end
  if not api.TrackFX_SetNamedConfigParm then return nil, "renaming FX needs REAPER 6.37 or later" end
  local res, e2 = with_undo(api, "MCP: Rename FX " .. fx, function()
    if not api.TrackFX_SetNamedConfigParm(tr, fx, "renamed_name", p.name) then
      return nil, "REAPER refused to rename FX " .. fx
    end
    return true
  end)
  if not res then return nil, e2 end
  local _, renamed = api.TrackFX_GetNamedConfigParm(tr, fx, "renamed_name")
  local _, name = api.TrackFX_GetFXName(tr, fx, "")
  return { trackIndex = idx, fxIndex = fx, name = name or "", renamedName = renamed or "", fx = track_fx_names(api, tr) }
end

-- -----------------------------------------------------------------------------
-- Files under REAPER's resource directory
-- -----------------------------------------------------------------------------

local function split_lines(text)
  local lines = {}
  for line in (text .. "\n"):gmatch("(.-)\r?\n") do lines[#lines + 1] = line end
  if lines[#lines] == "" then lines[#lines] = nil end
  return lines
end

local function trim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
local function is_open(line) return trim(line):sub(1, 1) == "<" end
local function is_close(line) return trim(line) == ">" end

local function ends_with_ci(s, suffix)
  return #s >= #suffix and s:sub(-#suffix):lower() == suffix:lower()
end

local function is_absolute(path)
  return path:sub(1, 1) == "/" or path:sub(1, 1) == "\\" or path:match("^%a:[/\\]") ~= nil
end

-- A name under <resource>/<sub>/: subfolders allowed, nothing that escapes.
local function resource_path(api, sub, name, ext)
  if type(name) ~= "string" or trim(name) == "" then return nil, "name required" end
  if is_absolute(name) or name:match("^%a:") then
    return nil, "'" .. name .. "' is outside REAPER's " .. sub .. " folder — pass a name, not a path"
  end
  local parts = {}
  for part in name:gsub("\\", "/"):gmatch("[^/]+") do
    if part == ".." or part == "." then
      return nil, "'" .. name .. "' is outside REAPER's " .. sub .. " folder — '..' is not allowed"
    end
    parts[#parts + 1] = part
  end
  local rel = table.concat(parts, "/")
  if ends_with_ci(rel, ext) then rel = rel:sub(1, -#ext - 1) end
  if rel == "" or rel:find("[%c]") then return nil, "invalid name '" .. name .. "'" end
  local dir = api.GetResourcePath() .. "/" .. sub
  local path = dir .. "/" .. rel .. ext
  return path, rel, path:match("^(.*)/[^/]*$")
end

-- Reads may also name an absolute file with the right extension.
local function readable_path(api, ctx, sub, name, ext)
  local path, rel
  if type(name) == "string" and is_absolute(name) then
    if not ends_with_ci(name, ext) then return nil, "'" .. name .. "' is not a " .. ext .. " file" end
    path, rel = name, name
  else
    path, rel = resource_path(api, sub, name, ext)
    if not path then return nil, rel end
  end
  if not ctx.fs.exists(path) then return nil, "file not found: " .. path end
  return path, rel
end

local function writable_path(api, ctx, sub, name, ext, overwrite)
  local path, rel, dir = resource_path(api, sub, name, ext)
  if not path then return nil, rel end
  if ctx.fs.exists(path) and overwrite ~= true then
    return nil, path .. " already exists — pass overwrite: true to replace it"
  end
  return path, rel, dir
end

-- -----------------------------------------------------------------------------
-- .RfxChain save / load
-- -----------------------------------------------------------------------------

local CHAIN_HEADER = { WNDRECT = true, SHOW = true, LASTSEL = true, DOCKED = true }

-- Lines inside the FXCHAIN block, without its <FXCHAIN / > and window header.
local function chain_body(fxchain_block)
  local lines = split_lines(fxchain_block)
  local body, started = {}, false
  for i = 2, #lines - 1 do
    local key = trim(lines[i]):match("^(%S+)")
    if not started and not (key and CHAIN_HEADER[key]) then started = true end
    if started then body[#body + 1] = lines[i] end
  end
  return body
end

local function chain_header(fxchain_block)
  local lines = split_lines(fxchain_block)
  local head = { lines[1] }
  for i = 2, #lines - 1 do
    local key = trim(lines[i]):match("^(%S+)")
    if not (key and CHAIN_HEADER[key]) then break end
    head[#head + 1] = lines[i]
  end
  return head
end

-- Number of FX in chain-body lines: one BYPASS line per FX, at the top level.
local function count_chain_fx(lines)
  local depth, n = 0, 0
  for _, line in ipairs(lines) do
    if is_open(line) then depth = depth + 1
    elseif is_close(line) then depth = depth - 1
    elseif depth == 0 and trim(line):match("^BYPASS%s") then n = n + 1 end
  end
  return n
end

function M.save_fx_chain(api, p, ctx)
  local tr, idx = get_track(api, p.trackIndex)
  if not tr then return nil, idx end
  local count = api.TrackFX_GetCount(tr)
  if count == 0 then return nil, "Track " .. idx .. " has no FX to save" end
  local path, rel, dir = writable_path(api, ctx, "FXChains", p.name, M.FX_CHAIN_EXT, p.overwrite)
  if not path then return nil, rel end
  local _, chunk = api.GetTrackStateChunk(tr, "", false)
  local block = ctx.plan.extract_fxchain(chunk or "")
  if not block then return nil, "Track " .. idx .. " has no FX chain in its state chunk" end
  local body = chain_body(block)
  ctx.fs.mkdir(dir)
  local ok, err = ctx.fs.write(path, table.concat(body, "\n") .. "\n")
  if not ok then return nil, "could not write " .. path .. (err and (": " .. tostring(err)) or "") end
  return { trackIndex = idx, name = rel, path = path, fxCount = count_chain_fx(body), fx = track_fx_names(api, tr) }
end

function M.load_fx_chain(api, p, ctx)
  local tr, idx = get_track(api, p.trackIndex)
  if not tr then return nil, idx end
  local mode = p.mode or "append"
  if mode ~= "append" and mode ~= "replace" then return nil, "mode must be append or replace" end
  local path, rel = readable_path(api, ctx, "FXChains", p.name, M.FX_CHAIN_EXT)
  if not path then return nil, rel end
  local text = ctx.fs.read(path)
  if not text then return nil, "could not read " .. path end
  local body = split_lines(text)
  local n = count_chain_fx(body)
  if n == 0 then return nil, path .. " holds no FX" end

  local plan = ctx.plan
  local fresh = split_lines(plan.regenerate_fxids(table.concat(body, "\n"), api.genGuid))
  local _, chunk = api.GetTrackStateChunk(tr, "", false)
  local existing = plan.extract_fxchain(chunk or "")
  local block = {}
  if existing and mode == "append" then
    local lines = split_lines(existing)
    for i = 1, #lines - 1 do block[#block + 1] = lines[i] end
  elseif existing then
    block = chain_header(existing)
  else
    block = { "<FXCHAIN", "SHOW 0", "LASTSEL 0", "DOCKED 0" }
  end
  for _, l in ipairs(fresh) do block[#block + 1] = l end
  block[#block + 1] = ">"

  local before = api.TrackFX_GetCount(tr)
  local res, err = with_undo(api, "MCP: Load FX chain " .. rel, function()
    if not api.SetTrackStateChunk(tr, plan.splice_fxchain(chunk, table.concat(block, "\n")), false) then
      return nil, "REAPER rejected the FX chain"
    end
    return true
  end)
  if not res then return nil, err end
  return {
    trackIndex = idx, name = rel, path = path, mode = mode, loaded = n,
    fxCountBefore = before, fx = track_fx_names(api, tr),
  }
end

-- -----------------------------------------------------------------------------
-- Track templates
-- -----------------------------------------------------------------------------

-- Remove the direct children of the outer block that `drop(lines, i)` flags:
-- returns true to drop that line (or the whole block it opens).
local function filter_children(lines, drop)
  local out, depth, skip_to = {}, 0, nil
  for i, line in ipairs(lines) do
    if skip_to then
      if is_open(line) then depth = depth + 1 elseif is_close(line) then depth = depth - 1 end
      if depth < skip_to then skip_to = nil end
    else
      local at_child = depth == 1
      if is_open(line) then
        depth = depth + 1
        if at_child and drop(line) then skip_to = depth else out[#out + 1] = line end
      elseif is_close(line) then
        depth = depth - 1
        out[#out + 1] = line
      elseif not (at_child and drop(line)) then
        out[#out + 1] = line
      end
    end
  end
  return out
end

function M.save_track_template(api, p, ctx)
  local tr, idx = get_track(api, p.trackIndex)
  if not tr then return nil, idx end
  local path, rel, dir = writable_path(api, ctx, "TrackTemplates", p.name, M.TEMPLATE_EXT, p.overwrite)
  if not path then return nil, rel end
  local _, chunk = api.GetTrackStateChunk(tr, "", false)
  if not chunk or not chunk:match("^%s*<TRACK") then return nil, "could not read track " .. idx .. "'s state" end
  local keep_items = p.includeItems == true
  -- A single saved track carries no receives (they point at other tracks by
  -- index) and is not a folder start (that would swallow tracks below it).
  local lines = filter_children(split_lines(chunk), function(line)
    local key = trim(line):match("^<?(%S+)")
    return key == "AUXRECV" or (key == "ITEM" and not keep_items)
  end)
  for i, line in ipairs(lines) do
    local indent = line:match("^(%s*)ISBUS%s")
    if indent then lines[i] = indent .. "ISBUS 0 0" end
  end
  ctx.fs.mkdir(dir)
  local ok, err = ctx.fs.write(path, table.concat(lines, "\n") .. "\n")
  if not ok then return nil, "could not write " .. path .. (err and (": " .. tostring(err)) or "") end
  local _, name = api.GetTrackName(tr)
  return {
    trackIndex = idx, name = rel, path = path, trackName = name or "",
    fx = track_fx_names(api, tr), includeItems = keep_items,
  }
end

-- Top-level <TRACK blocks of a template file.
local function template_tracks(text)
  local tracks, cur, depth = {}, nil, 0
  for _, line in ipairs(split_lines(text)) do
    if is_open(line) then
      depth = depth + 1
      if depth == 1 then
        local t = trim(line)
        cur = (t == "<TRACK" or t:match("^<TRACK%s")) and {} or nil
      end
      if cur then cur[#cur + 1] = line end
    elseif is_close(line) then
      if cur then cur[#cur + 1] = line end
      depth = depth - 1
      if depth == 0 and cur then tracks[#tracks + 1] = table.concat(cur, "\n") .. "\n"; cur = nil end
    elseif cur then
      cur[#cur + 1] = line
    end
  end
  return tracks
end

-- Fresh GUIDs so the inserted track never shares an identity with its source.
local GUID_KEYS = { TRACKID = true, FXID = true, IGUID = true, GUID = true }
local function regenerate_guids(chunk, gen_guid)
  local lines = split_lines(chunk)
  for i, line in ipairs(lines) do
    local indent, key = line:match("^(%s*)(%u+)%s+%b{}%s*$")
    if key and GUID_KEYS[key] then lines[i] = indent .. key .. " " .. gen_guid() end
  end
  return table.concat(lines, "\n") .. "\n"
end

function M.insert_track_template(api, p, ctx)
  local path, rel = readable_path(api, ctx, "TrackTemplates", p.name, M.TEMPLATE_EXT)
  if not path then return nil, rel end
  local count = api.CountTracks(0)
  local at = p.index == nil and count or int(p.index)
  if not at or at < 0 or at > count then
    return nil, "index must be 0-" .. count .. " (got " .. tostring(p.index) .. ")"
  end
  local text = ctx.fs.read(path)
  if not text then return nil, "could not read " .. path end
  local chunks = template_tracks(text)
  if #chunks == 0 then return nil, path .. " holds no tracks" end

  local res, err = with_undo(api, "MCP: Insert track template " .. rel, function()
    local inserted = {}
    for k, c in ipairs(chunks) do
      local i = at + k - 1
      api.InsertTrackAtIndex(i, true)
      local tr = api.GetTrack(0, i)
      if not api.SetTrackStateChunk(tr, regenerate_guids(c, api.genGuid), false) then
        return nil, "REAPER rejected track " .. k .. " of the template"
      end
      local _, name = api.GetTrackName(tr)
      inserted[#inserted + 1] = { index = i, name = name or "", fx = track_fx_names(api, tr) }
    end
    return inserted
  end)
  if not res then return nil, err end
  return { name = rel, path = path, inserted = res }
end

-- -----------------------------------------------------------------------------
-- Listing saved chains and templates
-- -----------------------------------------------------------------------------

local MAX_LIST = 500
local MAX_DEPTH = 4

local function list_files(api, ctx, sub, ext)
  local root = api.GetResourcePath() .. "/" .. sub
  local found = {}
  local truncated = false
  local function walk(dir, prefix, depth)
    local files, dirs = ctx.fs.list(dir)
    for _, f in ipairs(files or {}) do
      if ends_with_ci(f, ext) then
        if #found >= MAX_LIST then truncated = true; return end
        found[#found + 1] = prefix .. f:sub(1, -#ext - 1)
      end
    end
    if depth >= MAX_DEPTH then return end
    for _, d in ipairs(dirs or {}) do
      walk(dir .. "/" .. d, prefix .. d .. "/", depth + 1)
      if truncated then return end
    end
  end
  walk(root, "", 0)
  table.sort(found, function(a, b) return a:lower() < b:lower() end)
  return { folder = root, names = found, total = #found, truncated = truncated }
end

function M.list_fx_chains(api, _, ctx) return list_files(api, ctx, "FXChains", M.FX_CHAIN_EXT) end
function M.list_track_templates(api, _, ctx) return list_files(api, ctx, "TrackTemplates", M.TEMPLATE_EXT) end

return M
