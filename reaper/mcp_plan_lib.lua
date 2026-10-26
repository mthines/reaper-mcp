-- =============================================================================
-- MCP Plan Library — executes a typed list of ops as one all-or-nothing edit
-- =============================================================================
-- Loaded via dofile() by mcp_bridge.lua (handler: run_plan). Every function
-- takes the ReaScript API as `api` instead of reading the `reaper` global, so
-- the whole executor runs outside REAPER against a fake API in unit tests.
--
-- A plan runs in two passes:
--   1. validate — resolve every target and check every op; no writes. Any
--      conflict rejects the whole plan (dryRun stops here and reports).
--   2. apply — all ops inside one undo block. If an op fails after writing,
--      the block is closed and undone, so no partial edit is left behind.
--
-- Target references:
--   track: 3 (0-based index) | "Kick" (exact name, then case-insensitive)
--          | "{GUID}" | "$ref" (bound by an earlier add_track `as`)
--          | "3" (digit string: name first, index fallback)
--   fx:    0 (index on the op's track) | "ReaComp" (unique substring match)
--          | "$ref" (bound by an earlier add_fx `as`; carries its track)
-- =============================================================================

local M = {}

local MAX_REMEMBERED_KEYS = 100
local REVERT_LABEL = "MCP: run_plan (failed — reverting)"

-- -----------------------------------------------------------------------------
-- Pure helpers (no API access)
-- -----------------------------------------------------------------------------

local function from_db(db)
  return 10 ^ (db / 20)
end

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function M.base64_decode(data)
  data = data:gsub("[^%w%+/=]", "")
  return (data:gsub(".", function(ch)
    if ch == "=" then return "" end
    local n = B64:find(ch, 1, true) - 1
    local bits = ""
    for i = 6, 1, -1 do
      bits = bits .. (((n % 2 ^ i) - (n % 2 ^ (i - 1)) > 0) and "1" or "0")
    end
    return bits
  end):gsub("%d%d%d?%d?%d?%d?%d?%d?", function(byte)
    if #byte ~= 8 then return "" end
    local c = 0
    for i = 1, 8 do
      if byte:sub(i, i) == "1" then c = c + 2 ^ (8 - i) end
    end
    return string.char(math.floor(c))
  end))
end

local function split_lines(chunk)
  local lines = {}
  for line in (chunk .. "\n"):gmatch("(.-)\r?\n") do
    lines[#lines + 1] = line
  end
  -- A chunk ending in "\n" yields one trailing empty line; drop it.
  if lines[#lines] == "" then lines[#lines] = nil end
  return lines
end

local function is_block_open(line, tag)
  local trimmed = line:match("^%s*(.-)%s*$")
  if tag then
    -- "<FXCHAIN" must not also match "<FXCHAIN_REC" (input FX).
    return trimmed == "<" .. tag or trimmed:sub(1, #tag + 2) == "<" .. tag .. " "
  end
  return trimmed:sub(1, 1) == "<"
end

local function is_block_close(line)
  return line:match("^%s*>%s*$") ~= nil
end

--- Find a block that is a DIRECT child of the chunk's outer block.
--- Returns first_line, last_line (1-based, inclusive) or nil.
function M.find_block(lines, tag)
  local depth = 0
  local start = nil
  for i, line in ipairs(lines) do
    if is_block_open(line) then
      depth = depth + 1
      if depth == 2 and is_block_open(line, tag) then start = i end
    elseif is_block_close(line) then
      if depth == 2 and start then return start, i end
      depth = depth - 1
    end
  end
  return nil
end

--- Extract the FXCHAIN block text from a track state chunk, or nil.
function M.extract_fxchain(chunk)
  local lines = split_lines(chunk)
  local s, e = M.find_block(lines, "FXCHAIN")
  if not s then return nil end
  return table.concat(lines, "\n", s, e)
end

--- Replace every "FXID {...}" line with a fresh GUID from gen_guid().
function M.regenerate_fxids(block, gen_guid)
  local lines = split_lines(block)
  for i, line in ipairs(lines) do
    local indent = line:match("^(%s*)FXID%s+%b{}%s*$")
    if indent then lines[i] = indent .. "FXID " .. gen_guid() end
  end
  return table.concat(lines, "\n")
end

--- Put `fxchain` into a track chunk: replace its FXCHAIN if it has one,
--- otherwise insert it before the first ITEM block (or before the track's
--- closing ">"). Everything else in the target chunk is kept as is.
function M.splice_fxchain(target_chunk, fxchain)
  local lines = split_lines(target_chunk)
  local new_lines = split_lines(fxchain)
  local s, e = M.find_block(lines, "FXCHAIN")
  local out = {}
  if s then
    for i = 1, s - 1 do out[#out + 1] = lines[i] end
    for _, l in ipairs(new_lines) do out[#out + 1] = l end
    for i = e + 1, #lines do out[#out + 1] = lines[i] end
  else
    local insert_at = M.find_block(lines, "ITEM") or #lines
    for i = 1, insert_at - 1 do out[#out + 1] = lines[i] end
    for _, l in ipairs(new_lines) do out[#out + 1] = l end
    for i = insert_at, #lines do out[#out + 1] = lines[i] end
  end
  return table.concat(out, "\n") .. "\n"
end

-- -----------------------------------------------------------------------------
-- Target resolution (reads only)
-- -----------------------------------------------------------------------------

local function track_label(ref)
  return type(ref) == "number" and ("#" .. ref) or ("'" .. tostring(ref) .. "'")
end

local function find_tracks_by_name(api, name, insensitive)
  local hits = {}
  local want = insensitive and name:lower() or name
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    local _, tname = api.GetTrackName(tr)
    tname = tname or ""
    if (insensitive and tname:lower() or tname) == want then hits[#hits + 1] = tr end
  end
  return hits
end

--- Resolve a track reference to { track = MediaTrack } or { ref = name }
--- (a track the plan creates). Returns nil, err when unresolvable/ambiguous.
local function resolve_track(api, ref, refs)
  if type(ref) == "number" then
    local tr = api.GetTrack(0, math.floor(ref))
    if not tr then return nil, "track " .. track_label(ref) .. " not found" end
    return { track = tr }
  end
  if type(ref) ~= "string" or ref == "" then
    return nil, "track reference missing"
  end
  if ref:sub(1, 1) == "$" then
    local bound = refs[ref]
    if not bound then return nil, "reference " .. ref .. " is not defined by an earlier op" end
    if bound.kind ~= "track" then return nil, "reference " .. ref .. " is an FX, not a track" end
    return { ref = ref }
  end
  if ref:sub(1, 1) == "{" then
    for i = 0, api.CountTracks(0) - 1 do
      local tr = api.GetTrack(0, i)
      if api.GetTrackGUID(tr) == ref then return { track = tr } end
    end
    return nil, "track with GUID " .. ref .. " not found"
  end
  local hits = find_tracks_by_name(api, ref, false)
  if #hits == 0 then hits = find_tracks_by_name(api, ref, true) end
  if #hits == 1 then return { track = hits[1] } end
  if #hits > 1 then
    return nil, "track name '" .. ref .. "' is ambiguous (" .. #hits .. " tracks match)"
  end
  if ref:match("^%d+$") then return resolve_track(api, tonumber(ref), refs) end
  return nil, "track '" .. ref .. "' not found"
end

local function fx_installed(api, name)
  if not api.EnumInstalledFX then return true end
  local want = name:lower()
  local i = 0
  while true do
    local ok, fx_name = api.EnumInstalledFX(i)
    if not ok then return false end
    if fx_name and fx_name:lower():find(want, 1, true) then return true end
    i = i + 1
  end
end

-- -----------------------------------------------------------------------------
-- Validation pass
-- -----------------------------------------------------------------------------

local KNOWN_OPS = {
  add_track = true, set_track = true, add_fx = true,
  set_fx_params = true, add_send = true, graft_fxchain = true,
}

--- Validate every op without writing. Returns resolved ops and conflicts.
function M.validate(api, ops)
  local refs = {}       -- "$name" -> { kind = "track" | "fx", op = i }
  local resolved = {}
  local conflicts = {}
  local warnings = {}

  local function conflict(i, op, msg)
    conflicts[#conflicts + 1] = { op = i - 1, type = op.op, error = msg }
  end

  for i, op in ipairs(ops) do
    local r = { op = op, index = i - 1 }
    local t = op.op
    if not KNOWN_OPS[t] then
      conflict(i, op, "unknown op type '" .. tostring(t) .. "'")
    else
      local function need_track(field)
        local res, err = resolve_track(api, op[field], refs)
        if not res then conflict(i, op, field .. ": " .. err) end
        return res
      end

      local fx_is_ref = type(op.fx) == "string" and op.fx:sub(1, 1) == "$"
      if t == "set_track" or t == "add_fx" or t == "graft_fxchain"
        or (t == "set_fx_params" and not fx_is_ref) then
        r.track = need_track("track")
      end

      if t == "add_fx" then
        if type(op.fxName) ~= "string" or op.fxName == "" then
          conflict(i, op, "fxName required")
        elseif not fx_installed(api, op.fxName) then
          -- A warning, not a conflict: AddByName accepts names (JS paths,
          -- prefixes) that the installed-FX list spells differently.
          warnings[#warnings + 1] = { op = i - 1, type = t, warning = "FX '" .. op.fxName .. "' not found in the installed FX list" }
        end
      elseif t == "set_fx_params" then
        if type(op.params) ~= "table" or #op.params == 0 then
          conflict(i, op, "params array required")
        end
        if fx_is_ref then
          local bound = refs[op.fx]
          if not bound then
            conflict(i, op, "reference " .. op.fx .. " is not defined by an earlier op")
          elseif bound.kind ~= "fx" then
            conflict(i, op, "reference " .. op.fx .. " is a track, not an FX")
          end
        elseif type(op.fx) == "number" then
          if r.track and r.track.track and op.fx >= api.TrackFX_GetCount(r.track.track) then
            conflict(i, op, "fx index " .. op.fx .. " out of range")
          end
        elseif type(op.fx) ~= "string" then
          conflict(i, op, "fx reference missing")
        end
      elseif t == "add_send" then
        r.from = need_track("from")
        r.to = need_track("to")
      elseif t == "graft_fxchain" then
        if op.fromChunk then
          local ok, chunk = pcall(M.base64_decode, op.fromChunk)
          r.fxchain = ok and M.extract_fxchain(chunk) or nil
          if not r.fxchain then conflict(i, op, "fromChunk holds no FXCHAIN block") end
        elseif op.from ~= nil then
          r.source = need_track("from")
          if r.source and r.source.track then
            local _, chunk = api.GetTrackStateChunk(r.source.track, "", false)
            if not M.extract_fxchain(chunk or "") then
              conflict(i, op, "source track has no FX chain")
            end
          end
        else
          conflict(i, op, "graft_fxchain needs `from` or `fromChunk`")
        end
      end

      if op.as ~= nil then
        if type(op.as) ~= "string" or op.as:sub(1, 1) ~= "$" then
          conflict(i, op, "`as` must start with '$'")
        elseif refs[op.as] then
          conflict(i, op, "reference " .. op.as .. " is already defined")
        elseif t == "add_track" then
          refs[op.as] = { kind = "track", op = i }
        elseif t == "add_fx" then
          refs[op.as] = { kind = "fx", op = i }
        else
          conflict(i, op, "`as` is only allowed on add_track and add_fx")
        end
      end
    end
    resolved[i] = r
  end
  return resolved, conflicts, warnings
end

-- -----------------------------------------------------------------------------
-- Apply pass
-- -----------------------------------------------------------------------------

local function fx_index_by_guid(api, track, guid)
  for j = 0, api.TrackFX_GetCount(track) - 1 do
    if api.TrackFX_GetFXGUID(track, j) == guid then return j end
  end
  return nil
end

local function apply_op(api, r, bound)
  local op = r.op
  local t = op.op

  local function track_of(res)
    if res.track then return res.track end
    return bound[res.ref].track
  end

  if t == "add_track" then
    local idx = op.index or api.CountTracks(0)
    api.InsertTrackAtIndex(idx, true)
    local tr = api.GetTrack(0, idx)
    if op.name then api.GetSetMediaTrackInfo_String(tr, "P_NAME", op.name, true) end
    if op.as then bound[op.as] = { track = tr } end
    return { track = idx, guid = api.GetTrackGUID(tr) }

  elseif t == "set_track" then
    local tr = track_of(r.track)
    if op.volume ~= nil then api.SetMediaTrackInfo_Value(tr, "D_VOL", from_db(op.volume)) end
    if op.pan ~= nil then api.SetMediaTrackInfo_Value(tr, "D_PAN", op.pan) end
    if op.mute ~= nil then api.SetMediaTrackInfo_Value(tr, "B_MUTE", op.mute) end
    if op.solo ~= nil then api.SetMediaTrackInfo_Value(tr, "I_SOLO", op.solo) end
    if op.recordArm ~= nil then api.SetMediaTrackInfo_Value(tr, "I_RECARM", op.recordArm) end
    if op.phase ~= nil then api.SetMediaTrackInfo_Value(tr, "B_PHASE", op.phase) end
    if op.input ~= nil then api.SetMediaTrackInfo_Value(tr, "I_RECINPUT", op.input) end
    if op.name ~= nil then api.GetSetMediaTrackInfo_String(tr, "P_NAME", op.name, true) end
    return {}

  elseif t == "add_fx" then
    local tr = track_of(r.track)
    -- TrackFX_AddByName: -1 appends; -1000 - n inserts at position n.
    local pos = op.position ~= nil and (-1000 - op.position) or -1
    local fx = api.TrackFX_AddByName(tr, op.fxName, false, pos)
    if fx < 0 then error("FX not found: " .. op.fxName, 0) end
    if op.enabled ~= nil then api.TrackFX_SetEnabled(tr, fx, op.enabled == 1 or op.enabled == true) end
    for _, p in ipairs(op.params or {}) do
      if not api.TrackFX_SetParam(tr, fx, p.index, p.value) then
        error("failed to set param " .. p.index .. " on " .. op.fxName, 0)
      end
    end
    local guid = api.TrackFX_GetFXGUID(tr, fx)
    if op.as then bound[op.as] = { track = tr, fxGuid = guid } end
    local _, name = api.TrackFX_GetFXName(tr, fx)
    return { fxIndex = fx, fxName = name }

  elseif t == "set_fx_params" then
    local tr, fx
    if type(op.fx) == "string" and op.fx:sub(1, 1) == "$" then
      tr = bound[op.fx].track
      fx = fx_index_by_guid(api, tr, bound[op.fx].fxGuid)
    else
      tr = track_of(r.track)
      if type(op.fx) == "number" then
        fx = op.fx
      else
        local want = op.fx:lower()
        for j = 0, api.TrackFX_GetCount(tr) - 1 do
          local _, name = api.TrackFX_GetFXName(tr, j)
          if (name or ""):lower():find(want, 1, true) then
            if fx then error("fx name '" .. op.fx .. "' matches more than one FX", 0) end
            fx = j
          end
        end
      end
    end
    if not fx or fx >= api.TrackFX_GetCount(tr) then error("fx " .. tostring(op.fx) .. " not found", 0) end
    for _, p in ipairs(op.params) do
      if not api.TrackFX_SetParam(tr, fx, p.index, p.value) then
        error("failed to set param " .. p.index .. " on fx " .. fx, 0)
      end
    end
    return { fxIndex = fx, updated = #op.params }

  elseif t == "add_send" then
    local src, dst = track_of(r.from), track_of(r.to)
    local s = api.CreateTrackSend(src, dst)
    if s < 0 then error("could not create send", 0) end
    if op.volume ~= nil then api.SetTrackSendInfo_Value(src, 0, s, "D_VOL", from_db(op.volume)) end
    if op.pan ~= nil then api.SetTrackSendInfo_Value(src, 0, s, "D_PAN", op.pan) end
    if op.mute ~= nil then api.SetTrackSendInfo_Value(src, 0, s, "B_MUTE", op.mute) end
    return { sendIndex = s }

  elseif t == "graft_fxchain" then
    local fxchain = r.fxchain
    if not fxchain then
      local _, src_chunk = api.GetTrackStateChunk(track_of(r.source), "", false)
      fxchain = M.extract_fxchain(src_chunk or "")
      if not fxchain then error("source track has no FX chain", 0) end
    end
    fxchain = M.regenerate_fxids(fxchain, function() return api.genGuid("") end)
    local tr = track_of(r.track)
    local _, target_chunk = api.GetTrackStateChunk(tr, "", false)
    if not api.SetTrackStateChunk(tr, M.splice_fxchain(target_chunk, fxchain), false) then
      error("SetTrackStateChunk failed", 0)
    end
    return { fxCount = api.TrackFX_GetCount(tr) }
  end
end

local function remember(ctx, key, result)
  ctx.applied = ctx.applied or {}
  ctx.applied_order = ctx.applied_order or {}
  ctx.applied[key] = result
  table.insert(ctx.applied_order, key)
  if #ctx.applied_order > MAX_REMEMBERED_KEYS then
    ctx.applied[table.remove(ctx.applied_order, 1)] = nil
  end
end

local function describe(resolved)
  local out = {}
  for i, r in ipairs(resolved) do out[i] = { index = r.index, op = r.op.op } end
  return out
end

--- Run a plan. `ctx` persists across calls (idempotency memory) and supplies
--- `snapshot_save(name)` for the optional pre-apply snapshot.
--- Returns data, or nil + error string (the bridge handler contract).
function M.run_plan(api, params, ctx)
  ctx = ctx or {}
  local ops = params.ops
  if type(ops) == "string" then
    if not api.CF_Json_Parse then
      return nil, "run_plan needs the SWS extension (CF_Json_Parse) to read the plan; install SWS and restart REAPER"
    end
    local ok, val = api.CF_Json_Parse(ops)
    if not ok or type(val) ~= "table" then return nil, "ops is not a valid JSON array" end
    ops = val
  end
  if type(ops) ~= "table" or #ops == 0 then return nil, "ops array required" end

  local key = params.idempotencyKey
  if key and key ~= "" and ctx.applied and ctx.applied[key] then
    return { alreadyApplied = true, idempotencyKey = key, result = ctx.applied[key] }
  end

  local resolved, conflicts, warnings = M.validate(api, ops)

  if params.dryRun then
    return {
      dryRun = true, valid = #conflicts == 0, ops = describe(resolved),
      conflicts = conflicts, warnings = warnings,
    }
  end
  if #conflicts > 0 then
    local msgs = {}
    for _, c in ipairs(conflicts) do
      msgs[#msgs + 1] = "op " .. c.op .. " (" .. tostring(c.type) .. "): " .. c.error
    end
    return nil, "Plan rejected, nothing was changed — " .. table.concat(msgs, "; ")
  end

  if params.snapshotBefore and params.snapshotBefore ~= "" then
    if not ctx.snapshot_save then return nil, "snapshotBefore is not supported by this bridge" end
    local _, err = ctx.snapshot_save(params.snapshotBefore)
    if err then return nil, "Pre-apply snapshot failed, nothing was changed — " .. err end
  end

  local label = params.label or ("MCP: run_plan (" .. #ops .. " ops)")
  local bound = {}
  local results = {}
  local failed_at, failure

  if api.PreventUIRefresh then api.PreventUIRefresh(1) end
  api.Undo_BeginBlock()
  for i, r in ipairs(resolved) do
    local ok, res = pcall(apply_op, api, r, bound)
    if not ok then
      failed_at, failure = i - 1, tostring(res)
      break
    end
    results[i] = { index = i - 1, op = r.op.op, result = res }
  end

  if failed_at then
    api.Undo_EndBlock(REVERT_LABEL, -1)
    -- Only undo our own block: if the failing op wrote nothing, no undo
    -- point exists and the top of the stack belongs to the user.
    if api.Undo_CanUndo2(0) == REVERT_LABEL then api.Undo_DoUndo2(0) end
    if api.PreventUIRefresh then api.PreventUIRefresh(-1) end
    return nil, "op " .. failed_at .. " (" .. tostring(ops[failed_at + 1].op) .. ") failed: "
      .. failure .. " — plan reverted, nothing was changed"
  end

  api.Undo_EndBlock(label, -1)
  if api.PreventUIRefresh then api.PreventUIRefresh(-1) end
  if api.TrackList_AdjustWindows then api.TrackList_AdjustWindows(false) end

  local data = { success = true, applied = #results, results = results }
  if key and key ~= "" then
    data.idempotencyKey = key
    remember(ctx, key, data)
  end
  return data
end

return M
