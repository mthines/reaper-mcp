-- A fake ReaScript API for timeline edits (mcp_arrange_lib.lua): tracks with items
-- (positions, takes, sources, item state chunks), envelopes with points and automation
-- items, markers/regions and the tempo map. Items are enumerated by position, as REAPER does.
--
-- new_timeline{
--   tracks = { { name = "Gtr", items = { { pos = 0, len = 4, name = "A", level = -12, midi = false } },
--               envs = { { name = "Volume", pts = { { 0, 1 }, { 8, 0.5 } }, ais = { { pos = 2, len = 2 } } } } } },
--   markers = { { pos = 4, name = "Verse" }, { pos = 8, rend = 16, name = "Chorus", rgn = true } },
--   tempo = { { t = 0, bpm = 120 }, { t = 10, bpm = 90 } },
-- }
-- api.writes counts every write; api.undo_labels records each undo block; api.actions records each action.

local guid_n = 0
local function guid()
  guid_n = guid_n + 1
  return string.format("{%08X-0000-0000-0000-%012X}", guid_n, guid_n)
end

function new_timeline(spec)
  spec = spec or {}
  local api = { writes = 0, undo_labels = {}, actions = {} }
  local function write() api.writes = api.writes + 1 end
  local tracks, master = {}, { name = "MASTER", items = {}, envs = {}, master = true }
  local markers, tempo = {}, {}

  local function sort_items(tr) table.sort(tr.items, function(a, b) return a.vals.D_POSITION < b.vals.D_POSITION end) end
  local function new_item(tr, x)
    local it = {
      track = tr, guid = guid(), selected = false, name = x.name or "",
      vals = { D_POSITION = x.pos or 0, D_LENGTH = x.len or 1, D_VOL = x.vol or 1, B_MUTE = 0 },
      take = { guid = guid(), vals = { D_STARTOFFS = x.offs or 0, D_PLAYRATE = 1, D_VOL = x.take_vol or 1 },
        src = { len = x.src_len or ((x.offs or 0) + (x.len or 1)), level = x.level or -12 }, midi = x.midi or false,
        pool = x.midi and guid() or nil, reversed = false },
    }
    return it
  end
  local function new_env(x)
    local env = { name = x.name or "Volume", pts = {}, ais = {} }
    for _, p in ipairs(x.pts or {}) do env.pts[#env.pts + 1] = { t = p[1], v = p[2], shape = 0, tension = 0, sel = false } end
    for _, a in ipairs(x.ais or {}) do env.ais[#env.ais + 1] = { D_POSITION = a.pos, D_LENGTH = a.len, D_UISEL = a.sel and 1 or 0 } end
    return env
  end
  for k, t in ipairs(spec.tracks or {}) do
    local tr = { name = t.name or ("Track " .. k), items = {}, envs = {} }
    for _, x in ipairs(t.items or {}) do tr.items[#tr.items + 1] = new_item(tr, x) end
    for _, e in ipairs(t.envs or {}) do tr.envs[#tr.envs + 1] = new_env(e) end
    sort_items(tr)
    tracks[k] = tr
  end
  for _, e in ipairs(spec.master_envs or {}) do master.envs[#master.envs + 1] = new_env(e) end
  local next_num = { [true] = 0, [false] = 0 }
  for _, m in ipairs(spec.markers or {}) do
    local rgn = m.rgn == true
    next_num[rgn] = next_num[rgn] + 1
    markers[#markers + 1] = { rgn = rgn, pos = m.pos, rend = m.rend or 0, name = m.name or "", num = m.num or next_num[rgn], color = 0 }
  end
  for _, m in ipairs(spec.tempo or {}) do tempo[#tempo + 1] = { t = m.t, bpm = m.bpm, num = m.num or 4, den = m.den or 4, linear = false } end
  api.tracks, api.master, api.markers, api.tempo = tracks, master, markers, tempo

  api.genGuid = function() return guid() end
  api.Undo_BeginBlock = function() end
  api.Undo_EndBlock = function(label) api.undo_labels[#api.undo_labels + 1] = label end
  api.PreventUIRefresh = function() end
  api.UpdateArrange = function() end
  api.UpdateTimeline = function() end

  -- Tracks
  api.CountTracks = function() return #tracks end
  api.GetTrack = function(_, i) return tracks[i + 1] end
  api.GetMasterTrack = function() return master end
  api.GetMediaTrackInfo_Value = function(tr, k)
    if k == "IP_TRACKNUMBER" then
      if tr.master then return -1 end
      for i, t in ipairs(tracks) do if t == tr then return i end end
    end
    return 0
  end

  -- Items
  api.CountTrackMediaItems = function(tr) return #tr.items end
  api.GetTrackMediaItem = function(tr, i) return tr.items[i + 1] end
  api.CountMediaItems = function()
    local n = 0
    for _, tr in ipairs(tracks) do n = n + #tr.items end
    return n
  end
  api.GetMediaItem = function(_, i)
    for _, tr in ipairs(tracks) do
      if i < #tr.items then return tr.items[i + 1] end
      i = i - #tr.items
    end
  end
  api.GetMediaItem_Track = function(it) return it.track end
  api.GetMediaItemInfo_Value = function(it, k) return it.vals[k] or 0 end
  api.SetMediaItemInfo_Value = function(it, k, v)
    it.vals[k] = v
    if k == "D_POSITION" then sort_items(it.track) end
    write()
    return true
  end
  api.GetActiveTake = function(it) return it.take end
  api.TakeIsMIDI = function(tk) return tk.midi end
  api.GetMediaItemTakeInfo_Value = function(tk, k) return tk.vals[k] or 0 end
  api.GetMediaItemTake_Source = function(tk) return tk.src end
  api.GetMediaSourceLength = function(src) return src.len, false end
  -- The level of a source is spec'd per item: with a 0 dB target the gain is the inverted level
  api.CalculateNormalization = function(src, _, target)
    if src.level <= -150 then return 0 end
    return 10 ^ ((target - src.level) / 20)
  end
  api.IsMediaItemSelected = function(it) return it.selected end
  api.SetMediaItemSelected = function(it, on) it.selected = on end
  api.SelectAllMediaItems = function(_, on)
    for _, tr in ipairs(tracks) do for _, it in ipairs(tr.items) do it.selected = on end end
  end
  api.ValidatePtr2 = function(_, it)
    for _, tr in ipairs(tracks) do for _, x in ipairs(tr.items) do if x == it then return true end end end
    return false
  end
  api.AddMediaItemToTrack = function(tr)
    local it = new_item(tr, { pos = 0, len = 0 })
    tr.items[#tr.items + 1] = it
    sort_items(tr)
    write()
    return it
  end
  api.DeleteTrackMediaItem = function(tr, it)
    for i, x in ipairs(tr.items) do
      if x == it then table.remove(tr.items, i); it.deleted = true; write(); return true end
    end
    return false
  end
  api.SplitMediaItem = function(it, pos)
    local p, l = it.vals.D_POSITION, it.vals.D_LENGTH
    if pos <= p + 1e-9 or pos >= p + l - 1e-9 then return nil end
    local right = new_item(it.track, { pos = pos, len = p + l - pos, name = it.name, level = it.take.src.level,
      offs = it.take.vals.D_STARTOFFS + (pos - p), src_len = it.take.src.len, midi = it.take.midi, vol = it.vals.D_VOL })
    right.take.pool = it.take.pool
    it.vals.D_LENGTH = pos - p
    it.track.items[#it.track.items + 1] = right
    sort_items(it.track)
    write()
    return right
  end
  -- Item state: a small chunk with the lines the lib rewrites (GUIDs, the MIDI pool) and the item's data
  api.GetItemStateChunk = function(it)
    local lines = {
      "<ITEM", "POSITION " .. it.vals.D_POSITION, "LENGTH " .. it.vals.D_LENGTH, "VOLPAN " .. it.vals.D_VOL,
      "IGUID " .. it.guid, "NAME " .. it.name, "<TAKE", "  GUID " .. it.take.guid,
      "  SOFFS " .. it.take.vals.D_STARTOFFS, "  SRC " .. it.take.src.len .. " " .. it.take.src.level .. " " .. (it.take.midi and 1 or 0),
    }
    if it.take.pool then lines[#lines + 1] = "  POOLEDEVTS " .. it.take.pool end
    lines[#lines + 1] = "  >"
    lines[#lines + 1] = ">"
    return true, table.concat(lines, "\n")
  end
  api.SetItemStateChunk = function(it, chunk)
    local function get(key) return chunk:match("\n%s*" .. key .. " ([^\n]+)") end
    it.vals.D_POSITION = tonumber(get("POSITION"))
    it.vals.D_LENGTH = tonumber(get("LENGTH"))
    it.vals.D_VOL = tonumber(get("VOLPAN"))
    it.guid, it.name = get("IGUID"), get("NAME")
    it.take.guid = get("GUID")
    it.take.vals.D_STARTOFFS = tonumber(get("SOFFS"))
    local len, level, midi = get("SRC"):match("(%S+) (%S+) (%S+)")
    it.take.src = { len = tonumber(len), level = tonumber(level) }
    it.take.midi = midi == "1"
    it.take.pool = get("POOLEDEVTS")
    sort_items(it.track)
    write()
    return true
  end

  -- Actions: reverse and glue act on the selected items; delete automation items on the selected ones
  api.Main_OnCommand = function(id)
    api.actions[#api.actions + 1] = id
    if id == 41051 then
      for _, tr in ipairs(tracks) do
        for _, it in ipairs(tr.items) do if it.selected then it.take.reversed = not it.take.reversed end end
      end
    elseif id == 41588 then
      for _, tr in ipairs(tracks) do
        local first, last, keep = math.huge, -math.huge, {}
        for _, it in ipairs(tr.items) do
          if it.selected then
            first = math.min(first, it.vals.D_POSITION)
            last = math.max(last, it.vals.D_POSITION + it.vals.D_LENGTH)
            it.deleted = true
          else
            keep[#keep + 1] = it
          end
        end
        if first < math.huge then
          local glued = new_item(tr, { pos = first, len = last - first, name = "glued" })
          glued.selected = true
          keep[#keep + 1] = glued
          tr.items = keep
          sort_items(tr)
        end
      end
    elseif id == 42086 then
      local function sweep(tr)
        for _, env in ipairs(tr.envs) do
          local keep = {}
          for _, ai in ipairs(env.ais) do if ai.D_UISEL == 0 then keep[#keep + 1] = ai end end
          env.ais = keep
        end
      end
      sweep(master)
      for _, tr in ipairs(tracks) do sweep(tr) end
    end
    write()
  end

  -- Envelopes
  local function sort_pts(env) table.sort(env.pts, function(a, b) return a.t < b.t end) end
  api.CountTrackEnvelopes = function(tr) return #tr.envs end
  api.GetTrackEnvelope = function(tr, i) return tr.envs[i + 1] end
  api.CountEnvelopePoints = function(env) return #env.pts end
  api.GetEnvelopePoint = function(env, i)
    local p = env.pts[i + 1]
    if not p then return false end
    return true, p.t, p.v, p.shape, p.tension, p.sel
  end
  api.SetEnvelopePoint = function(env, i, t, v, shape, tension, sel, no_sort)
    local p = env.pts[i + 1]
    p.t, p.v, p.shape, p.tension, p.sel = t, v, shape, tension, sel
    if not no_sort then sort_pts(env) end
    write()
    return true
  end
  api.InsertEnvelopePoint = function(env, t, v, shape, tension, sel, no_sort)
    env.pts[#env.pts + 1] = { t = t, v = v, shape = shape, tension = tension, sel = sel }
    if not no_sort then sort_pts(env) end
    write()
    return true
  end
  api.DeleteEnvelopePointRange = function(env, t0, t1)
    local keep = {}
    for _, p in ipairs(env.pts) do if p.t < t0 or p.t >= t1 then keep[#keep + 1] = p end end
    env.pts = keep
    write()
    return true
  end
  api.DeleteEnvelopePointEx = function(env, ai, i)
    if ai ~= -1 or not env.pts[i + 1] then return false end
    table.remove(env.pts, i + 1)
    write()
    return true
  end
  api.GetEnvelopeName = function(env) return true, env.name end
  api.Envelope_SortPoints = function(env) sort_pts(env) end
  api.Envelope_Evaluate = function(env, t)
    local pts = env.pts
    if #pts == 0 then return 0, 0 end
    if t <= pts[1].t then return 0, pts[1].v end
    for i = 1, #pts - 1 do
      local a, b = pts[i], pts[i + 1]
      if t <= b.t then return 0, a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t) end
    end
    return 0, pts[#pts].v
  end
  api.CountAutomationItems = function(env) return #env.ais end
  api.GetSetAutomationItemInfo = function(env, i, k, v, set)
    local ai = env.ais[i + 1]
    if set then ai[k] = v; write() end
    return ai[k] or 0
  end

  -- Markers and regions, enumerated by position
  local function sorted_markers()
    local list = {}
    for _, m in ipairs(markers) do list[#list + 1] = m end
    table.sort(list, function(a, b) return a.pos < b.pos end)
    return list
  end
  api.CountProjectMarkers = function()
    local nm, nr = 0, 0
    for _, m in ipairs(markers) do if m.rgn then nr = nr + 1 else nm = nm + 1 end end
    return nm + nr, nm, nr
  end
  api.EnumProjectMarkers3 = function(_, i)
    local m = sorted_markers()[i + 1]
    if not m then return 0 end
    return i + 1, m.rgn, m.pos, m.rend, m.name, m.num, m.color
  end
  api.SetProjectMarker4 = function(_, num, rgn, pos, rend, name)
    for _, m in ipairs(markers) do
      if m.rgn == rgn and m.num == num then
        m.pos, m.rend, m.name = pos, rend, name
        write()
        return true
      end
    end
    return false
  end
  api.DeleteProjectMarker = function(_, num, rgn)
    for i, m in ipairs(markers) do
      if m.rgn == rgn and m.num == num then table.remove(markers, i); write(); return true end
    end
    return false
  end

  -- Tempo map (REAPER replaces a marker set onto another one's position)
  api.CountTempoTimeSigMarkers = function() return #tempo end
  api.GetTempoTimeSigMarker = function(_, i)
    local m = tempo[i + 1]
    if not m then return false end
    return true, m.t, 0, 0, m.bpm, m.num, m.den, m.linear
  end
  api.SetTempoTimeSigMarker = function(_, idx, t, _, _, bpm, num, den, linear)
    local m = tempo[idx + 1]
    if not m then return false end
    for k, x in ipairs(tempo) do
      if k ~= idx + 1 and math.abs(x.t - t) < 1e-9 then table.remove(tempo, k); if k < idx + 1 then m = tempo[idx] end break end
    end
    m.t, m.bpm, m.num, m.den, m.linear = t, bpm, num, den, linear
    table.sort(tempo, function(a, b) return a.t < b.t end)
    write()
    return true
  end
  api.DeleteTempoTimeSigMarker = function(_, idx)
    if not tempo[idx + 1] then return false end
    table.remove(tempo, idx + 1)
    write()
    return true
  end

  -- Test helpers: an item's position/length by track and index, and a track's item names
  api.item = function(t, i) local it = tracks[t + 1].items[i + 1]; return it and { it.vals.D_POSITION, it.vals.D_LENGTH, it } end
  api.names = function(t)
    local out = {}
    for _, it in ipairs(tracks[t + 1].items) do out[#out + 1] = it.name .. "@" .. it.vals.D_POSITION end
    return table.concat(out, ",")
  end
  return api
end
