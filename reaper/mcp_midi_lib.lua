-- mcp_midi_lib.lua — MIDI composition edits: quantize, transform (transpose, velocity,
-- humanize, lengths), import of parsed MIDI file data, and the pitch-class profile
-- detect_key reads.
-- Pure logic over an injected ReaScript API, unit-tested via wasmoon against a fake.
-- Loaded by mcp_bridge.lua.
-- Every function checks all of its input before the first write, so a refused request
-- changes nothing; each write is one undo point. Times are quarter notes (beats) on the
-- project grid: quantize snaps to the project's beats, not the item's start.

local M = {}

M.MAX_IMPORT_NOTES = 20000
M.MAX_IMPORT_TRACKS = 32
M.MAX_PROFILE_ITEMS = 256

local EPS = 1e-9

local function num(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function int(v) return num(v) and v == math.floor(v) end
local function r4(x) return math.floor(x * 10000 + 0.5) / 10000 end

local function with_undo(api, label, fn)
  api.Undo_BeginBlock()
  local ok, res, err = pcall(fn)
  api.Undo_EndBlock(label, -1)
  api.UpdateArrange()
  if not ok then return nil, "Handler error: " .. tostring(res) end
  return res, err
end

-- The MIDI take of a track/item pair, or why not
local function midi_take(api, p)
  if not int(p.trackIndex) or p.trackIndex < 0 then return nil, "trackIndex must be 0 or more" end
  if not int(p.itemIndex) or p.itemIndex < 0 then return nil, "itemIndex must be 0 or more" end
  local tr = api.GetTrack(0, p.trackIndex)
  if not tr then return nil, "track " .. p.trackIndex .. " not found" end
  local n = api.CountTrackMediaItems(tr)
  if p.itemIndex >= n then return nil, "item " .. p.itemIndex .. " not found (track has " .. n .. " items)" end
  local item = api.GetTrackMediaItem(tr, p.itemIndex)
  local take = item and api.GetActiveTake(item)
  if not take then return nil, "the item has no active take" end
  if not api.TakeIsMIDI(take) then return nil, "item " .. p.itemIndex .. " is not a MIDI item" end
  return { track = tr, item = item, take = take, startQN = api.TimeMap2_timeToQN(0, api.GetMediaItemInfo_Value(item, "D_POSITION")) }
end

-- Every note of a take as { i, sel, muted, s, e, qs, qe, chan, pitch, vel } (q* = project quarter notes)
local function read_notes(api, t)
  local _, count = api.MIDI_CountEvts(t.take)
  local notes = {}
  for i = 0, count - 1 do
    local _, sel, muted, s, e, chan, pitch, vel = api.MIDI_GetNote(t.take, i)
    notes[#notes + 1] = { i = i, sel = sel, muted = muted, s = s, e = e, chan = chan, pitch = pitch, vel = vel,
      qs = api.MIDI_GetProjQNFromPPQPos(t.take, s), qe = api.MIDI_GetProjQNFromPPQPos(t.take, e) }
  end
  return notes
end

-- The notes a call acts on: given indexes, else a pitch range and/or channel, else all
local function pick(notes, p)
  if p.notes ~= nil then
    if type(p.notes) ~= "table" or #p.notes == 0 then return nil, "notes must be a list of note indexes" end
    local out, seen = {}, {}
    for _, i in ipairs(p.notes) do
      if not int(i) or i < 0 or i >= #notes then return nil, "note " .. tostring(i) .. " not found (the item has " .. #notes .. " notes)" end
      if not seen[i] then seen[i] = true; out[#out + 1] = notes[i + 1] end
    end
    return out
  end
  local lo, hi = p.pitchMin or 0, p.pitchMax or 127
  if not int(lo) or not int(hi) or lo < 0 or hi > 127 or lo > hi then return nil, "pitchMin/pitchMax must be 0-127, min ≤ max" end
  if p.channel ~= nil and (not int(p.channel) or p.channel < 0 or p.channel > 15) then return nil, "channel must be 0-15" end
  local out = {}
  for _, n in ipairs(notes) do
    if n.pitch >= lo and n.pitch <= hi and (p.channel == nil or n.chan == p.channel) then out[#out + 1] = n end
  end
  if #out == 0 then return nil, "no notes match" end
  return out
end

local function write_notes(api, t, changed)
  for _, n in ipairs(changed) do
    api.MIDI_SetNote(t.take, n.i, nil, nil, api.MIDI_GetPPQPosFromProjQN(t.take, n.nqs),
      api.MIDI_GetPPQPosFromProjQN(t.take, n.nqe), nil, n.npitch, n.nvel, true)
  end
  api.MIDI_Sort(t.take)
  -- MIDI API edits leave the item unmarked; without this REAPER folds the edit into the previous
  -- MIDI undo point and undo restores a mixed state (seen in REAPER 7.40)
  api.MarkTrackItemsDirty(t.track, t.item)
end

-- -----------------------------------------------------------------------------
-- Quantize
-- -----------------------------------------------------------------------------

-- The grid line nearest qn, with every second line pushed later by `swing` of a grid step
local function snap(qn, grid, swing)
  local k = math.floor(qn / grid + 0.5)
  local best, best_d
  for j = k - 1, k + 1 do
    local line = j * grid + ((j % 2 == 1) and swing * grid or 0)
    local d = math.abs(qn - line)
    if not best_d or d < best_d then best, best_d = line, d end
  end
  return best
end

local function check_quantize(api, p)
  local t, err = midi_take(api, p)
  if not t then return nil, err end
  if not num(p.grid) or p.grid <= 0 or p.grid > 16 then return nil, "grid must be more than 0 and at most 16 beats (0.25 = 16ths)" end
  local strength = p.strength == nil and 1 or p.strength
  if not num(strength) or strength < 0 or strength > 1 then return nil, "strength must be 0-1" end
  local swing = p.swing or 0
  if not num(swing) or swing < 0 or swing > 0.9 then return nil, "swing must be 0-0.9" end
  local window = p.window == nil and 1 or p.window
  if not num(window) or window <= 0 or window > 1 then return nil, "window must be more than 0 and at most 1" end
  local lengths = p.lengths or "keep"
  if lengths ~= "keep" and lengths ~= "quantize" then return nil, "lengths must be keep or quantize" end
  local picked, perr = pick(read_notes(api, t), p)
  if not picked then return nil, perr end
  return { t = t, notes = picked, grid = p.grid, strength = strength, swing = swing, window = window, lengths = lengths }
end

local function apply_quantize(api, c)
  local changed, shifts, max_shift = {}, 0, 0
  for _, n in ipairs(c.notes) do
    local line = snap(n.qs, c.grid, c.swing)
    local off = line - n.qs
    -- Notes further from a line than the window are left where they are
    if math.abs(off) <= c.window * c.grid / 2 + EPS and math.abs(off) > EPS then
      -- Blend, so a full-strength note lands exactly on the line
      n.nqs = line * c.strength + n.qs * (1 - c.strength)
      if c.lengths == "quantize" then
        local e = snap(n.qe, c.grid, c.swing)
        if e <= line + EPS then e = line + c.grid end
        n.nqe = e * c.strength + n.qe * (1 - c.strength)
      else
        n.nqe = n.qe + (n.nqs - n.qs)
      end
      changed[#changed + 1] = n
      shifts = shifts + math.abs(off)
      if math.abs(off) > max_shift then max_shift = math.abs(off) end
    end
  end
  write_notes(api, c.t, changed)
  return { notes = #c.notes, moved = #changed, grid = c.grid, strength = c.strength, swing = c.swing,
    avgShiftBeats = #changed > 0 and r4(shifts / #changed) or 0, maxShiftBeats = r4(max_shift) }
end

function M.quantize(api, p)
  local c, err = check_quantize(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Quantize MIDI", function() return apply_quantize(api, c) end)
end

-- -----------------------------------------------------------------------------
-- Transform: transpose, velocity, humanize, lengths
-- -----------------------------------------------------------------------------

-- Reproducible pseudo-random numbers in -1..1 (a seed gives the same humanize every time)
local function rng(seed)
  local state = (math.floor(seed) % 2147483646) + 1
  return function()
    state = (state * 16807) % 2147483647
    return (state / 2147483647) * 2 - 1
  end
end

local function check_transform(api, p)
  local t, err = midi_take(api, p)
  if not t then return nil, err end
  local c = { t = t }
  if p.transpose ~= nil and (not int(p.transpose) or p.transpose < -48 or p.transpose > 48) then return nil, "transpose must be a whole number of semitones, -48 to 48" end
  local v = p.velocity or {}
  if type(v) ~= "table" then return nil, "velocity must be an object" end
  if v.set ~= nil and (not int(v.set) or v.set < 1 or v.set > 127) then return nil, "velocity.set must be 1-127" end
  if v.scale ~= nil and (not num(v.scale) or v.scale < 0 or v.scale > 4) then return nil, "velocity.scale must be 0-4" end
  if v.add ~= nil and (not int(v.add) or v.add < -126 or v.add > 126) then return nil, "velocity.add must be -126 to 126" end
  local vmin, vmax = v.min or 1, v.max or 127
  if not int(vmin) or not int(vmax) or vmin < 1 or vmax > 127 or vmin > vmax then return nil, "velocity.min/max must be 1-127, min ≤ max" end
  local h = p.humanize or {}
  if type(h) ~= "table" then return nil, "humanize must be an object" end
  if h.timingBeats ~= nil and (not num(h.timingBeats) or h.timingBeats < 0 or h.timingBeats > 0.25) then return nil, "humanize.timingBeats must be 0-0.25" end
  if h.velocity ~= nil and (not int(h.velocity) or h.velocity < 0 or h.velocity > 64) then return nil, "humanize.velocity must be 0-64" end
  if h.seed ~= nil and not int(h.seed) then return nil, "humanize.seed must be a whole number" end
  local l = p.length or {}
  if type(l) ~= "table" then return nil, "length must be an object" end
  if l.set ~= nil and (not num(l.set) or l.set <= 0 or l.set > 64) then return nil, "length.set must be more than 0 and at most 64 beats" end
  if l.scale ~= nil and (not num(l.scale) or l.scale <= 0 or l.scale > 8) then return nil, "length.scale must be more than 0 and at most 8" end
  if l.legato ~= nil and type(l.legato) ~= "boolean" then return nil, "length.legato must be true or false" end
  if p.transpose == nil and next(v) == nil and next(h) == nil and next(l) == nil then
    return nil, "give at least one of transpose, velocity, humanize or length"
  end
  local all = read_notes(api, t)
  local picked, perr = pick(all, p)
  if not picked then return nil, perr end
  if p.transpose then
    local out = 0
    for _, n in ipairs(picked) do
      local np = n.pitch + p.transpose
      if np < 0 or np > 127 then out = out + 1 end
    end
    if out > 0 then return nil, out .. " note(s) would leave the MIDI range 0-127 when transposed by " .. p.transpose end
  end
  c.all, c.notes, c.transpose, c.v, c.vmin, c.vmax, c.h, c.l = all, picked, p.transpose or 0, v, vmin, vmax, h, l
  return c
end

local function apply_transform(api, c)
  local rand = rng(c.h.seed or 1)
  local v, h, l = c.v, c.h, c.l
  local clamped, vel_before, vel_after = 0, 0, 0
  -- Legato: each note runs to the next picked note's start (on the same channel)
  local next_start = {}
  if l.legato then
    local order = {}
    for _, n in ipairs(c.notes) do order[#order + 1] = n end
    table.sort(order, function(a, b) return a.qs < b.qs end)
    for k, n in ipairs(order) do
      for j = k + 1, #order do
        if order[j].chan == n.chan and order[j].qs > n.qs + EPS then next_start[n] = order[j].qs; break end
      end
    end
  end
  for _, n in ipairs(c.notes) do
    n.npitch = n.pitch + c.transpose
    local vel = n.vel
    if v.set then vel = v.set end
    if v.scale then vel = vel * v.scale end
    if v.add then vel = vel + v.add end
    if h.velocity and h.velocity > 0 then vel = vel + rand() * h.velocity end
    vel = math.floor(vel + 0.5)
    local cl = math.max(c.vmin, math.min(c.vmax, vel))
    if cl ~= vel then clamped = clamped + 1 end
    n.nvel = cl
    vel_before, vel_after = vel_before + n.vel, vel_after + cl
    local len = n.qe - n.qs
    if l.set then len = l.set end
    if l.scale then len = len * l.scale end
    local qs = n.qs
    if h.timingBeats and h.timingBeats > 0 then qs = math.max(c.t.startQN, qs + rand() * h.timingBeats) end
    if l.legato and next_start[n] then len = next_start[n] - qs end
    n.nqs, n.nqe = qs, qs + math.max(len, 1 / 960)
  end
  write_notes(api, c.t, c.notes)
  local n = #c.notes
  return { notes = n, transpose = c.transpose, velocityClamped = clamped,
    avgVelocityBefore = r4(vel_before / n), avgVelocityAfter = r4(vel_after / n),
    seed = (h.timingBeats or h.velocity) and (h.seed or 1) or nil }
end

function M.transform(api, p)
  local c, err = check_transform(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Transform MIDI", function() return apply_transform(api, c) end)
end

-- -----------------------------------------------------------------------------
-- Import parsed MIDI file data
-- -----------------------------------------------------------------------------

-- p.tracks: [{ name, notes = {{startQN, lenQN, chan, pitch, vel}, ...}, cc = {{qn, chan, cc, value}, ...} }]
local function check_import(api, p)
  if not num(p.position) or p.position < 0 then return nil, "position must be 0 or more seconds" end
  if type(p.tracks) ~= "table" or #p.tracks == 0 then return nil, "the file holds no notes or controllers" end
  if #p.tracks > M.MAX_IMPORT_TRACKS then return nil, "the file has " .. #p.tracks .. " tracks with notes; at most " .. M.MAX_IMPORT_TRACKS end
  if not num(p.lengthQN) or p.lengthQN <= 0 then return nil, "lengthQN must be more than 0" end
  local n_tracks = api.CountTracks(0)
  if not int(p.trackIndex) or p.trackIndex < 0 then return nil, "trackIndex must be 0 or more" end
  if p.newTracks then
    if p.trackIndex > n_tracks then return nil, "trackIndex " .. p.trackIndex .. " is past the last track (" .. n_tracks .. " tracks)" end
  elseif p.trackIndex >= n_tracks then
    return nil, "track " .. p.trackIndex .. " not found"
  end
  local total = 0
  for k, t in ipairs(p.tracks) do
    if type(t.notes) ~= "table" or type(t.cc or {}) ~= "table" then return nil, "track " .. k .. " is malformed" end
    total = total + #t.notes
    for _, n in ipairs(t.notes) do
      if not (num(n[1]) and n[1] >= 0 and num(n[2]) and n[2] > 0 and int(n[3]) and n[3] >= 0 and n[3] <= 15
        and int(n[4]) and n[4] >= 0 and n[4] <= 127 and int(n[5]) and n[5] >= 1 and n[5] <= 127) then
        return nil, "track " .. k .. " has a malformed note"
      end
    end
    for _, e in ipairs(t.cc or {}) do
      if not (num(e[1]) and e[1] >= 0 and int(e[2]) and e[2] >= 0 and e[2] <= 15 and int(e[3]) and e[3] >= 0
        and e[3] <= 127 and int(e[4]) and e[4] >= 0 and e[4] <= 127) then
        return nil, "track " .. k .. " has a malformed controller event"
      end
    end
  end
  if total > M.MAX_IMPORT_NOTES then return nil, "the file has " .. total .. " notes; at most " .. M.MAX_IMPORT_NOTES .. " per import" end
  return p
end

local function apply_import(api, p)
  local startQN = api.TimeMap2_timeToQN(0, p.position)
  local endQN = startQN + p.lengthQN
  local groups = p.tracks
  if not p.newTracks and #groups > 1 then
    -- One item: every file track's notes merged
    local merged = { name = p.name or groups[1].name, notes = {}, cc = {} }
    for _, t in ipairs(groups) do
      for _, n in ipairs(t.notes) do merged.notes[#merged.notes + 1] = n end
      for _, e in ipairs(t.cc or {}) do merged.cc[#merged.cc + 1] = e end
    end
    groups = { merged }
  end
  local items = {}
  for k, g in ipairs(groups) do
    local idx = p.trackIndex
    if p.newTracks then
      idx = p.trackIndex + k - 1
      api.InsertTrackAtIndex(idx, true)
      if g.name and g.name ~= "" then api.GetSetMediaTrackInfo_String(api.GetTrack(0, idx), "P_NAME", g.name, true) end
    end
    local tr = api.GetTrack(0, idx)
    local item = api.CreateNewMIDIItemInProj(tr, startQN, endQN, true)
    local take = api.GetActiveTake(item)
    if g.name and g.name ~= "" then api.GetSetMediaItemTakeInfo_String(take, "P_NAME", g.name, true) end
    for _, n in ipairs(g.notes) do
      api.MIDI_InsertNote(take, false, false, api.MIDI_GetPPQPosFromProjQN(take, startQN + n[1]),
        api.MIDI_GetPPQPosFromProjQN(take, startQN + n[1] + n[2]), n[3], n[4], n[5], true)
    end
    for _, e in ipairs(g.cc or {}) do
      api.MIDI_InsertCC(take, false, false, api.MIDI_GetPPQPosFromProjQN(take, startQN + e[1]), 0xB0, e[2], e[3], e[4])
    end
    api.MIDI_Sort(take)
    api.MarkTrackItemsDirty(tr, item)
    local itemIndex
    for i = 0, api.CountTrackMediaItems(tr) - 1 do
      if api.GetTrackMediaItem(tr, i) == item then itemIndex = i end
    end
    items[#items + 1] = { trackIndex = idx, itemIndex = itemIndex, name = g.name or "", notes = #g.notes, cc = #(g.cc or {}) }
  end
  return { position = p.position, lengthBeats = r4(p.lengthQN), items = items }
end

function M.import(api, p)
  local c, err = check_import(api, p)
  if not c then return nil, err .. " — nothing changed" end
  return with_undo(api, "MCP: Import MIDI file", function() return apply_import(api, c) end)
end

-- -----------------------------------------------------------------------------
-- Pitch-class profile (for detect_key)
-- -----------------------------------------------------------------------------

-- Note time per pitch class (C = 1 … B = 12) over a track's MIDI items in [start, end),
-- weighted by duration and velocity. Unmuted notes of unmuted items only.
function M.pitch_profile(api, p)
  if not int(p.trackIndex) or p.trackIndex < 0 then return nil, "trackIndex must be 0 or more" end
  local tr = api.GetTrack(0, p.trackIndex)
  if not tr then return nil, "track " .. p.trackIndex .. " not found" end
  local t0, t1 = p.startTime or 0, p.endTime
  if not num(t0) or t0 < 0 then return nil, "startTime must be 0 or more" end
  if t1 ~= nil and (not num(t1) or t1 <= t0) then return nil, "endTime must be after startTime" end
  local q0 = api.TimeMap2_timeToQN(0, t0)
  local q1 = t1 and api.TimeMap2_timeToQN(0, t1) or math.huge
  local chroma = {}
  for k = 1, 12 do chroma[k] = 0 end
  local notes, midi_items, audio_items = 0, 0, 0
  for i = 0, math.min(api.CountTrackMediaItems(tr), M.MAX_PROFILE_ITEMS) - 1 do
    local item = api.GetTrackMediaItem(tr, i)
    local take = api.GetActiveTake(item)
    if take and api.GetMediaItemInfo_Value(item, "B_MUTE") == 0 then
      if api.TakeIsMIDI(take) then
        midi_items = midi_items + 1
        local _, count = api.MIDI_CountEvts(take)
        for n = 0, count - 1 do
          local _, _, muted, s, e, chan, pitch, vel = api.MIDI_GetNote(take, n)
          local qs = math.max(api.MIDI_GetProjQNFromPPQPos(take, s), q0)
          local qe = math.min(api.MIDI_GetProjQNFromPPQPos(take, e), q1)
          -- Drums (GM channel 10) carry no key
          if not muted and chan ~= 9 and qe > qs then
            chroma[pitch % 12 + 1] = chroma[pitch % 12 + 1] + (qe - qs) * vel / 127
            notes = notes + 1
          end
        end
      else
        audio_items = audio_items + 1
      end
    end
  end
  for k = 1, 12 do chroma[k] = r4(chroma[k]) end
  return { chroma = chroma, notes = notes, midiItems = midi_items, audioItems = audio_items }
end

return M
