-- mcp_tracks_lib.lua — track structure and routing (sends, receives,
-- hardware outputs, master send, sidechain channels, groups/VCA).
--
-- Pure logic: every function takes the ReaScript API as `api` and tracks
-- already resolved by the caller, so it runs under a fake API in unit tests.
-- Loaded by mcp_bridge.lua with dofile.

local M = {}

local function to_db(v)
  if v <= 0 then return -150 end
  return 20 * math.log(v, 10)
end

local function from_db(db)
  if db <= -150 then return 0 end
  return 10 ^ (db / 20)
end

local function is_master(api, tr)
  return tr == api.GetMasterTrack(0)
end

local function track_index(api, tr)
  if is_master(api, tr) then return -1 end
  return math.floor(api.GetMediaTrackInfo_Value(tr, "IP_TRACKNUMBER")) - 1
end

local function track_name(api, tr)
  if is_master(api, tr) then return "MASTER" end
  local _, name = api.GetTrackName(tr)
  return name
end

local function label(api, tr)
  return { index = track_index(api, tr), name = track_name(api, tr) }
end

-- ---------------------------------------------------------------------------
-- Colors: "#RRGGBB" <-> REAPER's native color with the custom-color flag.
-- ---------------------------------------------------------------------------

local CUSTOM_COLOR = 0x1000000

function M.parse_color(s)
  if s == nil or s == "" or s == "none" then return 0 end
  local hex = tostring(s):match("^#?(%x%x%x%x%x%x)$")
  if not hex then return nil, "color must be #RRGGBB or \"none\", got '" .. tostring(s) .. "'" end
  return tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
end

local function read_color(api, tr)
  local c = math.floor(api.GetMediaTrackInfo_Value(tr, "I_CUSTOMCOLOR"))
  if c & CUSTOM_COLOR == 0 then return nil end
  local r, g, b = api.ColorFromNative(c & 0xFFFFFF)
  return string.format("#%02X%02X%02X", r, g, b)
end

-- ---------------------------------------------------------------------------
-- Track structure
-- ---------------------------------------------------------------------------

local FOLDER_MODES = { normal = 0, folder = 1, last = -1 }

function M.describe_track(api, tr)
  local out = label(api, tr)
  out.guid = api.GetTrackGUID(tr)
  out.color = read_color(api, tr)
  out.folderDepth = math.floor(api.GetMediaTrackInfo_Value(tr, "I_FOLDERDEPTH"))
  out.folderCollapsed = math.floor(api.GetMediaTrackInfo_Value(tr, "I_FOLDERCOMPACT"))
  out.channels = math.floor(api.GetMediaTrackInfo_Value(tr, "I_NCHAN"))
  out.masterSend = api.GetMediaTrackInfo_Value(tr, "B_MAINSEND") ~= 0
  return out
end

--- add_track: insert at `index` (default: end) with an optional name.
function M.add_track(api, params)
  local count = api.CountTracks(0)
  local at = tonumber(params.index) or count
  if at < 0 or at > count then
    return nil, "index " .. tostring(params.index) .. " is out of range (0-" .. count .. ")"
  end
  api.InsertTrackAtIndex(at, true)
  local tr = api.GetTrack(0, at)
  if params.name and params.name ~= "" then
    api.GetSetMediaTrackInfo_String(tr, "P_NAME", params.name, true)
  end
  return M.describe_track(api, tr)
end

--- delete_track: the master can never be deleted.
function M.delete_track(api, tr)
  if is_master(api, tr) then return nil, "the master track cannot be deleted" end
  local gone = label(api, tr)
  api.DeleteTrack(tr)
  return { deleted = gone, trackCount = api.CountTracks(0) }
end

