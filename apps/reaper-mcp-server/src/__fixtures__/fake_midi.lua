-- Fake ReaScript API for mcp_midi_lib.lua tests: tracks of items whose takes hold MIDI
-- notes and CC, at a fixed tempo (120 BPM: 2 quarter notes a second) and 960 PPQ per
-- quarter note from the item start. Every write bumps api.writes, so a test can prove
-- a refusal changed nothing.
-- Like REAPER 7.40, an undo block records a point only when items changed visibly: MIDI
-- API edits alone don't count until MarkTrackItemsDirty (creating items or tracks does).
--
-- new_midi_fake{ tracks = { { name = "Keys", items = { { pos = 0, len = 4, notes = {
--   { s = 0, e = 1, pitch = 60, vel = 100, chan = 0 } } } } } } }   -- note times in beats from the item start

local PPQ = 960
local QN_PER_SEC = 2

function new_midi_fake(spec)
  local api = { writes = 0, undo = {}, tracks = {}, dirty = false }

  local function new_item(tr, it)
    local item = { pos = it.pos or 0, len = it.len or 4, mute = it.mute and 1 or 0, track = tr }
    local take = { item = item, midi = it.audio == nil, notes = {}, cc = {}, name = "" }
    for _, n in ipairs(it.notes or {}) do
      take.notes[#take.notes + 1] = { sel = false, muted = n.muted or false, s = n.s * PPQ, e = n.e * PPQ,
        chan = n.chan or 0, pitch = n.pitch, vel = n.vel or 100 }
    end
    item.take = take
    return item
  end

  local function new_track(t)
    local tr = { name = t.name or "", items = {} }
    for _, it in ipairs(t.items or {}) do tr.items[#tr.items + 1] = new_item(tr, it) end
    return tr
  end

  for _, t in ipairs(spec.tracks or {}) do api.tracks[#api.tracks + 1] = new_track(t) end

  local function w() api.writes = api.writes + 1 end
  local function item_qn(take) return take.item.pos * QN_PER_SEC end

  function api.CountTracks() return #api.tracks end
  function api.GetTrack(_, i) return api.tracks[i + 1] end
  function api.CountTrackMediaItems(tr) return #tr.items end
  function api.GetTrackMediaItem(tr, i) return tr.items[i + 1] end
  function api.GetActiveTake(item) return item.take end
  function api.TakeIsMIDI(take) return take.midi end
  function api.GetMediaItemInfo_Value(item, key)
    if key == "D_POSITION" then return item.pos end
    if key == "D_LENGTH" then return item.len end
    if key == "B_MUTE" then return item.mute end
    return 0
  end
  function api.TimeMap2_timeToQN(_, t) return t * QN_PER_SEC end

  function api.MIDI_CountEvts(take) return 1, #take.notes, #take.cc, 0 end
  function api.MIDI_GetNote(take, i)
    local n = take.notes[i + 1]
    if not n then return false end
    return true, n.sel, n.muted, n.s, n.e, n.chan, n.pitch, n.vel
  end
  function api.MIDI_SetNote(take, i, sel, muted, s, e, chan, pitch, vel, _noSort)
    local n = take.notes[i + 1]
    if not n then return false end
    w()
    if sel ~= nil then n.sel = sel end
    if muted ~= nil then n.muted = muted end
    if s ~= nil then n.s = s end
    if e ~= nil then n.e = e end
    if chan ~= nil then n.chan = chan end
    if pitch ~= nil then n.pitch = pitch end
    if vel ~= nil then n.vel = vel end
    return true
  end
  function api.MIDI_InsertNote(take, sel, muted, s, e, chan, pitch, vel, _noSort)
    w()
    take.notes[#take.notes + 1] = { sel = sel, muted = muted, s = s, e = e, chan = chan, pitch = pitch, vel = vel }
    return true
  end
  function api.MIDI_InsertCC(take, sel, muted, ppq, chanmsg, chan, msg2, msg3)
    w()
    take.cc[#take.cc + 1] = { sel = sel, muted = muted, ppq = ppq, chanmsg = chanmsg, chan = chan, cc = msg2, value = msg3 }
    return true
  end
  function api.MIDI_Sort(take)
    table.sort(take.notes, function(a, b)
      if a.s ~= b.s then return a.s < b.s end
      return a.pitch < b.pitch
    end)
  end
  function api.MIDI_GetProjQNFromPPQPos(take, ppq) return item_qn(take) + ppq / PPQ end
  function api.MIDI_GetPPQPosFromProjQN(take, qn) return (qn - item_qn(take)) * PPQ end

  function api.MarkTrackItemsDirty() api.dirty = true end

  function api.InsertTrackAtIndex(idx, _)
    w()
    api.dirty = true
    table.insert(api.tracks, idx + 1, new_track{})
  end
  function api.GetSetMediaTrackInfo_String(tr, key, val, set)
    if key == "P_NAME" then
      if set then w(); tr.name = val end
      return true, tr.name
    end
    return false, ""
  end
  function api.GetSetMediaItemTakeInfo_String(take, key, val, set)
    if key == "P_NAME" then
      if set then w(); take.name = val end
      return true, take.name
    end
    return false, ""
  end
  function api.CreateNewMIDIItemInProj(tr, startQN, endQN, _qn)
    -- Test hook: the Nth item creation raises, like a REAPER call failing half way
    api.creates = (api.creates or 0) + 1
    if api.fail_create_at == api.creates then error("CreateNewMIDIItemInProj failed") end
    w()
    api.dirty = true
    local item = new_item(tr, { pos = startQN / QN_PER_SEC, len = (endQN - startQN) / QN_PER_SEC })
    tr.items[#tr.items + 1] = item
    table.sort(tr.items, function(a, b) return a.pos < b.pos end)
    return item
  end

  -- Undo: each block keeps a copy of the tracks from before it
  local function copy(v, seen)
    if type(v) ~= "table" then return v end
    if seen[v] then return seen[v] end
    local out = {}
    seen[v] = out
    for k, x in pairs(v) do out[copy(k, seen)] = copy(x, seen) end
    return out
  end
  local before, saved = nil, {}
  function api.Undo_BeginBlock() before = copy(api.tracks, {}) end
  function api.Undo_EndBlock(label)
    if api.dirty then api.undo[#api.undo + 1] = label; saved[#api.undo] = before end
    api.dirty = false
  end
  function api.Undo_CanUndo2(_) return api.undo[#api.undo] end
  function api.Undo_DoUndo2(_)
    local n = #api.undo
    if n == 0 then return 0 end
    api.tracks = saved[n]
    api.undo[n], saved[n] = nil, nil
    return 1
  end
  function api.UpdateArrange() end

  -- Test helper: the notes of track t, item i as "pitch@start-end:vel" in beats from the item start
  function api.notes_of(t, i)
    local out = {}
    for _, n in ipairs(api.tracks[t + 1].items[i + 1].take.notes) do
      local function b(ppq) return math.floor(ppq / PPQ * 10000 + 0.5) / 10000 end
      out[#out + 1] = string.format("%d@%g-%g:%d", n.pitch, b(n.s), b(n.e), n.vel)
    end
    return table.concat(out, " ")
  end

  return api
end
