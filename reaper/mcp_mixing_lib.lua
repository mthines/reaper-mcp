-- Mixing depth for the MCP bridge: automation modes, FX parameter modulation (LFO, audio
-- control signal, parameter link), FX pin mappings, monitoring FX, freeze / render in place,
-- and stretch markers (batch add, quantize to the grid).
--
-- Pure Lua over an injected `api` (the `reaper` table in REAPER, a fake in the wasmoon
-- tests) and an injected track resolver (mcp_plan_lib.resolve_track). Every write checks
-- all of its input first, so a refused call changes nothing, and is one undo point.

local M = {}

M.MAX_TRACKS = 64
M.MAX_ITEMS = 64
M.MAX_STRETCH_MARKERS = 2000
M.MAX_MOD_SCAN = 1024
-- Monitoring FX live on the master track at this index offset
M.MONITOR = 0x1000000

-- REAPER's automation modes, by I_AUTOMODE value
M.AUTOMATION_MODES = { "trim", "read", "touch", "write", "latch", "latch_preview" }
-- Native action ids (fixed across REAPER versions; names checked live on REAPER 7.40)
M.FREEZE_ACTIONS = { stereo = 41223, mono = 40901, multichannel = 40877 }
M.UNFREEZE_ACTION = 41644
M.APPLY_FX_ACTIONS = { stereo = 40209, mono = 40361, multichannel = 41993 }
M.LFO_SHAPES = { "sine", "square", "saw_down", "saw_up", "triangle", "random" }

local function int(v)
  local n = tonumber(v)
  if not n then return nil end
  return math.floor(n + 0.5)
end

local function round(v, places)
  local m = 10 ^ (places or 3)
  return math.floor(v * m + 0.5) / m
end

local function index_of(list, v)
  for i, x in ipairs(list) do if x == v then return i end end
end

local function with_undo(api, label, flags, fn)
  api.Undo_BeginBlock()
  local ok, res, err = pcall(fn)
  if not ok then
    -- A write REAPER refused half way leaves no partial edit. The failed block gets its own label,
    -- so a failure that wrote nothing (no undo point) never undoes the user's last edit
    local revert = label .. " (failed — reverting)"
    api.Undo_EndBlock(revert, flags)
    local undone = api.Undo_CanUndo2 and api.Undo_CanUndo2(0) == revert
    if undone then api.Undo_DoUndo2(0) end
    error(tostring(res) .. (undone and " — the edit was undone" or ""), 0)
  end
  api.Undo_EndBlock(label, flags)
  return res, err
end

local function track_name(api, tr)
  if tr == api.GetMasterTrack(0) then return "MASTER" end
  local _, name = api.GetTrackName(tr)
  return name
end

local function track_index(api, tr)
  local n = int(api.GetMediaTrackInfo_Value(tr, "IP_TRACKNUMBER"))
  return (n == -1 or n == 0) and -1 or n - 1
end