--- move_track: move one track so it ends up at `to` (0-based, in the final
--- list). Uses ReorderSelectedTracks, so the selection is saved and restored.
function M.move_track(api, tr, to)
  if is_master(api, tr) then return nil, "the master track cannot be moved" end
  local count = api.CountTracks(0)
  to = tonumber(to)
  if not to or to < 0 or to >= count then
    return nil, "toIndex " .. tostring(to) .. " is out of range (0-" .. (count - 1) .. ")"
  end
  local from = track_index(api, tr)
  if from == to then return { track = label(api, tr), moved = false } end

  local saved = {}
  for i = 0, count - 1 do
    local t = api.GetTrack(0, i)
    saved[#saved + 1] = { t, api.IsTrackSelected(t) }
    api.SetTrackSelected(t, t == tr)
  end
  -- "before" is an index in the list as it is now; moving down skips the
  -- moved track's own slot.
  local before = to > from and to + 1 or to
  local ok = api.ReorderSelectedTracks(before, 0)
  for _, s in ipairs(saved) do api.SetTrackSelected(s[1], s[2]) end
  if not ok then return nil, "REAPER refused to move the track" end
  return { track = label(api, tr), moved = true, from = from }
end

--- set_track_folder: mode folder | normal | last (closes the enclosing
--- folder), or a raw depth change; optional collapsed state 0/1/2.
function M.set_track_folder(api, tr, params)
  if is_master(api, tr) then return nil, "the master track cannot be in a folder" end
  local depth = FOLDER_MODES[params.mode or ""]
  if depth == nil then depth = tonumber(params.depth) end
  if depth == nil and params.collapsed == nil then
    return nil, "give mode (folder, normal or last), depth, or collapsed"
  end
  if depth ~= nil then api.SetMediaTrackInfo_Value(tr, "I_FOLDERDEPTH", depth) end
  if params.collapsed ~= nil then
    local c = tonumber(params.collapsed)
    if c == nil or c < 0 or c > 2 then return nil, "collapsed must be 0 (open), 1 (small) or 2 (collapsed)" end
    api.SetMediaTrackInfo_Value(tr, "I_FOLDERCOMPACT", c)
  end
  return M.describe_track(api, tr)
end

--- set_track_info: name, color, channel count, master/parent send. Every
--- value is checked before anything is written.
function M.set_track_info(api, tr, params)
  local r, g, b
  if params.color ~= nil then
    r, g, b = M.parse_color(params.color)
    if r == nil then return nil, g end
  end
  local nchan = params.channels ~= nil and tonumber(params.channels) or nil
  if params.channels ~= nil and (not nchan or nchan < 2 or nchan > 128 or nchan % 2 ~= 0) then
    return nil, "channels must be an even number from 2 to 128"
  end
  if params.name ~= nil and is_master(api, tr) then return nil, "the master track cannot be renamed" end
  if params.masterSend ~= nil and is_master(api, tr) then return nil, "the master track has no master send" end

  if params.name ~= nil then api.GetSetMediaTrackInfo_String(tr, "P_NAME", tostring(params.name), true) end
  if params.color ~= nil then
    local native = g == nil and 0 or (api.ColorToNative(r, g, b) | CUSTOM_COLOR)
    api.SetMediaTrackInfo_Value(tr, "I_CUSTOMCOLOR", native)
  end
  if nchan then api.SetMediaTrackInfo_Value(tr, "I_NCHAN", nchan) end
  if params.masterSend ~= nil then api.SetMediaTrackInfo_Value(tr, "B_MAINSEND", params.masterSend and 1 or 0) end
  return M.describe_track(api, tr)
end

-- ---------------------------------------------------------------------------
-- Routing
-- ---------------------------------------------------------------------------

M.CATEGORIES = { send = 0, receive = -1, hardware = 1 }
local SEND_MODES = { ["post-fader"] = 0, ["pre-fx"] = 1, ["post-fx"] = 3 }
local MODE_NAMES = { [0] = "post-fader", [1] = "pre-fx", [3] = "post-fx" }

local function category(name)
  local c = M.CATEGORIES[name or "send"]
  if c == nil then error("unknown category '" .. tostring(name) .. "' (use send, receive or hardware)", 0) end
  return c
end

-- A channel pair is given as its first channel, 1-based (1 = 1/2, 3 = 3/4).
-- REAPER stores the 0-based offset; -1 on a source means "no audio".
local function chan_offset(first, what)
  if first == nil then return nil end
  local n = tonumber(first)
  if n == -1 and what == "srcChannel" then return -1 end
  if not n or n < 1 or n > 127 or n % 1 ~= 0 then
    return nil, what .. " must be the first channel of the pair, 1-127 (1 = 1/2, 3 = 3/4)"
  end
  return n - 1
end

local function describe_route(api, tr, cat, i)
  local v = function(k) return api.GetTrackSendInfo_Value(tr, cat, i, k) end
  local mode = math.floor(v("I_SENDMODE"))
  local src = math.floor(v("I_SRCCHAN"))
  local dst = math.floor(v("I_DSTCHAN"))
  local out = {
    index = i,
    volume = to_db(v("D_VOL")),
    pan = v("D_PAN"),
    muted = v("B_MUTE") ~= 0,
    mode = MODE_NAMES[mode] or tostring(mode),
    srcChannel = src < 0 and -1 or (src & 0x3FF) + 1,
  }
  if cat == 1 then
    out.outputChannel = (dst & 0x3FF) + 1
    out.mono = dst & 1024 ~= 0
  else
    out.destChannel = (dst & 0x3FF) + 1
    local other = cat == 0 and v("P_DESTTRACK") or v("P_SRCTRACK")
    if other and other ~= 0 then
      local who = label(api, other)
      if cat == 0 then out.destTrack = who else out.srcTrack = who end
    end
  end
  return out
end

--- routing: everything get_track_routing reports beyond the parent/folder.
function M.routing(api, tr)
  local function list(cat)
    local out = {}
    for i = 0, api.GetTrackNumSends(tr, cat) - 1 do out[#out + 1] = describe_route(api, tr, cat, i) end
    return out
  end
  local master_send -- nil on the master, which has none
  if not is_master(api, tr) then master_send = api.GetMediaTrackInfo_Value(tr, "B_MAINSEND") ~= 0 end
  return {
    sends = list(0),
    receives = list(-1),
    hardwareOutputs = list(1),
    masterSend = master_send,
    channels = math.floor(api.GetMediaTrackInfo_Value(tr, "I_NCHAN")),
  }
end

-- Validate and collect the writable send fields; nothing is written here.
local function send_fields(params)
  local f = {}
  if params.volume ~= nil then
    local db = tonumber(params.volume)
    if not db then return nil, "volume must be a number in dB" end
    f.D_VOL = from_db(db)
  end
  if params.pan ~= nil then
    local p = tonumber(params.pan)
    if not p or p < -1 or p > 1 then return nil, "pan must be from -1 to 1" end
    f.D_PAN = p
  end
  if params.mute ~= nil then f.B_MUTE = params.mute and 1 or 0 end
  if params.mode ~= nil then
    f.I_SENDMODE = SEND_MODES[params.mode]
    if f.I_SENDMODE == nil then return nil, "mode must be post-fader, pre-fx or post-fx" end
  end
  local err
  f.I_SRCCHAN, err = chan_offset(params.srcChannel, "srcChannel")
  if err then return nil, err end
  f.I_DSTCHAN, err = chan_offset(params.destChannel, "destChannel")
  if err then return nil, err end
  return f
end

-- Sidechain: a send into channels 3/4 needs a destination with 4+ channels.
local function ensure_channels(api, dest, dst_offset)
  if not dest or not dst_offset or dst_offset < 0 then return end
  local need = dst_offset + 2
  if need % 2 == 1 then need = need + 1 end
  if api.GetMediaTrackInfo_Value(dest, "I_NCHAN") < need then
    api.SetMediaTrackInfo_Value(dest, "I_NCHAN", need)
  end
end

local function apply_fields(api, tr, cat, i, f)
  for _, k in ipairs({ "D_VOL", "D_PAN", "B_MUTE", "I_SENDMODE", "I_SRCCHAN", "I_DSTCHAN" }) do
    if f[k] ~= nil then api.SetTrackSendInfo_Value(tr, cat, i, k, f[k]) end
  end
end

--- add_send: track -> track. Options: volume (dB), pan, mute, mode,
--- srcChannel / destChannel (first channel of a pair; 3 = sidechain 3/4).
function M.add_send(api, src, dest, params)
  if src == dest then return nil, "a track cannot send to itself" end
  if is_master(api, src) then return nil, "the master track cannot send to another track" end
  -- REAPER creates nothing for a send into the master: tracks reach it through B_MAINSEND.
  if is_master(api, dest) then return nil, "a track reaches the master through its master send, not a send: use set_track_info masterSend" end
  local f, err = send_fields(params or {})
  if not f then return nil, err end
  local i = api.CreateTrackSend(src, dest)
  if not i or i < 0 then return nil, "REAPER refused the send" end
  ensure_channels(api, dest, f.I_DSTCHAN)
  apply_fields(api, src, 0, i, f)
  return { track = label(api, src), send = describe_route(api, src, 0, i) }
end

--- add_hardware_output: route a track to an audio output (outputChannel is
--- 1-based; mono uses one channel).
function M.add_hardware_output(api, tr, params)
  local ch = tonumber(params.outputChannel or 1)
  if not ch or ch < 1 or ch > 512 or ch % 1 ~= 0 then return nil, "outputChannel must be 1-512" end
  local f, err = send_fields({ volume = params.volume, pan = params.pan, mute = params.mute, mode = params.mode })
  if not f then return nil, err end
  local i = api.CreateTrackSend(tr, nil)
  if not i or i < 0 then return nil, "REAPER refused the hardware output" end
  f.I_DSTCHAN = (ch - 1) | (params.mono and 1024 or 0)
  apply_fields(api, tr, 1, i, f)
  return { track = label(api, tr), hardwareOutput = describe_route(api, tr, 1, i) }
end

--- set_send: edit an existing send, receive or hardware output by index.
function M.set_send(api, tr, params)
  local cat = category(params.category)
  local i = tonumber(params.index)
  local n = api.GetTrackNumSends(tr, cat)
  if not i or i < 0 or i >= n then
    return nil, (params.category or "send") .. " " .. tostring(params.index) .. " not found on track (it has " .. n .. ")"
  end
  local f, err = send_fields(params)
  if not f then return nil, err end
  if cat == 1 and params.destChannel ~= nil then return nil, "use outputChannel for a hardware output" end
  if cat == 1 and (params.outputChannel ~= nil or params.mono ~= nil) then
    local ch = tonumber(params.outputChannel)
    if params.outputChannel ~= nil and (not ch or ch < 1 or ch > 512) then return nil, "outputChannel must be 1-512" end
    f.I_DSTCHAN = ch and (ch - 1) or (math.floor(api.GetTrackSendInfo_Value(tr, cat, i, "I_DSTCHAN")) & 0x3FF)
    if params.mono ~= nil then f.I_DSTCHAN = f.I_DSTCHAN | (params.mono and 1024 or 0) end
  end
  -- A channel edit moves only the offset (low 10 bits): it keeps the source
  -- width (I_SRCCHAN >> 10) and the destination's mix-to-mono bit (1024).
  local keep = { I_SRCCHAN = ~0x3FF, I_DSTCHAN = 1024 }
  for k, mask in pairs(keep) do
    local cur = math.floor(api.GetTrackSendInfo_Value(tr, cat, i, k))
    if f[k] and f[k] >= 0 and cur >= 0 and not (k == "I_DSTCHAN" and cat == 1 and params.mono ~= nil) then
      f[k] = f[k] | (cur & mask)
    end
  end
  local dst_offset = f.I_DSTCHAN and f.I_DSTCHAN & 0x3FF
  if cat == 0 then ensure_channels(api, api.GetTrackSendInfo_Value(tr, 0, i, "P_DESTTRACK"), dst_offset) end
  if cat == -1 then ensure_channels(api, tr, dst_offset) end
  apply_fields(api, tr, cat, i, f)
  return { track = label(api, tr), [params.category or "send"] = describe_route(api, tr, cat, i) }
end

--- remove_send: remove a send, receive or hardware output by index.
function M.remove_send(api, tr, params)
  local cat = category(params.category)
  local i = tonumber(params.index)
  local n = api.GetTrackNumSends(tr, cat)
  if not i or i < 0 or i >= n then
    return nil, (params.category or "send") .. " " .. tostring(params.index) .. " not found on track (it has " .. n .. ")"
  end
  api.RemoveTrackSend(tr, cat, i)
  return { track = label(api, tr), removed = i, remaining = api.GetTrackNumSends(tr, cat) }
end

-- ---------------------------------------------------------------------------
-- Groups / VCA
-- ---------------------------------------------------------------------------

M.GROUP_ROLES = {
  volume_lead = "VOLUME_LEAD", volume_follow = "VOLUME_FOLLOW",
  vca_lead = "VOLUME_VCA_LEAD", vca_follow = "VOLUME_VCA_FOLLOW",
  pan_lead = "PAN_LEAD", pan_follow = "PAN_FOLLOW",
  mute_lead = "MUTE_LEAD", mute_follow = "MUTE_FOLLOW",
  solo_lead = "SOLO_LEAD", solo_follow = "SOLO_FOLLOW",
  recarm_lead = "RECARM_LEAD", recarm_follow = "RECARM_FOLLOW",
  polarity_lead = "POLARITY_LEAD", polarity_follow = "POLARITY_FOLLOW",
  automode_lead = "AUTOMODE_LEAD", automode_follow = "AUTOMODE_FOLLOW",
}

local function group_call(api, group)
  if group <= 32 then return api.GetSetTrackGroupMembership, 1 << (group - 1) end
  return api.GetSetTrackGroupMembershipHigh, 1 << (group - 33)
end

--- The roles a track has in one group (1-64).
function M.group_roles(api, tr, group)
  local fn, bit = group_call(api, group)
  local roles = {}
  for role, name in pairs(M.GROUP_ROLES) do
    if fn(tr, name, 0, 0) & bit ~= 0 then roles[#roles + 1] = role end
  end
  table.sort(roles)
  return roles
end

--- set_track_group: turn the given roles on (or off with enable = false)
--- for one group. Roles are checked before anything is written.
function M.set_track_group(api, tr, params)
  local group = tonumber(params.group)
  if not group or group < 1 or group > 64 or group % 1 ~= 0 then return nil, "group must be 1-64" end
  if type(params.roles) ~= "table" or #params.roles == 0 then return nil, "roles array required" end
  for _, role in ipairs(params.roles) do
    if not M.GROUP_ROLES[role] then
      local names = {}
      for k in pairs(M.GROUP_ROLES) do names[#names + 1] = k end
      table.sort(names)
      return nil, "unknown role '" .. tostring(role) .. "' (use " .. table.concat(names, ", ") .. ")"
    end
  end
  local fn, bit = group_call(api, group)
  local on = params.enable ~= false
  for _, role in ipairs(params.roles) do fn(tr, M.GROUP_ROLES[role], bit, on and bit or 0) end
  return { track = label(api, tr), group = group, roles = M.group_roles(api, tr, group) }
end

M.is_master = is_master
return M
