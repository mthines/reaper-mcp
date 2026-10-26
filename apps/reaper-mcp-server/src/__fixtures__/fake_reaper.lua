-- Minimal in-memory stand-in for the ReaScript API, enough to drive
-- reaper/mcp_plan_lib.lua in unit tests. Every mutating call bumps
-- `api.writes` and appends to `api.log`; undo blocks only become undo
-- points when something was written inside them, as in REAPER.
--
-- new_fake{ tracks = { { name = "Kick", fx = { "ReaEQ" }, chunk = "..." } },
--           missing_fx = "Nope", undo = { "User edit" }, json = fn | false }

function new_fake(spec)
  spec = spec or {}
  local api = { writes = 0, log = {}, undo = {}, begins = 0, ends = 0 }
  local tracks = {}
  local guid_n = 0

  local function guid()
    guid_n = guid_n + 1
    return string.format("{00000000-0000-0000-0000-%012d}", guid_n)
  end

  local function write(what)
    api.writes = api.writes + 1
    api.log[#api.log + 1] = what
    if api.in_block then api.block_dirty = true end
  end

  local function new_track(name, chunk)
    return {
      name = name, guid = guid(), vals = {}, fx = {}, sends = {},
      chunk = chunk or ('<TRACK\nNAME "' .. name .. '"\n>\n'),
    }
  end

  for _, t in ipairs(spec.tracks or {}) do
    local tr = new_track(t.name, t.chunk)
    for _, f in ipairs(t.fx or {}) do
      tr.fx[#tr.fx + 1] = { name = f, guid = guid(), params = {} }
    end
    tracks[#tracks + 1] = tr
  end
  for _, u in ipairs(spec.undo or {}) do api.undo[#api.undo + 1] = u end

  api.tracks = tracks
  api.genGuid = function() return guid() end

  api.CountTracks = function() return #tracks end
  api.GetTrack = function(_, i) return tracks[i + 1] end
  api.GetTrackName = function(tr) return true, tr.name end
  api.GetTrackGUID = function(tr) return tr.guid end
  api.InsertTrackAtIndex = function(i)
    table.insert(tracks, i + 1, new_track(""))
    write("insert_track")
  end
  api.GetSetMediaTrackInfo_String = function(tr, _, v, set)
    if set then tr.name = v; write("set_name") end
    return true, tr.name
  end
  api.SetMediaTrackInfo_Value = function(tr, k, v)
    tr.vals[k] = v
    write("set " .. k)
    return true
  end

  api.TrackFX_GetCount = function(tr) return #tr.fx end
  api.TrackFX_AddByName = function(tr, name)
    if name == spec.missing_fx then return -1 end
    tr.fx[#tr.fx + 1] = { name = name, guid = guid(), params = {} }
    write("add_fx " .. name)
    return #tr.fx - 1
  end
  api.TrackFX_SetEnabled = function(tr, fx, on) tr.fx[fx + 1].enabled = on; write("fx_enabled") end
  api.TrackFX_SetParam = function(tr, fx, p, v)
    if not tr.fx[fx + 1] then return false end
    tr.fx[fx + 1].params[p] = v
    write("fx_param")
    return true
  end
  api.TrackFX_GetFXGUID = function(tr, fx) return tr.fx[fx + 1] and tr.fx[fx + 1].guid end
  api.TrackFX_GetFXName = function(tr, fx) return true, tr.fx[fx + 1].name end

  api.CreateTrackSend = function(src, dst)
    src.sends[#src.sends + 1] = { dst = dst }
    write("create_send")
    return #src.sends - 1
  end
  api.SetTrackSendInfo_Value = function(src, _, s, k, v)
    src.sends[s + 1][k] = v
    write("send " .. k)
    return true
  end

  api.GetTrackStateChunk = function(tr) return true, tr.chunk end
  api.SetTrackStateChunk = function(tr, c)
    tr.chunk = c
    write("set_chunk")
    return true
  end

  api.Undo_BeginBlock = function()
    api.begins = api.begins + 1
    api.in_block = true
    api.block_dirty = false
  end
  api.Undo_EndBlock = function(label)
    api.ends = api.ends + 1
    api.in_block = false
    if api.block_dirty then api.undo[#api.undo + 1] = label end
  end
  api.Undo_CanUndo2 = function() return api.undo[#api.undo] end
  api.Undo_DoUndo2 = function()
    api.undone = table.remove(api.undo)
    return 1
  end
  api.PreventUIRefresh = function() end

  if spec.json then api.CF_Json_Parse = spec.json end
  return api
end