-- A list of track refs (indexes, names, GUIDs, "master"), each resolved, no duplicates
local function resolve_tracks(api, resolve, refs, allow_master)
  if type(refs) ~= "table" or #refs == 0 then return nil, "tracks must be a non-empty list" end
  if #refs > M.MAX_TRACKS then return nil, "at most " .. M.MAX_TRACKS .. " tracks per call" end
  local out, seen = {}, {}
  for _, ref in ipairs(refs) do
    local res, err = resolve(api, ref, {})
    if not res or not res.track then return nil, err or ("track " .. tostring(ref) .. " not found") end
    if not allow_master and res.track == api.GetMasterTrack(0) then return nil, "the master track cannot be used here" end
    if not seen[res.track] then
      seen[res.track] = true
      out[#out + 1] = res.track
    end
  end
  return out
end

local function get_track(api, idx)
  idx = int(idx)
  if idx == -1 then return api.GetMasterTrack(0) end
  local tr = idx and api.GetTrack(0, idx)
  if not tr then return nil, "Track " .. tostring(idx) .. " not found" end
  return tr
end

local function get_fx(api, p)
  local tr, err = get_track(api, p.trackIndex)
  if not tr then return nil, err end
  local fx = int(p.fxIndex)
  local count = api.TrackFX_GetCount(tr)
  if not fx or fx < 0 or fx >= count then
    return nil, "FX index " .. tostring(p.fxIndex) .. " out of range (track has " .. count .. " FX)"
  end
  return tr, fx
end

-- -----------------------------------------------------------------------------
-- Automation mode
-- -----------------------------------------------------------------------------

local function mode_name(v)
  return M.AUTOMATION_MODES[(int(v) or 0) + 1] or "trim"
end

-- Global override: -1 none, 0..5 the modes, 6 bypass (all automation off)
local function override_name(v)
  v = int(v) or -1
  if v < 0 then return "none" end
  if v == 6 then return "bypass" end
  return mode_name(v)
end

function M.set_automation_mode(api, resolve, p)
  if p.mode == nil and p.globalOverride == nil then return nil, "Give mode (with tracks) and/or globalOverride" end
  local mode = p.mode and index_of(M.AUTOMATION_MODES, p.mode)
  if p.mode and not mode then
    return nil, "Unknown mode " .. tostring(p.mode) .. ". Use " .. table.concat(M.AUTOMATION_MODES, ", ")
  end
  local override
  if p.globalOverride ~= nil then
    if p.globalOverride == "none" then override = -1
    elseif p.globalOverride == "bypass" then override = 6
    else
      local i = index_of(M.AUTOMATION_MODES, p.globalOverride)
      if not i then return nil, "Unknown globalOverride " .. tostring(p.globalOverride) .. ". Use none, bypass or a mode" end
      override = i - 1
    end
  end
  local tracks = {}
  if mode then
    local err
    tracks, err = resolve_tracks(api, resolve, p.tracks, true)
    if not tracks then return nil, err end
  elseif p.tracks ~= nil then
    return nil, "tracks needs a mode"
  end

  return with_undo(api, "MCP: Set automation mode", 1, function()
    local rows = {}
    for _, tr in ipairs(tracks) do
      local before = mode_name(api.GetMediaTrackInfo_Value(tr, "I_AUTOMODE"))
      api.SetMediaTrackInfo_Value(tr, "I_AUTOMODE", mode - 1)
      rows[#rows + 1] = {
        trackIndex = track_index(api, tr), name = track_name(api, tr),
        before = before, mode = mode_name(api.GetMediaTrackInfo_Value(tr, "I_AUTOMODE")),
      }
    end
    local res = { tracks = rows }
    if override then
      res.globalOverrideBefore = override_name(api.GetGlobalAutomationOverride())
      api.SetGlobalAutomationOverride(override)
    end
    res.globalOverride = override_name(api.GetGlobalAutomationOverride())
    return res
  end)
end

-- -----------------------------------------------------------------------------
-- FX parameter modulation (REAPER 6.37+ named config: param.N.mod / lfo / acs / plink)
-- -----------------------------------------------------------------------------

local function cfg(api, tr, fx, key)
  local ok, v = api.TrackFX_GetNamedConfigParm(tr, fx, key)
  if not ok then return nil end
  return v
end

local function cfg_num(api, tr, fx, key)
  return tonumber(cfg(api, tr, fx, key))
end

local function cfg_on(api, tr, fx, key)
  return cfg_num(api, tr, fx, key) == 1
end

-- One parameter's modulation, or nil when the parameter has none
local function read_modulation(api, tr, fx, param)
  local k = "param." .. param .. "."
  if not cfg_on(api, tr, fx, k .. "mod.active") then return nil end
  local _, pname = api.TrackFX_GetParamName(tr, fx, param)
  local m = {
    paramIndex = param, name = pname,
    baseline = round(cfg_num(api, tr, fx, k .. "mod.baseline") or 0, 4),
    value = round(api.TrackFX_GetParamNormalized(tr, fx, param), 4),
  }
  if cfg_on(api, tr, fx, k .. "lfo.active") then
    m.lfo = {
      shape = M.LFO_SHAPES[(cfg_num(api, tr, fx, k .. "lfo.shape") or 0) + 1] or "sine",
      speed = round(cfg_num(api, tr, fx, k .. "lfo.speed") or 0, 4),
      strength = round(cfg_num(api, tr, fx, k .. "lfo.strength") or 0, 4),
      phase = round(cfg_num(api, tr, fx, k .. "lfo.phase") or 0, 4),
      tempoSync = cfg_on(api, tr, fx, k .. "lfo.temposync"),
      direction = int(cfg_num(api, tr, fx, k .. "lfo.dir") or 1),
    }
  end
  if cfg_on(api, tr, fx, k .. "acs.active") then
    m.audio = {
      attackMs = round(cfg_num(api, tr, fx, k .. "acs.attack") or 0, 2),
      releaseMs = round(cfg_num(api, tr, fx, k .. "acs.release") or 0, 2),
      minDb = round(cfg_num(api, tr, fx, k .. "acs.dblo") or 0, 2),
      maxDb = round(cfg_num(api, tr, fx, k .. "acs.dbhi") or 0, 2),
      strength = round(cfg_num(api, tr, fx, k .. "acs.strength") or 0, 4),
      channel = int(cfg_num(api, tr, fx, k .. "acs.chan") or 0) + 1,
      direction = int(cfg_num(api, tr, fx, k .. "acs.dir") or 1),
    }
  end
  if cfg_on(api, tr, fx, k .. "plink.active") then
    local src_fx, src_param = int(cfg_num(api, tr, fx, k .. "plink.effect")), int(cfg_num(api, tr, fx, k .. "plink.param"))
    local link = {
      fxIndex = src_fx, paramIndex = src_param,
      scale = round(cfg_num(api, tr, fx, k .. "plink.scale") or 1, 4),
      offset = round(cfg_num(api, tr, fx, k .. "plink.offset") or 0, 4),
    }
    if src_fx and src_fx >= 0 and src_fx < api.TrackFX_GetCount(tr) then
      local _, fname = api.TrackFX_GetFXName(tr, src_fx)
      local _, sname = api.TrackFX_GetParamName(tr, src_fx, src_param or 0)
      link.fxName, link.paramName = fname, sname
    end
    m.link = link
  end
  return m
end

function M.get_modulation(api, p)
  local tr, fx = get_fx(api, p)
  if not tr then return nil, fx end
  local n = api.TrackFX_GetNumParams(tr, fx)
  local _, fx_name = api.TrackFX_GetFXName(tr, fx)
  local res = { trackIndex = int(p.trackIndex), fxIndex = fx, fxName = fx_name, paramCount = n }
  if p.paramIndex ~= nil then
    local param = int(p.paramIndex)
    if not param or param < 0 or param >= n then
      return nil, "Parameter index " .. tostring(p.paramIndex) .. " out of range (FX has " .. n .. " parameters)"
    end
    res.modulated = { read_modulation(api, tr, fx, param) }
    return res
  end
  local list = {}
  for i = 0, math.min(n, M.MAX_MOD_SCAN) - 1 do
    list[#list + 1] = read_modulation(api, tr, fx, i)
  end
  res.modulated = list
  if n > M.MAX_MOD_SCAN then res.scanned = M.MAX_MOD_SCAN end
  return res
end

local function check_range(v, lo, hi, what)
  if v == nil then return true end
  local n = tonumber(v)
  if not n or n < lo or n > hi then return false, what .. " must be " .. lo .. ".." .. hi end
  return true
end

-- The named-config writes a modulation spec turns into, after checking all of it
local function modulation_writes(api, tr, fx, param, spec)
  local k = "param." .. param .. "."
  local w = {}
  local function add(key, v) w[#w + 1] = { k .. key, tostring(v) } end
  if spec.enabled == false then
    add("mod.active", 0)
    return w
  end
  local ok, err = check_range(spec.baseline, 0, 1, "baseline")
  if not ok then return nil, err end
  add("mod.active", 1)
  if spec.baseline ~= nil then add("mod.baseline", tonumber(spec.baseline)) end

  local lfo = spec.lfo
  if type(lfo) == "table" then
    if lfo.enabled == false then add("lfo.active", 0) else
      local shape = lfo.shape and index_of(M.LFO_SHAPES, lfo.shape)
      if lfo.shape and not shape then return nil, "Unknown LFO shape " .. tostring(lfo.shape) .. ". Use " .. table.concat(M.LFO_SHAPES, ", ") end
      for _, c in ipairs({ { lfo.strength, 0, 1, "lfo.strength" }, { lfo.phase, 0, 1, "lfo.phase" }, { lfo.speed, 0.0001, 64, "lfo.speed" } }) do
        ok, err = check_range(c[1], c[2], c[3], c[4])
        if not ok then return nil, err end
      end
      if lfo.direction ~= nil and not index_of({ -1, 0, 1 }, int(lfo.direction)) then return nil, "lfo.direction must be -1, 0 or 1" end
      add("lfo.active", 1)
      if shape then add("lfo.shape", shape - 1) end
      if lfo.tempoSync ~= nil then add("lfo.temposync", lfo.tempoSync and 1 or 0) end
      if lfo.speed ~= nil then add("lfo.speed", tonumber(lfo.speed)) end
      if lfo.strength ~= nil then add("lfo.strength", tonumber(lfo.strength)) end
      if lfo.phase ~= nil then add("lfo.phase", tonumber(lfo.phase)) end
      if lfo.direction ~= nil then add("lfo.dir", int(lfo.direction)) end
    end
  end

  local acs = spec.audio
  if type(acs) == "table" then
    if acs.enabled == false then add("acs.active", 0) else
      for _, c in ipairs({ { acs.attackMs, 0, 1000, "audio.attackMs" }, { acs.releaseMs, 0, 1000, "audio.releaseMs" },
                           { acs.minDb, -60, 12, "audio.minDb" }, { acs.maxDb, -60, 12, "audio.maxDb" },
                           { acs.strength, 0, 1, "audio.strength" }, { acs.channel, 1, 64, "audio.channel" } }) do
        ok, err = check_range(c[1], c[2], c[3], c[4])
        if not ok then return nil, err end
      end
      if acs.minDb and acs.maxDb and tonumber(acs.minDb) >= tonumber(acs.maxDb) then return nil, "audio.minDb must be below audio.maxDb" end
      if acs.channel and int(acs.channel) > int(api.GetMediaTrackInfo_Value(tr, "I_NCHAN")) then
        return nil, "audio.channel " .. int(acs.channel) .. " is above the track's " .. int(api.GetMediaTrackInfo_Value(tr, "I_NCHAN")) .. " channels"
      end
      if acs.direction ~= nil and not index_of({ -1, 0, 1 }, int(acs.direction)) then return nil, "audio.direction must be -1, 0 or 1" end
      add("acs.active", 1)
      if acs.attackMs ~= nil then add("acs.attack", tonumber(acs.attackMs)) end
      if acs.releaseMs ~= nil then add("acs.release", tonumber(acs.releaseMs)) end
      if acs.minDb ~= nil then add("acs.dblo", tonumber(acs.minDb)) end
      if acs.maxDb ~= nil then add("acs.dbhi", tonumber(acs.maxDb)) end
      if acs.strength ~= nil then add("acs.strength", tonumber(acs.strength)) end
      if acs.channel ~= nil then add("acs.chan", int(acs.channel) - 1) end
      if acs.direction ~= nil then add("acs.dir", int(acs.direction)) end
    end
  end

  local link = spec.link
  if type(link) == "table" then
    if link.enabled == false then add("plink.active", 0) else
      local src_fx, src_param = int(link.fxIndex), int(link.paramIndex)
      local count = api.TrackFX_GetCount(tr)
      if not src_fx or src_fx < 0 or src_fx >= count then return nil, "link.fxIndex " .. tostring(link.fxIndex) .. " out of range (track has " .. count .. " FX)" end
      local n = api.TrackFX_GetNumParams(tr, src_fx)
      if not src_param or src_param < 0 or src_param >= n then return nil, "link.paramIndex " .. tostring(link.paramIndex) .. " out of range (source FX has " .. n .. " parameters)" end
      if src_fx == fx and src_param == param then return nil, "a parameter cannot be linked to itself" end
      ok, err = check_range(link.scale, -10, 10, "link.scale")
      if not ok then return nil, err end
      ok, err = check_range(link.offset, -1, 1, "link.offset")
      if not ok then return nil, err end
      add("plink.active", 1)
      add("plink.effect", src_fx)
      add("plink.param", src_param)
      if link.scale ~= nil then add("plink.scale", tonumber(link.scale)) end
      if link.offset ~= nil then add("plink.offset", tonumber(link.offset)) end
    end
  end
  return w
end

function M.set_modulation(api, p, spec)
  local tr, fx = get_fx(api, p)
  if not tr then return nil, fx end
  if type(spec) ~= "table" then return nil, "No modulation given: pass enabled, baseline, lfo, audio and/or link" end
  local n = api.TrackFX_GetNumParams(tr, fx)
  local param = int(p.paramIndex)
  if not param or param < 0 or param >= n then
    return nil, "Parameter index " .. tostring(p.paramIndex) .. " out of range (FX has " .. n .. " parameters)"
  end
  local writes, err = modulation_writes(api, tr, fx, param, spec)
  if not writes then return nil, err .. " — nothing changed" end
  local before = read_modulation(api, tr, fx, param)
  return with_undo(api, "MCP: Set FX parameter modulation", -1, function()
    for _, w in ipairs(writes) do
      if not api.TrackFX_SetNamedConfigParm(tr, fx, w[1], w[2]) then
        error("REAPER refused " .. w[1] .. " = " .. w[2] .. " (needs REAPER 6.37+)", 0)
      end
    end
    local _, fx_name = api.TrackFX_GetFXName(tr, fx)
    return {
      trackIndex = int(p.trackIndex), fxIndex = fx, fxName = fx_name, paramIndex = param,
      modulation = read_modulation(api, tr, fx, param) or { paramIndex = param, enabled = false },
      before = before,
    }
  end)
end

-- -----------------------------------------------------------------------------
-- FX pin mappings
-- -----------------------------------------------------------------------------

-- The channels (1-based) a pin is connected to, from its two 32-bit masks
local function channels_of(lo, hi)
  local out = {}
  for b = 0, 31 do if (int(lo) or 0) & (1 << b) ~= 0 then out[#out + 1] = b + 1 end end
  for b = 0, 31 do if (int(hi) or 0) & (1 << b) ~= 0 then out[#out + 1] = b + 33 end end
  return out
end

local function masks_of(chans)
  local lo, hi = 0, 0
  for _, c in ipairs(chans) do
    if c <= 32 then lo = lo | (1 << (c - 1)) else hi = hi | (1 << (c - 33)) end
  end
  return lo, hi
end

local function read_pins(api, tr, fx)
  local _, ins, outs = api.TrackFX_GetIOSize(tr, fx)
  ins, outs = math.max(int(ins) or 0, 0), math.max(int(outs) or 0, 0)
  local function side(is_out, count)
    local list = {}
    for pin = 0, count - 1 do
      local lo, hi = api.TrackFX_GetPinMappings(tr, fx, is_out and 1 or 0, pin)
      local ok, name = false, nil
      if api.TrackFX_GetNamedConfigParm then
        ok, name = api.TrackFX_GetNamedConfigParm(tr, fx, (is_out and "out_pin_" or "in_pin_") .. pin)
      end
      list[#list + 1] = { pin = pin, name = ok and name ~= "" and name or nil, channels = channels_of(lo, hi) }
    end
    return list
  end
  local _, fx_name = api.TrackFX_GetFXName(tr, fx)
  return {
    fxName = fx_name, trackChannels = int(api.GetMediaTrackInfo_Value(tr, "I_NCHAN")),
    inputs = side(false, ins), outputs = side(true, outs),
  }
end

function M.get_pins(api, p)
  local tr, fx = get_fx(api, p)
  if not tr then return nil, fx end
  local res = read_pins(api, tr, fx)
  res.trackIndex, res.fxIndex = int(p.trackIndex), fx
  return res
end

-- Checks a side's mapping: a list of channel lists by pin, or { pin = n, channels = {...} } objects
local function pin_writes(side, mapping, count, writes)
  if mapping == nil then return 0 end
  if type(mapping) ~= "table" then return nil, side .. " must be a list" end
  local highest = 0
  for i, m in ipairs(mapping) do
    local pin, chans
    if type(m) == "table" and m.channels ~= nil then pin, chans = int(m.pin), m.channels
    else pin, chans = i - 1, m end
    if not pin or pin < 0 or pin >= count then
      return nil, side .. " pin " .. tostring(pin) .. " out of range (the FX has " .. count .. " " .. side .. " pins)"
    end
    if type(chans) ~= "table" then return nil, side .. " pin " .. pin .. ": channels must be a list" end
    local list = {}
    for _, c in ipairs(chans) do
      local ch = int(c)
      if not ch or ch < 1 or ch > 64 then return nil, side .. " pin " .. pin .. ": channel " .. tostring(c) .. " must be 1..64" end
      list[#list + 1] = ch
      if ch > highest then highest = ch end
    end
    writes[#writes + 1] = { side == "outputs" and 1 or 0, pin, list }
  end
  return highest
end

function M.set_pins(api, p, inputs, outputs)
  local tr, fx = get_fx(api, p)
  if not tr then return nil, fx end
  if inputs == nil and outputs == nil and p.trackChannels == nil then return nil, "Give inputs, outputs and/or trackChannels" end
  local _, ins, outs = api.TrackFX_GetIOSize(tr, fx)
  local writes = {}
  local hi_in, err = pin_writes("inputs", inputs, int(ins) or 0, writes)
  if not hi_in then return nil, err .. " — nothing changed" end
  local hi_out
  hi_out, err = pin_writes("outputs", outputs, int(outs) or 0, writes)
  if not hi_out then return nil, err .. " — nothing changed" end
  local nchan = int(api.GetMediaTrackInfo_Value(tr, "I_NCHAN"))
  local want = int(p.trackChannels)
  if p.trackChannels ~= nil and (not want or want < 2 or want > 128 or want % 2 ~= 0) then
    return nil, "trackChannels must be an even number 2..128 — nothing changed"
  end
  -- A pin can only use channels the track has: widen the track to the highest one used
  local needed = math.max(hi_in, hi_out)
  needed = needed + needed % 2
  if want and want < needed then
    return nil, "trackChannels " .. want .. " is below channel " .. math.max(hi_in, hi_out) .. " used by a pin — nothing changed"
  end
  local target = want or (needed > nchan and needed or nil)

  local before = read_pins(api, tr, fx)
  return with_undo(api, "MCP: Set FX pins", -1, function()
    if target and target ~= nchan then api.SetMediaTrackInfo_Value(tr, "I_NCHAN", target) end
    for _, w in ipairs(writes) do
      local lo, hi = masks_of(w[3])
      if not api.TrackFX_SetPinMappings(tr, fx, w[1], w[2], lo, hi) then
        error("REAPER refused the mapping of " .. (w[1] == 1 and "output" or "input") .. " pin " .. w[2], 0)
      end
    end
    local res = read_pins(api, tr, fx)
    res.trackIndex, res.fxIndex = int(p.trackIndex), fx
    res.before = before
    if target and target ~= nchan then res.trackChannelsBefore = nchan end
    return res
  end)
end

-- -----------------------------------------------------------------------------
-- Monitoring FX (master track, index + 0x1000000; global to REAPER, not saved in the project)
-- -----------------------------------------------------------------------------

local function monitor_chain(api)
  local m = api.GetMasterTrack(0)
  local list = {}
  for i = 0, api.TrackFX_GetRecCount(m) - 1 do
    local idx = M.MONITOR + i
    local _, name = api.TrackFX_GetFXName(m, idx)
    list[#list + 1] = {
      index = i, name = name, enabled = api.TrackFX_GetEnabled(m, idx),
      offline = api.TrackFX_GetOffline and api.TrackFX_GetOffline(m, idx) or false,
    }
  end
  return list
end

function M.list_monitoring_fx(api)
  local fx = monitor_chain(api)
  return { fx = fx, count = #fx }
end

local function monitor_index(api, v)
  local i = int(v)
  local count = api.TrackFX_GetRecCount(api.GetMasterTrack(0))
  if not i or i < 0 or i >= count then return nil, "Monitoring FX index " .. tostring(v) .. " out of range (" .. count .. " monitoring FX)" end
  return i
end

-- Normalized parameter writes [{paramIndex, value}] checked against an FX
local function param_writes(api, tr, idx, params)
  if params == nil then return {} end
  if type(params) ~= "table" then return nil, "params must be a list of {paramIndex, value}" end
  local n = api.TrackFX_GetNumParams(tr, idx)
  local out = {}
  for _, prm in ipairs(params) do
    local pi, v = int(prm.paramIndex), tonumber(prm.value)
    if not pi or pi < 0 or pi >= n then return nil, "paramIndex " .. tostring(prm.paramIndex) .. " out of range (FX has " .. n .. " parameters)" end
    if not v or v < 0 or v > 1 then return nil, "value for parameter " .. pi .. " must be 0..1 (normalized)" end
    out[#out + 1] = { pi, v }
  end
  return out
end

function M.add_monitoring_fx(api, p, params)
  if type(p.fxName) ~= "string" or p.fxName == "" then return nil, "fxName is required" end
  local m = api.GetMasterTrack(0)
  local before = monitor_chain(api)
  return with_undo(api, "MCP: Add monitoring FX", -1, function()
    local i = api.TrackFX_AddByName(m, p.fxName, true, -1)
    if i < 0 then return nil, "FX not found: " .. p.fxName end
    i = i >= M.MONITOR and i - M.MONITOR or i
    local idx = M.MONITOR + i
    local writes, err = param_writes(api, m, idx, params)
    if not writes then
      api.TrackFX_Delete(m, idx)
      return nil, err .. " — nothing changed"
    end
    for _, w in ipairs(writes) do api.TrackFX_SetParamNormalized(m, idx, w[1], w[2]) end
    local _, name = api.TrackFX_GetFXName(m, idx)
    return { fxIndex = i, name = name, fx = monitor_chain(api), before = before }
  end)
end

function M.set_monitoring_fx(api, p, params)
  local i, err = monitor_index(api, p.fxIndex)
  if not i then return nil, err end
  local m = api.GetMasterTrack(0)
  local idx = M.MONITOR + i
  local writes
  writes, err = param_writes(api, m, idx, params)
  if not writes then return nil, err .. " — nothing changed" end
  if p.enabled == nil and p.offline == nil and #writes == 0 then return nil, "Give enabled, offline and/or params" end
  local before = monitor_chain(api)
  return with_undo(api, "MCP: Set monitoring FX", -1, function()
    if p.enabled ~= nil then api.TrackFX_SetEnabled(m, idx, p.enabled and true or false) end
    if p.offline ~= nil and api.TrackFX_SetOffline then api.TrackFX_SetOffline(m, idx, p.offline and true or false) end
    for _, w in ipairs(writes) do api.TrackFX_SetParamNormalized(m, idx, w[1], w[2]) end
    local values = {}
    for _, w in ipairs(writes) do
      local _, text = api.TrackFX_GetFormattedParamValue(m, idx, w[1])
      values[#values + 1] = { paramIndex = w[1], value = round(api.TrackFX_GetParamNormalized(m, idx, w[1]), 4), formatted = text }
    end
    return { fxIndex = i, fx = monitor_chain(api), params = values, before = before }
  end)
end

function M.remove_monitoring_fx(api, p)
  local i, err = monitor_index(api, p.fxIndex)
  if not i then return nil, err end
  local m = api.GetMasterTrack(0)
  local before = monitor_chain(api)
  return with_undo(api, "MCP: Remove monitoring FX", -1, function()
    local removed = before[i + 1].name
    api.TrackFX_Delete(m, M.MONITOR + i)
    return { removed = removed, fx = monitor_chain(api), before = before }
  end)
end

-- -----------------------------------------------------------------------------
-- Freeze and render in place (native actions on a selection that is put back afterwards)
-- -----------------------------------------------------------------------------

-- How many freezes are stacked on a track (each freeze adds a <FREEZE block)
local function freeze_depth(api, tr)
  local ok, chunk = api.GetTrackStateChunk(tr, "", false)
  if not ok or type(chunk) ~= "string" then return 0 end
  local n = 0
  for _ in chunk:gmatch("\n%s*<FREEZE") do n = n + 1 end
  if chunk:sub(1, 7) == "<FREEZE" then n = n + 1 end
  return n
end

local function track_state(api, tr)
  return {
    trackIndex = track_index(api, tr), name = track_name(api, tr),
    frozen = freeze_depth(api, tr), items = api.CountTrackMediaItems(tr), fx = api.TrackFX_GetCount(tr),
  }
end

local function save_track_selection(api)
  local sel = {}
  for i = 0, api.CountTracks(0) - 1 do
    local tr = api.GetTrack(0, i)
    sel[#sel + 1] = { tr, api.IsTrackSelected(tr) }
  end
  return sel
end

local function run_on_tracks(api, tracks, action)
  local sel = save_track_selection(api)
  for _, s in ipairs(sel) do api.SetTrackSelected(s[1], false) end
  for _, tr in ipairs(tracks) do api.SetTrackSelected(tr, true) end
  api.Main_OnCommand(action, 0)
  for _, s in ipairs(sel) do api.SetTrackSelected(s[1], s[2]) end
end

function M.freeze_tracks(api, resolve, p)
  local mode = p.mode or "stereo"
  local action = M.FREEZE_ACTIONS[mode]
  if not action then return nil, "Unknown mode " .. tostring(mode) .. ". Use stereo, mono or multichannel" end
  local tracks, err = resolve_tracks(api, resolve, p.tracks, false)
  if not tracks then return nil, err end
  local before = {}
  for i, tr in ipairs(tracks) do before[i] = track_state(api, tr) end
  return with_undo(api, "MCP: Freeze tracks (" .. mode .. ")", -1, function()
    run_on_tracks(api, tracks, action)
    local rows = {}
    for i, tr in ipairs(tracks) do
      rows[i] = track_state(api, tr)
      rows[i].before = before[i]
    end
    return { mode = mode, tracks = rows }
  end)
end

function M.unfreeze_tracks(api, resolve, p)
  local tracks, err = resolve_tracks(api, resolve, p.tracks, false)
  if not tracks then return nil, err end
  local before, idle = {}, {}
  for i, tr in ipairs(tracks) do
    before[i] = track_state(api, tr)
    if before[i].frozen == 0 then idle[#idle + 1] = before[i].name end
  end
  if #idle > 0 then return nil, "Not frozen: " .. table.concat(idle, ", ") .. " — nothing changed" end
  return with_undo(api, "MCP: Unfreeze tracks", -1, function()
    run_on_tracks(api, tracks, M.UNFREEZE_ACTION)
    local rows = {}
    for i, tr in ipairs(tracks) do
      rows[i] = track_state(api, tr)
      rows[i].before = before[i]
    end
    return { tracks = rows }
  end)
end

local function item_state(api, it, ref)
  local take = api.GetActiveTake(it)
  local tname = ""
  if take then tname = select(2, api.GetSetMediaItemTakeInfo_String(take, "P_NAME", "", false)) end
  return { trackIndex = ref.trackIndex, itemIndex = ref.itemIndex, takes = api.CountTakes(it), activeTake = tname }
end

function M.apply_fx_to_items(api, p, items)
  local mode = p.mode or "stereo"
  local action = M.APPLY_FX_ACTIONS[mode]
  if not action then return nil, "Unknown mode " .. tostring(mode) .. ". Use stereo, mono or multichannel" end
  if type(items) ~= "table" or #items == 0 then return nil, "items must be a non-empty list of {trackIndex, itemIndex}" end
  if #items > M.MAX_ITEMS then return nil, "at most " .. M.MAX_ITEMS .. " items per call" end
  local targets = {}
  for _, ref in ipairs(items) do
    local tr = api.GetTrack(0, int(ref.trackIndex) or -2)
    if not tr then return nil, "Track " .. tostring(ref.trackIndex) .. " not found — nothing changed" end
    local it = api.GetTrackMediaItem(tr, int(ref.itemIndex) or -1)
    if not it then return nil, "Item " .. tostring(ref.itemIndex) .. " not found on track " .. tostring(ref.trackIndex) .. " — nothing changed" end
    targets[#targets + 1] = { it = it, ref = { trackIndex = int(ref.trackIndex), itemIndex = int(ref.itemIndex) } }
  end
  local before = {}
  for i, t in ipairs(targets) do before[i] = item_state(api, t.it, t.ref) end
  return with_undo(api, "MCP: Apply FX to items (" .. mode .. ")", -1, function()
    local sel = {}
    for i = 0, api.CountMediaItems(0) - 1 do
      local it = api.GetMediaItem(0, i)
      sel[#sel + 1] = { it, api.IsMediaItemSelected(it) }
    end
    for _, s in ipairs(sel) do api.SetMediaItemSelected(s[1], false) end
    for _, t in ipairs(targets) do api.SetMediaItemSelected(t.it, true) end
    api.Main_OnCommand(action, 0)
    for _, s in ipairs(sel) do api.SetMediaItemSelected(s[1], s[2]) end
    api.UpdateArrange()
    local rows = {}
    for i, t in ipairs(targets) do
      rows[i] = item_state(api, t.it, t.ref)
      rows[i].before = before[i]
    end
    return { mode = mode, items = rows }
  end)
end

-- -----------------------------------------------------------------------------
-- Stretch markers
-- -----------------------------------------------------------------------------

local function audio_take(api, p)
  local tr = api.GetTrack(0, int(p.trackIndex) or -2)
  if not tr then return nil, "Track " .. tostring(p.trackIndex) .. " not found" end
  local it = api.GetTrackMediaItem(tr, int(p.itemIndex) or -1)
  if not it then return nil, "Item " .. tostring(p.itemIndex) .. " not found on track " .. tostring(p.trackIndex) end
  local take = api.GetActiveTake(it)
  if not take then return nil, "The item has no take" end
  if api.TakeIsMIDI(take) then return nil, "Stretch markers need an audio item; this one is MIDI" end
  return { track = tr, item = it, take = take,
           pos = api.GetMediaItemInfo_Value(it, "D_POSITION"), len = api.GetMediaItemInfo_Value(it, "D_LENGTH"),
           offs = api.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS"), rate = api.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE") }
end

-- A stretch marker's pos is take time at play rate 1 (seen live, REAPER 7.40: a marker added
-- at pos 0.4 on a 2x item with offset 0.5 reads source 0.9). The tools speak item seconds,
-- so positions are item seconds x play rate on the way in and / play rate on the way out.
local function read_markers(api, t)
  local out = {}
  for i = 0, api.GetTakeNumStretchMarkers(t.take) - 1 do
    local _, pos, src = api.GetTakeStretchMarker(t.take, i)
    out[#out + 1] = { position = round(pos / t.rate, 4), sourcePosition = round(src, 4) }
  end
  return out
end

function M.add_stretch_markers(api, p, markers)
  local t, err = audio_take(api, p)
  if not t then return nil, err end
  if type(markers) ~= "table" or #markers == 0 then return nil, "markers must be a non-empty list of {position, sourcePosition?}" end
  local have = api.GetTakeNumStretchMarkers(t.take)
  if have + #markers > M.MAX_STRETCH_MARKERS then
    return nil, "at most " .. M.MAX_STRETCH_MARKERS .. " stretch markers per item (it has " .. have .. ")"
  end
  for i, m in ipairs(markers) do
    local pos = tonumber(m.position)
    if not pos or pos < 0 or pos > t.len then
      return nil, "marker " .. i .. ": position " .. tostring(m.position) .. " must be 0.." .. round(t.len, 3) .. " (seconds from the item start) — nothing changed"
    end
    if m.sourcePosition ~= nil and not tonumber(m.sourcePosition) then
      return nil, "marker " .. i .. ": sourcePosition must be a number — nothing changed"
    end
  end
  local before = read_markers(api, t)
  return with_undo(api, "MCP: Add stretch markers", 4, function()
    for _, m in ipairs(markers) do
      local pos = tonumber(m.position) * t.rate
      if m.sourcePosition ~= nil then api.SetTakeStretchMarker(t.take, -1, pos, tonumber(m.sourcePosition))
      else api.SetTakeStretchMarker(t.take, -1, pos) end
    end
    api.UpdateItemInProject(t.item)
    return { trackIndex = int(p.trackIndex), itemIndex = int(p.itemIndex), length = round(t.len, 4),
             added = #markers, markers = read_markers(api, t), before = before }
  end)
end

-- Grid line nearest a project time (grid in quarter notes, swing like quantize_midi)
local function nearest_line(api, time, grid, swing)
  local qn = api.TimeMap2_timeToQN(0, time)
  local pair = grid * 2
  local base = math.floor(qn / pair) * pair
  local best, best_d
  for k = -1, 1 do
    local b = base + k * pair
    for _, line in ipairs({ b, b + grid * (1 + swing) }) do
      local d = math.abs(line - qn)
      if not best_d or d < best_d then best, best_d = line, d end
    end
  end
  return api.TimeMap2_QNToTime(0, best), best_d
end

-- Places one stretch marker per hit and moves it toward the nearest grid line. `hits` are
-- source-time seconds (as read from the item's source file); existing markers are replaced.
function M.quantize_stretch(api, p, hits)
  local t, err = audio_take(api, p)
  if not t then return nil, err end
  local grid = tonumber(p.grid)
  if not grid or grid <= 0 or grid > 16 then return nil, "grid must be > 0 and <= 16 quarter notes" end
  local strength = tonumber(p.strength or 1)
  if not strength or strength < 0 or strength > 1 then return nil, "strength must be 0..1" end
  local swing = tonumber(p.swing or 0)
  if not swing or swing < 0 or swing > 0.9 then return nil, "swing must be 0..0.9" end
  local window = tonumber(p.window or 1)
  if not window or window <= 0 or window > 1 then return nil, "window must be > 0 and <= 1" end
  if type(hits) ~= "table" then return nil, "hits must be a list of source times" end
  if #hits > M.MAX_STRETCH_MARKERS then return nil, "at most " .. M.MAX_STRETCH_MARKERS .. " hits per item" end
  -- Hits inside the item, as item-relative positions, in order
  local edge = 0.005
  local list = {}
  for _, s in ipairs(hits) do
    local src = tonumber(s)
    if src then
      local pos = (src - t.offs) / t.rate
      if pos > edge and pos < t.len - edge then list[#list + 1] = { src = src, pos = pos } end
    end
  end
  table.sort(list, function(a, b) return a.pos < b.pos end)
  -- No hit to place: replacing the markers would only wipe the ones the item has
  if #list == 0 then return nil, "No hits inside the item — nothing changed" end

  local before = read_markers(api, t)
  -- With swing the lines are up to (1 + swing) steps apart, so window 1 still reaches every hit (as quantize_midi)
  local reach = window * (1 + swing) * grid / 2
  local placed, last_pos, last_line = {}, edge, nil
  local moved, skipped, err_before, err_after = 0, 0, {}, {}
  for _, h in ipairs(list) do
    local time = t.pos + h.pos
    local line_time, dist = nearest_line(api, time, grid, swing)
    local new_pos = h.pos
    if dist <= reach + 1e-9 then
      new_pos = h.pos + (line_time - time) * strength
    end
    -- Two hits on one grid line, or a move that would cross the previous marker, would fold time
    if (last_line and math.abs(line_time - last_line) < 1e-9 and dist <= reach) or new_pos <= last_pos + 0.001 or new_pos >= t.len - edge then
      skipped = skipped + 1
    else
      placed[#placed + 1] = { pos = new_pos, src = h.src, from = h.pos }
      if math.abs(new_pos - h.pos) > 1e-6 then moved = moved + 1 end
      err_before[#err_before + 1] = math.abs(line_time - time)
      err_after[#err_after + 1] = math.abs(line_time - (t.pos + new_pos))
      last_pos = new_pos
      if dist <= reach then last_line = line_time end
    end
  end
  if #placed == 0 then return nil, "No hit could be placed (each would fold time or reach an item edge) — nothing changed" end

  local function stats(list_ms)
    if #list_ms == 0 then return { avgMs = 0, maxMs = 0 } end
    local sum, mx = 0, 0
    for _, v in ipairs(list_ms) do sum = sum + v; if v > mx then mx = v end end
    return { avgMs = round(sum / #list_ms * 1000, 1), maxMs = round(mx * 1000, 1) }
  end

  return with_undo(api, "MCP: Quantize audio", 4, function()
    for i = api.GetTakeNumStretchMarkers(t.take) - 1, 0, -1 do api.DeleteTakeStretchMarkers(t.take, i) end
    -- Anchors at both ends keep the item's length and the audio outside the hits in place
    api.SetTakeStretchMarker(t.take, -1, 0, t.offs)
    for _, m in ipairs(placed) do api.SetTakeStretchMarker(t.take, -1, m.pos * t.rate, m.src) end
    api.SetTakeStretchMarker(t.take, -1, t.len * t.rate, t.offs + t.len * t.rate)
    api.UpdateItemInProject(t.item)
    local hits_out = {}
    for i = 1, math.min(#placed, 256) do hits_out[i] = { round(placed[i].from, 4), round(placed[i].pos, 4) } end
    return {
      trackIndex = int(p.trackIndex), itemIndex = int(p.itemIndex), position = round(t.pos, 4), length = round(t.len, 4),
      grid = grid, strength = strength, hits = #list, placed = #placed, moved = moved, skipped = skipped,
      replacedMarkers = #before, offsetBefore = stats(err_before), offsetAfter = stats(err_after),
      moves = hits_out, more = math.max(0, #placed - 256),
    }
  end)
end

return M
