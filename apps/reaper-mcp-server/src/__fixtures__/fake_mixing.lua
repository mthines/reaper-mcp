-- Fake ReaScript API for reaper/mcp_mixing_lib.lua (wasmoon tests): tracks with FX
-- (parameters, named config, pins), items with takes and stretch markers, monitoring FX
-- on the master, freeze/apply-FX actions, and a 120 BPM tempo map (1 QN = 0.5 s).
-- `api.writes` counts every state change; `api.undo` lists the undo points made.

function new_fake(spec)
  local api = { writes = 0, undo = {}, override = -1, depth = 0, actions = {} }
  local function w() api.writes = api.writes + 1 end

  local function new_fx(f)
    local fx = { name = f.name or "ReaEQ", params = {}, cfg = {}, enabled = true, offline = false,
                 ins = f.ins or 2, outs = f.outs or 2, pins = { [0] = {}, [1] = {} } }
    for i = 1, (f.params or 4) do fx.params[i] = { name = "P" .. (i - 1), v = 0.5 } end
    for pin = 0, fx.ins - 1 do fx.pins[0][pin] = { 1 << pin, 0 } end
    for pin = 0, fx.outs - 1 do fx.pins[1][pin] = { 1 << pin, 0 } end
    return fx
  end

  api.tracks = {}
  for i, t in ipairs(spec.tracks or {}) do
    local tr = { name = t.name or ("Track " .. i), nchan = t.nchan or 2, automode = t.automode or 0,
                 fx = {}, items = {}, selected = t.selected or false, freezes = t.frozen or 0 }
    for _, f in ipairs(t.fx or {}) do tr.fx[#tr.fx + 1] = new_fx(f) end
    for _, it in ipairs(t.items or {}) do
      tr.items[#tr.items + 1] = { pos = it.pos or 0, len = it.len or 4, selected = it.selected or false,
        takes = { { name = it.name or "take", midi = it.midi or false, offs = it.offs or 0, rate = it.rate or 1, sm = {} } }, active = 1 }
    end
    api.tracks[i] = tr
  end
  api.master = { name = "MASTER", nchan = 2, automode = 0, fx = {}, items = {}, selected = false, freezes = 0, mon = {} }
  api.installed = spec.installed or { ReaEQ = true, ReaComp = true, ReaLimit = true }

  local function idx_of(tr)
    for i, t in ipairs(api.tracks) do if t == tr then return i end end
  end

  function api.GetTrack(_, i) return api.tracks[(i or -1) + 1] end
  function api.GetMasterTrack() return api.master end
  function api.CountTracks() return #api.tracks end
  function api.GetTrackName(tr) return true, tr.name end
  function api.GetMediaTrackInfo_Value(tr, k)
    if k == "IP_TRACKNUMBER" then return tr == api.master and -1 or idx_of(tr) end
    if k == "I_NCHAN" then return tr.nchan end
    if k == "I_AUTOMODE" then return tr.automode end
    return 0
  end
  function api.SetMediaTrackInfo_Value(tr, k, v)
    w()
    if k == "I_NCHAN" then tr.nchan = v elseif k == "I_AUTOMODE" then tr.automode = v end
    return true
  end
  function api.GetGlobalAutomationOverride() return api.override end
  function api.SetGlobalAutomationOverride(v) w(); api.override = v end
  function api.IsTrackSelected(tr) return tr.selected end
  function api.SetTrackSelected(tr, s) tr.selected = s end
  function api.GetTrackStateChunk(tr)
    local s = "<TRACK\nNAME " .. tr.name .. "\n"
    for _ = 1, tr.freezes do s = s .. "<FREEZE 0\n>\n" end
    return true, s .. ">"
  end

  -- Undo: every block is an undo point, labelled
  -- Undo restores every FX's named config (what a modulation edit changes) to the block's start
  local function cfg_copy()
    local out = {}
    for _, tr in ipairs(api.tracks) do
      for _, fx in ipairs(tr.fx) do
        local c = {}
        for k, v in pairs(fx.cfg) do c[k] = v end
        out[fx] = c
      end
    end
    return out
  end
  local saved = {}
  function api.Undo_BeginBlock() api.depth = api.depth + 1; saved[#api.undo + 1] = cfg_copy() end
  function api.Undo_EndBlock(label) api.depth = api.depth - 1; api.undo[#api.undo + 1] = label end
  function api.Undo_CanUndo2() return api.undo[#api.undo] end
  function api.Undo_DoUndo2()
    local n = #api.undo
    for fx, c in pairs(saved[n] or {}) do fx.cfg = c end
    api.undone = table.remove(api.undo)
    return 1
  end

  -- FX (index 0x1000000 + i on the master = monitoring FX)
  local function fx_of(tr, i)
    if i >= 0x1000000 then return tr.mon and tr.mon[i - 0x1000000 + 1] end
    return tr.fx[i + 1]
  end
  function api.TrackFX_GetCount(tr) return #tr.fx end
  function api.TrackFX_GetRecCount(tr) return tr.mon and #tr.mon or 0 end
  function api.TrackFX_GetFXName(tr, i) local fx = fx_of(tr, i); return fx ~= nil, fx and fx.name or "" end
  function api.TrackFX_GetNumParams(tr, i) local fx = fx_of(tr, i); return fx and #fx.params or 0 end
  function api.TrackFX_GetParamName(tr, i, p) local fx = fx_of(tr, i); return true, fx.params[p + 1].name end
  function api.TrackFX_GetParamNormalized(tr, i, p) return fx_of(tr, i).params[p + 1].v end
  function api.TrackFX_SetParamNormalized(tr, i, p, v) w(); fx_of(tr, i).params[p + 1].v = v; return true end
  function api.TrackFX_GetFormattedParamValue(tr, i, p) return true, string.format("%.2f", fx_of(tr, i).params[p + 1].v) end
  function api.TrackFX_GetEnabled(tr, i) return fx_of(tr, i).enabled end
  function api.TrackFX_SetEnabled(tr, i, e) w(); fx_of(tr, i).enabled = e end
  function api.TrackFX_GetOffline(tr, i) return fx_of(tr, i).offline end
  function api.TrackFX_SetOffline(tr, i, o) w(); fx_of(tr, i).offline = o end
  function api.TrackFX_AddByName(tr, name, rec, inst)
    if not api.installed[name] then return -1 end
    if inst == 0 then return -1 end
    w()
    local list = rec and tr.mon or tr.fx
    list[#list + 1] = new_fx({ name = name })
    return rec and (0x1000000 + #list - 1) or (#list - 1)
  end
  function api.TrackFX_Delete(tr, i)
    w()
    if i >= 0x1000000 then table.remove(tr.mon, i - 0x1000000 + 1) else table.remove(tr.fx, i + 1) end
    return true
  end
  -- Named config: param.N.* keys; reads fail until the parameter has modulation (as REAPER)
  function api.TrackFX_GetNamedConfigParm(tr, i, key)
    local fx = fx_of(tr, i)
    local pin = key:match("^in_pin_(%d+)$") or key:match("^out_pin_(%d+)$")
    if pin then return true, (key:sub(1, 2) == "in" and "in " or "out ") .. pin end
    local v = fx.cfg[key]
    if v == nil then return false, "" end
    return true, v
  end
  local KNOWN = { ["mod.active"] = 1, ["mod.baseline"] = 1, ["lfo.active"] = 1, ["lfo.shape"] = 1, ["lfo.speed"] = 1,
    ["lfo.strength"] = 1, ["lfo.phase"] = 1, ["lfo.temposync"] = 1, ["lfo.dir"] = 1, ["acs.active"] = 1, ["acs.attack"] = 1,
    ["acs.release"] = 1, ["acs.dblo"] = 1, ["acs.dbhi"] = 1, ["acs.strength"] = 1, ["acs.chan"] = 1, ["acs.dir"] = 1,
    ["plink.active"] = 1, ["plink.effect"] = 1, ["plink.param"] = 1, ["plink.scale"] = 1, ["plink.offset"] = 1 }
  function api.TrackFX_SetNamedConfigParm(tr, i, key, v)
    local p, rest = key:match("^param%.(%d+)%.(.+)$")
    if not p or not KNOWN[rest] then return false end
    w()
    fx_of(tr, i).cfg[key] = v
    return true
  end
  function api.TrackFX_GetIOSize(tr, i) local fx = fx_of(tr, i); return 0, fx.ins, fx.outs end
  function api.TrackFX_GetPinMappings(tr, i, out, pin)
    local m = fx_of(tr, i).pins[out][pin]
    if not m then return 0, 0 end
    return m[1], m[2]
  end
  function api.TrackFX_SetPinMappings(tr, i, out, pin, lo, hi)
    local fx = fx_of(tr, i)
    if pin >= (out == 1 and fx.outs or fx.ins) then return false end
    w()
    fx.pins[out][pin] = { lo, hi }
    return true
  end

  -- Items and takes
  local function take_of(it) return it.takes[it.active] end
  function api.GetTrackMediaItem(tr, i) return tr.items[(i or -1) + 1] end
  function api.CountTrackMediaItems(tr) return #tr.items end
  function api.CountMediaItems()
    local n = 0
    for _, tr in ipairs(api.tracks) do n = n + #tr.items end
    return n
  end
  function api.GetMediaItem(_, i)
    for _, tr in ipairs(api.tracks) do
      if i < #tr.items then return tr.items[i + 1] end
      i = i - #tr.items
    end
  end
  function api.IsMediaItemSelected(it) return it.selected end
  function api.SetMediaItemSelected(it, s) it.selected = s end
  function api.GetActiveTake(it) return take_of(it) end
  function api.CountTakes(it) return #it.takes end
  function api.TakeIsMIDI(take) return take.midi end
  function api.GetMediaItemInfo_Value(it, k)
    if k == "D_POSITION" then return it.pos elseif k == "D_LENGTH" then return it.len end
    return 0
  end
  function api.GetMediaItemTakeInfo_Value(take, k)
    if k == "D_STARTOFFS" then return take.offs elseif k == "D_PLAYRATE" then return take.rate end
    return 0
  end
  function api.GetSetMediaItemTakeInfo_String(take) return true, take.name end
  function api.UpdateItemInProject() end
  function api.UpdateArrange() end
  function api.GetTakeNumStretchMarkers(take) return #take.sm end
  function api.GetTakeStretchMarker(take, i) local m = take.sm[i + 1]; return i, m[1], m[2] end
  function api.SetTakeStretchMarker(take, i, pos, src)
    w()
    src = src or (take.offs + pos) -- pos is take time at rate 1, as REAPER
    if i < 0 then
      take.sm[#take.sm + 1] = { pos, src }
      table.sort(take.sm, function(a, b) return a[1] < b[1] end)
      for k, m in ipairs(take.sm) do if m[1] == pos then return k - 1 end end
    end
    take.sm[i + 1] = { pos, src }
    return i
  end
  function api.DeleteTakeStretchMarkers(take, i) w(); table.remove(take.sm, i + 1); return 1 end

  function api.TimeMap2_timeToQN(_, t) return t * 2 end
  function api.TimeMap2_QNToTime(_, qn) return qn / 2 end

  -- Native actions on the selection: freeze adds a layer and takes the FX and items in,
  -- unfreeze puts one layer back; apply FX adds a take to each selected item
  function api.Main_OnCommand(id)
    api.actions[#api.actions + 1] = id
    w()
    if id == 41223 or id == 40901 or id == 40877 then
      for _, tr in ipairs(api.tracks) do
        if tr.selected then
          tr.freezes = tr.freezes + 1
          tr.saved = { fx = tr.fx, items = #tr.items }
          tr.fx = {}
        end
      end
    elseif id == 41644 then
      for _, tr in ipairs(api.tracks) do
        if tr.selected and tr.freezes > 0 then
          tr.freezes = tr.freezes - 1
          if tr.saved then tr.fx = tr.saved.fx end
        end
      end
    elseif id == 40209 or id == 40361 or id == 41993 then
      for _, tr in ipairs(api.tracks) do
        for _, it in ipairs(tr.items) do
          if it.selected then
            it.takes[#it.takes + 1] = { name = take_of(it).name .. " render", midi = false, offs = 0, rate = 1, sm = {} }
            it.active = #it.takes
          end
        end
      end
    end
  end

  return api
end
