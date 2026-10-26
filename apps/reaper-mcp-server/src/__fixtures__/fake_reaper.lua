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
    table.insert(tracks, math.min(i, #tracks) + 1, new_track("")) -- REAPER clamps past the end
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

  -- Routing: category 0 = sends (tr.sends), -1 = receives (the same objects
  -- in the destination's tr.recvs), 1 = hardware outputs (tr.hw).
  local function route_list(tr, cat)
    if cat == -1 then tr.recvs = tr.recvs or {}; return tr.recvs end
    if cat == 1 then tr.hw = tr.hw or {}; return tr.hw end
    return tr.sends
  end
  api.CreateTrackSend = function(src, dst)
    local s = { src = src, dst = dst, D_VOL = 1, D_PAN = 0, B_MUTE = 0, I_SENDMODE = 0, I_SRCCHAN = 0, I_DSTCHAN = 0 }
    write("create_send")
    if dst == nil then
      local hw = route_list(src, 1)
      hw[#hw + 1] = s
      return #hw - 1
    end
    src.sends[#src.sends + 1] = s
    local r = route_list(dst, -1)
    r[#r + 1] = s
    return #src.sends - 1
  end
  api.GetTrackNumSends = function(tr, cat) return #route_list(tr, cat) end
  api.SetTrackSendInfo_Value = function(tr, cat, s, k, v)
    local snd = route_list(tr, cat)[s + 1]
    if not snd then return false end
    snd[k] = v
    write("send " .. k)
    return true
  end
  api.GetTrackSendInfo_Value = function(tr, cat, s, k)
    local snd = route_list(tr, cat)[s + 1]
    if not snd then return 0 end
    if k == "P_DESTTRACK" then return snd.dst end
    if k == "P_SRCTRACK" then return snd.src end
    return snd[k] or 0
  end
  api.RemoveTrackSend = function(tr, cat, s)
    local list = route_list(tr, cat)
    local snd = list[s + 1]
    if not snd then return false end
    for _, owner in ipairs({ { snd.src, 0 }, { snd.dst, -1 }, { snd.src, 1 } }) do
      if owner[1] then
        local l = route_list(owner[1], owner[2])
        for j = #l, 1, -1 do if l[j] == snd then table.remove(l, j) end end
      end
    end
    write("remove_send")
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

  -- Actions: spec.actions = { [section] = { { id, name, named = "abc",
  --   toggle = 0|1, shortcuts = { "Cmd+T" }, on_run = fn(api) } } }
  -- spec.midi_editor = true opens a MIDI editor.
  local actions = spec.actions or {}
  api.ran = {}
  local function find_action(sec, id)
    for _, a in ipairs(actions[sec] or {}) do if a.id == id then return a end end
  end
  local function any_action(id)
    for _, list in pairs(actions) do
      for _, a in ipairs(list) do if a.id == id then return a end end
    end
  end
  local function run(sec, id)
    local a = find_action(sec, id)
    api.ran[#api.ran + 1] = { section = sec, id = id }
    write("action " .. id)
    if a and a.toggle and a.toggle >= 0 then a.toggle = 1 - a.toggle end
    if a and a.on_run then a.on_run(api) end
  end
  api.SectionFromUniqueID = function(sec) return { sec = sec } end
  api.kbd_enumerateActions = function(h, i)
    local a = (actions[h.sec] or {})[i + 1]
    if not a then return 0, "" end
    return a.id, a.name
  end
  api.kbd_getTextFromCmd = function(id, h)
    local a = find_action(h.sec, id)
    return a and a.name or ""
  end
  api.NamedCommandLookup = function(s)
    local want = s:sub(1, 1) == "_" and s:sub(2) or s
    for _, list in pairs(actions) do
      for _, a in ipairs(list) do if a.named == want then return a.id end end
    end
    return 0
  end
  api.ReverseNamedCommandLookup = function(id)
    local a = any_action(id)
    return a and a.named or nil
  end
  api.GetToggleCommandStateEx = function(sec, id)
    local a = find_action(sec, id)
    return a and a.toggle or -1
  end
  api.CountActionShortcuts = function(h, id)
    local a = find_action(h.sec, id)
    return a and a.shortcuts and #a.shortcuts or 0
  end
  api.GetActionShortcutDesc = function(h, id, k)
    return true, find_action(h.sec, id).shortcuts[k + 1]
  end
  api.Main_OnCommandEx = function(id) run(0, id) end
  api.MIDIEditor_GetActive = function() return spec.midi_editor and "editor" or nil end
  api.MIDIEditor_OnCommand = function(_, id) run(32060, id) end
  api.MIDIEditor_LastFocused_OnCommand = function(id) run(32061, id) end
  api.UpdateArrange = function() end
  -- spec.project_path: "" (default) is a project that was never saved.
  api.EnumProjects = function() return "proj", spec.project_path or "" end

  -- Selection and items: tracks take `items = n` in the spec.
  for k, t in ipairs(spec.tracks or {}) do
    tracks[k].selected = t.selected or false
    tracks[k].items = {}
    for j = 1, t.items or 0 do tracks[k].items[j] = { selected = false } end
  end
  api.SetTrackSelected = function(tr, on) tr.selected = on; write("select_track") end
  api.IsTrackSelected = function(tr) return tr.selected == true end
  api.CountTrackMediaItems = function(tr) return #(tr.items or {}) end
  api.GetTrackMediaItem = function(tr, j) return (tr.items or {})[j + 1] end
  api.SelectAllMediaItems = function(_, on)
    for _, tr in ipairs(tracks) do
      for _, it in ipairs(tr.items or {}) do it.selected = on end
    end
    write("select_all_items")
  end
  api.SetMediaItemSelected = function(it, on) it.selected = on; write("select_item") end
  api.IsMediaItemSelected = function(it) return it.selected == true end
  -- Master track, structure, color and groups.
  local master = new_track("MASTER")
  master.is_master = true
  api.master = master
  api.GetMasterTrack = function() return master end
  local plain_get = api.GetTrack
  api.GetTrack = function(p, i)
    if i == -1 and spec.minus_one_is_master then return master end
    return plain_get(p, i)
  end
  local function index_of(tr)
    for k, t in ipairs(tracks) do if t == tr then return k - 1 end end
    return nil
  end
  api.GetMediaTrackInfo_Value = function(tr, k)
    if k == "IP_TRACKNUMBER" then
      if tr.is_master then return -1 end
      local i = index_of(tr)
      return i and i + 1 or 0
    end
    if k == "I_NCHAN" then return tr.vals[k] or 2 end
    if k == "B_MAINSEND" then return tr.vals[k] or 1 end
    return tr.vals[k] or 0
  end
  api.ValidatePtr2 = function(_, tr) return tr == master or index_of(tr) ~= nil end
  api.DeleteTrack = function(tr)
    local i = index_of(tr)
    if i then table.remove(tracks, i + 1); write("delete_track") end
  end
  -- ReorderSelectedTracks(beforeTrackIdx, makePrevFolder): moves the selected
  -- tracks, in order, to before the track that is at beforeTrackIdx now.
  api.ReorderSelectedTracks = function(before)
    local moving, rest = {}, {}
    local anchor = tracks[before + 1]
    for _, t in ipairs(tracks) do
      if t.selected then moving[#moving + 1] = t else rest[#rest + 1] = t end
    end
    if #moving == 0 then return false end
    local at = #rest + 1
    if anchor and not anchor.selected then
      for k, t in ipairs(rest) do if t == anchor then at = k end end
    end
    for k, t in ipairs(moving) do table.insert(rest, at + k - 1, t) end
    for k = 1, #tracks do tracks[k] = rest[k] end
    write("reorder")
    return true
  end
  api.ColorToNative = function(r, g, b) return r + g * 256 + b * 65536 end
  api.ColorFromNative = function(c) return c % 256, (c // 256) % 256, (c // 65536) % 256 end
  -- Groups: tr.groups[name] is a 32-bit mask (low = groups 1-32, high = 33-64).
  local function membership(tr, high, name, mask, value)
    tr.groups = tr.groups or {}
    local key = (high and "H:" or "L:") .. name
    local cur = tr.groups[key] or 0
    if mask ~= 0 then
      cur = (cur & ~mask) | (value & mask)
      tr.groups[key] = cur
      write("group " .. name)
    end
    return cur
  end
  api.GetSetTrackGroupMembership = function(tr, name, mask, value) return membership(tr, false, name, mask, value) end
  api.GetSetTrackGroupMembershipHigh = function(tr, name, mask, value) return membership(tr, true, name, mask, value) end
  api.TrackList_AdjustWindows = function() end
  api.GetParentTrack = function() return nil end

  install_project_fake(api, spec, write)
  return api
end

-- ---------------------------------------------------------------------------
-- Project state for mcp_project_lib.lua: markers, tempo map, project info,
-- render settings, undo/redo that restores state, and a fake file system.
--
-- spec.project = { tempo = 120, markers = { { pos, name, rgn = true, rend, color } },
--                  tempo_markers = { { time, bpm, num, den } }, info = {}, strings = {} }
-- spec.fs      = new_fs{ files = { "/a.rpp" }, dirs = { "/tmp" } }
-- ---------------------------------------------------------------------------

function new_fs(spec)
  spec = spec or {}
  local fs = { files = {}, dirs = {}, removed = {} }
  for _, f in ipairs(spec.files or {}) do fs.files[f] = true end
  for _, d in ipairs(spec.dirs or {}) do fs.dirs[d] = true end
  fs.exists = function(p) return fs.files[p] == true end
  fs.dir_exists = function(p) return fs.dirs[p] == true end
  fs.remove = function(p) fs.files[p] = nil; fs.removed[#fs.removed + 1] = p end
  return fs
end

local function deep_copy(v)
  if type(v) ~= "table" then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = deep_copy(x) end
  return out
end

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function b64encode(s)
  local out = {}
  for i = 1, #s, 3 do
    local a, b, c = s:byte(i, i + 2)
    local n = (a << 16) | ((b or 0) << 8) | (c or 0)
    for k = 3, 0, -1 do
      local idx = (n >> (k * 6)) & 63
      out[#out + 1] = B64:sub(idx + 1, idx + 1)
    end
    if not b then out[#out - 1] = "="; out[#out] = "=" elseif not c then out[#out] = "=" end
  end
  return table.concat(out)
end

local EXT = { evaw = ".wav", ffia = ".aif", calf = ".flac", l3pm = ".mp3", vggo = ".ogg", SggO = ".opus" }

function install_project_fake(api, spec, write)
  local sp = spec.project or {}
  local proj = {
    path = spec.project_path or "",
    tempo = sp.tempo or 120, num = 4, den = 4,
    markers = {}, tempo_markers = {},
    info = { PROJECT_SRATE = 44100, PROJECT_SRATE_USE = 0, RENDER_BOUNDSFLAG = 1, RENDER_STARTPOS = 0,
      RENDER_ENDPOS = 0, RENDER_SRATE = 0, RENDER_CHANNELS = 2, RENDER_SETTINGS = 0 },
    strings = { RENDER_FILE = "", RENDER_PATTERN = "untitled", RENDER_FORMAT = b64encode("evaw\0\0\0\0"),
      PROJECT_TITLE = "", PROJECT_AUTHOR = "" },
    notes = "", ["repeat"] = 0, loop = { 0, 0 },
  }
  for k, v in pairs(sp.info or {}) do proj.info[k] = v end
  for k, v in pairs(sp.strings or {}) do proj.strings[k] = v end
  local next_num = { [false] = 1, [true] = 1 }
  for _, m in ipairs(sp.markers or {}) do
    local rgn = m.rgn == true
    local num = m.num or next_num[rgn]
    next_num[rgn] = math.max(next_num[rgn], num + 1)
    proj.markers[#proj.markers + 1] = { rgn = rgn, pos = m.pos, rend = m.rend or 0, name = m.name or "", num = num, color = m.color or 0 }
  end
  for _, t in ipairs(sp.tempo_markers or {}) do
    proj.tempo_markers[#proj.tempo_markers + 1] = { time = t.time, bpm = t.bpm, num = t.num or 0, den = t.den or 0, linear = false }
  end
  api.project = proj
  api.fs = spec.fs or new_fs()
  api.metronome = spec.metronome or 0 -- global, not project state: undo leaves it
  api.commands = {}
  local function P() return api.project end

  -- Undo/redo that restores the project state captured around each block.
  api.redo = {}
  api.undo_states = {}
  local begin = api.Undo_BeginBlock
  api.Undo_BeginBlock = function() begin(); api.block_before = deep_copy(P()) end
  local finish = api.Undo_EndBlock
  api.Undo_EndBlock = function(label, flags)
    local dirty = api.block_dirty
    finish(label, flags)
    if dirty then
      api.undo_states[#api.undo] = { before = api.block_before, after = deep_copy(P()) }
      api.redo = {}
    end
  end
  api.Undo_DoUndo2 = function()
    local n = #api.undo
    local st = api.undo_states[n]
    api.undone = table.remove(api.undo)
    api.undo_states[n] = nil
    if st then api.project = deep_copy(st.before) end
    if api.undone then api.redo[#api.redo + 1] = { label = api.undone, state = st } end
    return 1
  end
  api.Undo_CanRedo2 = function() local r = api.redo[#api.redo]; return r and r.label end
  api.Undo_DoRedo2 = function()
    local r = table.remove(api.redo)
    if not r then return 0 end
    api.undo[#api.undo + 1] = r.label
    api.undo_states[#api.undo] = r.state
    if r.state then api.project = deep_copy(r.state.after) end
    return 1
  end
  api.UpdateTimeline = function() end

  api.EnumProjects = function() return "proj", P().path end
  api.Main_SaveProject = function()
    if P().path == "" then error("fake: Main_SaveProject on an unsaved project opens a dialog") end
    api.fs.files[P().path] = true
    api.saved = (api.saved or 0) + 1
  end
  api.Main_SaveProjectEx = function(_, path)
    api.fs.files[path] = true
    api.saved = (api.saved or 0) + 1
  end

  local function targets()
    local s = P().strings
    local fourcc = s.RENDER_FORMAT
    for cc in pairs(EXT) do if b64encode(cc .. "\0\0\0\0") == fourcc then fourcc = cc end end
    local ext = EXT[fourcc] or ".wav"
    if s.RENDER_PATTERN == "" then return "" end
    local dir = s.RENDER_FILE
    return (dir ~= "" and (dir .. "/") or "") .. s.RENDER_PATTERN .. ext
  end
  api.GetSetProjectInfo = function(_, key, val, set)
    if set then P().info[key] = val; write("info " .. key) end
    return P().info[key] or 0
  end
  api.GetSetProjectInfo_String = function(_, key, val, set)
    if key == "RENDER_TARGETS" then return true, targets() end
    if set then
      if key == "RENDER_FORMAT" and #val == 4 then val = b64encode(val .. "\0\0\0\0") end
      P().strings[key] = val
      write("string " .. key)
    end
    return true, P().strings[key] or ""
  end
  api.GetSetProjectNotes = function(_, set, notes)
    if set then P().notes = notes; write("notes") end
    return P().notes
  end
  api.GetSetRepeatEx = function(_, v)
    if v >= 0 then P()["repeat"] = v; api.writes = api.writes + 1 end
    return P()["repeat"]
  end
  api.GetToggleCommandState = function(id) return id == 40364 and api.metronome or -1 end
  api.Main_OnCommand = function(id)
    api.commands[#api.commands + 1] = id
    if id == 40364 then api.metronome = 1 - api.metronome; api.writes = api.writes + 1 end
    if id == 42230 then
      local t = targets()
      if t ~= "" then api.fs.files[t] = true end
      api.writes = api.writes + 1
    end
  end
  api.GetSet_LoopTimeRange = function(set, _, s, e)
    if set then P().loop = { s, e } end
    return P().loop[1], P().loop[2]
  end

  -- Tempo map
  api.Master_GetTempo = function()
    local t = P().tempo_markers[1]
    return t and t.bpm or P().tempo
  end
  api.TimeMap_GetTimeSigAtTime = function() return 0, P().num, P().den, api.Master_GetTempo() end
  api.SetCurrentBPM = function(_, bpm) P().tempo = bpm; write("tempo") end
  api.CountTempoTimeSigMarkers = function() return #P().tempo_markers end
  api.GetTempoTimeSigMarker = function(_, i)
    local t = P().tempo_markers[i + 1]
    if not t then return false, 0, 0, 0, 0, 0, 0, false end
    return true, t.time, 0, 0, t.bpm, t.num, t.den, t.linear
  end
  api.SetTempoTimeSigMarker = function(_, idx, time, _, _, bpm, num, den, linear)
    local list = P().tempo_markers
    local m = { time = time, bpm = bpm, num = num, den = den, linear = linear }
    if idx == -1 then list[#list + 1] = m
    elseif list[idx + 1] then list[idx + 1] = m
    else return false end
    table.sort(list, function(a, b) return a.time < b.time end)
    write("tempo_marker")
    return true
  end
  api.DeleteTempoTimeSigMarker = function(_, idx)
    if not P().tempo_markers[idx + 1] then return false end
    table.remove(P().tempo_markers, idx + 1)
    write("delete_tempo_marker")
    return true
  end

  -- Markers and regions (sorted by position, as REAPER enumerates them)
  local function sorted()
    local list = {}
    for _, m in ipairs(P().markers) do list[#list + 1] = m end
    table.sort(list, function(a, b) return a.pos < b.pos end)
    return list
  end
  api.CountProjectMarkers = function()
    local nm, nr = 0, 0
    for _, m in ipairs(P().markers) do if m.rgn then nr = nr + 1 else nm = nm + 1 end end
    return nm + nr, nm, nr
  end
  api.EnumProjectMarkers3 = function(_, i)
    local m = sorted()[i + 1]
    if not m then return 0 end
    return i + 1, m.rgn, m.pos, m.rend, m.name, m.num, m.color
  end
  api.SetProjectMarker4 = function(_, num, rgn, pos, rend, name, color, flags)
    for _, m in ipairs(P().markers) do
      if m.rgn == rgn and m.num == num then
        m.pos, m.rend = pos, rend
        if name ~= "" or (flags & 1) == 1 then m.name = name end
        if color ~= 0 then m.color = color end
        write("set_marker")
        return true
      end
    end
    return false
  end
end
