-- =============================================================================
-- MCP Snapshot Manager for REAPER
-- =============================================================================
-- A standalone gfx.* UI for managing mixer snapshots created by the MCP server.
-- Uses only built-in REAPER APIs (no ReaImGui, no SWS required).
--
-- Install: Actions > Show action list > Load ReaScript > select this file > Run
-- =============================================================================

local TITLE = "MCP Snapshot Manager"
local WIN_W = 820
local WIN_H = 520
local PADDING = 10
local ROW_H = 26
local HEADER_H = 34
local BUTTON_H = 32
local BUTTON_W = 120
local FOOTER_H = BUTTON_H + PADDING * 2
local STATUS_H = 22
local LIST_TOP = HEADER_H + PADDING
local LIST_BOTTOM_MARGIN = FOOTER_H + STATUS_H + PADDING
local SCROLL_BAR_W = 14

-- Column widths
local COL_NAME_W = 220
local COL_DESC_W = 280
local COL_DATE_W = 160
local COL_TRACKS_W = 60

-- Colors (R, G, B, A as 0-1 floats)
local C_BG           = { 0.13, 0.13, 0.15, 1.0 }
local C_HEADER_BG    = { 0.18, 0.18, 0.22, 1.0 }
local C_ROW_EVEN     = { 0.15, 0.15, 0.18, 1.0 }
local C_ROW_ODD      = { 0.17, 0.17, 0.20, 1.0 }
local C_ROW_SEL      = { 0.20, 0.38, 0.60, 1.0 }
local C_ROW_HOVER    = { 0.22, 0.22, 0.28, 1.0 }
local C_TEXT         = { 0.90, 0.90, 0.90, 1.0 }
local C_TEXT_DIM     = { 0.55, 0.55, 0.60, 1.0 }
local C_TEXT_SEL     = { 1.00, 1.00, 1.00, 1.0 }
local C_TEXT_HEADER  = { 0.75, 0.75, 0.80, 1.0 }
local C_BTN_NORMAL   = { 0.25, 0.25, 0.30, 1.0 }
local C_BTN_HOVER    = { 0.30, 0.45, 0.65, 1.0 }
local C_BTN_PRESS    = { 0.20, 0.35, 0.55, 1.0 }
local C_BTN_DELETE   = { 0.55, 0.20, 0.20, 1.0 }
local C_BTN_DEL_HOV  = { 0.70, 0.25, 0.25, 1.0 }
local C_BTN_RESTORE  = { 0.20, 0.50, 0.25, 1.0 }
local C_BTN_RES_HOV  = { 0.25, 0.62, 0.30, 1.0 }
local C_DIVIDER      = { 0.30, 0.30, 0.35, 1.0 }
local C_SCROLLBAR    = { 0.35, 0.35, 0.40, 1.0 }
local C_SCROLLTHUMB  = { 0.50, 0.50, 0.58, 1.0 }
local C_STATUS_OK    = { 0.35, 0.75, 0.40, 1.0 }
local C_STATUS_ERR   = { 0.85, 0.35, 0.35, 1.0 }
local C_STATUS_INFO  = { 0.65, 0.65, 0.70, 1.0 }

-- =============================================================================
-- State
-- =============================================================================

local snapshots = {}         -- list of snapshot tables
local selected_idx = 0       -- 1-based, 0 = none
local scroll_offset = 0      -- rows scrolled from top
local hover_row = 0          -- 1-based row under mouse, 0 = none
local hover_btn = nil        -- "save" | "restore" | "delete" | "refresh" | "close"
local btn_pressed = nil
local status_msg = ""
local status_type = "info"   -- "ok" | "err" | "info"
local status_timer = 0
local last_mouse_x = 0
local last_mouse_y = 0
local last_mouse_cap = 0
local mouse_was_down = false
local is_running = true

-- =============================================================================
-- Path helpers (duplicated from mcp_bridge.lua — standalone script)
-- =============================================================================

local function get_snapshot_dir()
  local proj_path = reaper.GetProjectPath()
  if proj_path and proj_path ~= "" then
    return proj_path .. "/.reaper-mcp/snapshots/"
  end
  -- Fallback for unsaved projects: use bridge data dir
  return reaper.GetResourcePath() .. "/Scripts/mcp_bridge_data/snapshots/"
end

local function ensure_snapshot_dir()
  reaper.RecursiveCreateDirectory(get_snapshot_dir(), 0)
end

local function snapshot_path(name)
  local safe = name:gsub("[^%w%-_%.%s]", "_"):gsub("%s+", "_")
  return get_snapshot_dir() .. safe .. ".json"
end

-- =============================================================================
-- Minimal JSON helpers (enough for snapshot format)
-- =============================================================================

local function json_encode_string(s)
  s = tostring(s)
  s = s:gsub('\\', '\\\\')
  s = s:gsub('"', '\\"')
  s = s:gsub('\n', '\\n')
  s = s:gsub('\r', '\\r')
  s = s:gsub('\t', '\\t')
  return '"' .. s .. '"'
end

local function json_encode(val)
  local t = type(val)
  if t == "nil" then
    return "null"
  elseif t == "boolean" then
    return val and "true" or "false"
  elseif t == "number" then
    if val ~= val then return "null" end  -- NaN
    return tostring(val)
  elseif t == "string" then
    return json_encode_string(val)
  elseif t == "table" then
    -- Check if array
    local is_array = true
    local max_i = 0
    for k, _ in pairs(val) do
      if type(k) ~= "number" or k ~= math.floor(k) or k < 1 then
        is_array = false
        break
      end
      if k > max_i then max_i = k end
    end
    if is_array and max_i == #val then
      local parts = {}
      for i = 1, #val do
        parts[i] = json_encode(val[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, v in pairs(val) do
        parts[#parts + 1] = json_encode_string(tostring(k)) .. ":" .. json_encode(v)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

-- Extract a string value from JSON (handles escape sequences)
local function extract_json_string(str, pos)
  local result = {}
  local i = pos
  while i <= #str do
    local ch = str:sub(i, i)
    if ch == '\\' then
      local next_ch = str:sub(i + 1, i + 1)
      if next_ch == '"' then result[#result + 1] = '"'
      elseif next_ch == '\\' then result[#result + 1] = '\\'
      elseif next_ch == 'n' then result[#result + 1] = '\n'
      elseif next_ch == 't' then result[#result + 1] = '\t'
      elseif next_ch == '/' then result[#result + 1] = '/'
      else result[#result + 1] = next_ch
      end
      i = i + 2
    elseif ch == '"' then
      return table.concat(result), i + 1
    else
      result[#result + 1] = ch
      i = i + 1
    end
  end
  return nil, i
end

-- Parse a flat JSON object (sufficient for top-level snapshot metadata)
local function parse_flat_object(str)
  local obj = {}
  local i = 1
  while i <= #str do
    local key_start = str:find('"', i)
    if not key_start then break end
    local key, after_key = extract_json_string(str, key_start + 1)
    if not key then break end
    i = after_key

    local colon = str:find(':', i)
    if not colon then break end
    local val_start = str:match('^%s*()', colon + 1)

    local ch = str:sub(val_start, val_start)
    if ch == '"' then
      local val, next_pos = extract_json_string(str, val_start + 1)
      if val then
        obj[key] = val
        i = next_pos
      else
        i = val_start + 1
      end
    elseif ch == '{' or ch == '[' then
      -- Skip nested objects/arrays — not needed for top-level metadata
      local depth = 1
      local open_c = ch
      local close_c = ch == '{' and '}' or ']'
      local j = val_start + 1
      while j <= #str and depth > 0 do
        local c = str:sub(j, j)
        if c == open_c then depth = depth + 1
        elseif c == close_c then depth = depth - 1 end
        j = j + 1
      end
      -- Store raw (won't be used for top-level display)
      i = j
    else
      -- Number, boolean, null
      local val_end = str:find('[,}%]]', val_start)
      if not val_end then val_end = #str + 1 end
      local raw = str:sub(val_start, val_end - 1):match("^%s*(.-)%s*$")
      if raw == "true" then obj[key] = true
      elseif raw == "false" then obj[key] = false
      elseif raw == "null" then obj[key] = nil
      else obj[key] = tonumber(raw)
      end
      i = val_end
    end
  end
  return obj
end

-- Count tracks in mixerState.tracks array (rough count from string)
local function count_tracks_in_snapshot(content)
  local mixer_start = content:find('"mixerState"')
  if not mixer_start then return nil end
  local tracks_start = content:find('"tracks"', mixer_start)
  if not tracks_start then return nil end
  local arr_start = content:find('%[', tracks_start)
  if not arr_start then return nil end
  -- Count top-level objects in the array
  local count = 0
  local depth = 0
  local i = arr_start
  while i <= #arr_start + 50000 and i <= #content do
    local ch = content:sub(i, i)
    if ch == '[' or ch == '{' then
      depth = depth + 1
      if ch == '{' and depth == 2 then count = count + 1 end
    elseif ch == ']' or ch == '}' then
      depth = depth - 1
      if depth == 0 then break end
    end
    i = i + 1
  end
  return count > 0 and count or nil
end

-- =============================================================================
-- Snapshot I/O
-- =============================================================================

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

local function write_file(path, content)
  local f = io.open(path, "wb")
  if not f then return false end
  f:write(content)
  f:close()
  return true
end

local function load_snapshots()
  ensure_snapshot_dir()
  local snap_dir = get_snapshot_dir()
  local result = {}

  local i = 0
  while true do
    local fn = reaper.EnumerateFiles(snap_dir, i)
    if not fn then break end
    if fn:match("%.json$") then
      local path = snap_dir .. fn
      local content = read_file(path)
      if content then
        local ok, snap = pcall(parse_flat_object, content)
        if ok and snap and snap.name then
          -- Try to count tracks
          local track_count = nil
          pcall(function()
            track_count = count_tracks_in_snapshot(content)
          end)
          result[#result + 1] = {
            name        = snap.name,
            description = snap.description or "",
            timestamp   = tonumber(snap.timestamp) or 0,
            trackCount  = track_count,
            path        = path,
          }
        end
      end
    end
    i = i + 1
  end

  -- Sort by timestamp descending (newest first)
  table.sort(result, function(a, b) return a.timestamp > b.timestamp end)
  return result
end

local function format_timestamp(ts_ms)
  if not ts_ms or ts_ms == 0 then return "Unknown" end
  local ts = math.floor(ts_ms / 1000)
  return os.date("%Y-%m-%d %H:%M", ts)
end

-- =============================================================================
-- Capture mixer state (standalone — duplicated from bridge for self-containment)
-- =============================================================================

local function capture_mixer_state()
  local state = { version = 2, tracks = {} }
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetTrackName(track)
    local vol  = reaper.GetMediaTrackInfo_Value(track, "D_VOL")
    local pan  = reaper.GetMediaTrackInfo_Value(track, "D_PAN")
    local mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE")
    local solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO")
    local color = reaper.GetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR")

    local fx_count = reaper.TrackFX_GetCount(track)
    local fx_states = {}
    for j = 0, fx_count - 1 do
      local enabled = reaper.TrackFX_GetEnabled(track, j)
      local offline = reaper.TrackFX_GetOffline(track, j)
      local _, preset = reaper.TrackFX_GetPreset(track, j)
      local _, fx_name = reaper.TrackFX_GetFXName(track, j)
      local params_data = {}
      local param_count = reaper.TrackFX_GetNumParams(track, j)
      local limit = math.min(param_count, 500)
      for p = 0, limit - 1 do
        params_data[p + 1] = reaper.TrackFX_GetParam(track, j, p)
      end
      fx_states[j + 1] = {
        name = fx_name, enabled = enabled, offline = offline,
        preset = preset or "", params = params_data,
      }
    end

    local send_count = reaper.GetTrackNumSends(track, 0)
    local sends = {}
    for s = 0, send_count - 1 do
      local dest_track = reaper.GetTrackSendInfo_Value(track, 0, s, "P_DESTTRACK")
      local dest_idx = -1
      local dest_name = ""
      if dest_track then
        dest_idx = reaper.GetMediaTrackInfo_Value(dest_track, "IP_TRACKNUMBER") - 1
        local _, dname = reaper.GetTrackName(dest_track)
        dest_name = dname or ""
      end
      sends[s + 1] = {
        destTrackIndex = dest_idx, destTrackName = dest_name,
        volume = reaper.GetTrackSendInfo_Value(track, 0, s, "D_VOL"),
        pan    = reaper.GetTrackSendInfo_Value(track, 0, s, "D_PAN"),
        muted  = reaper.GetTrackSendInfo_Value(track, 0, s, "B_MUTE") ~= 0,
      }
    end

    local fx_enabled = {}
    for j = 1, #fx_states do fx_enabled[j] = fx_states[j].enabled end

    state.tracks[i + 1] = {
      index = i, name = name, color = color,
      volume = vol, pan = pan,
      mute = mute ~= 0, solo = solo ~= 0,
      fx = fx_states, sends = sends, fxEnabled = fx_enabled,
    }
  end
  return state
end

local function do_save_snapshot(name, description)
  ensure_snapshot_dir()
  local timestamp = os.time() * 1000
  local snapshot = {
    name = name,
    description = description or "",
    timestamp = timestamp,
    mixerState = capture_mixer_state(),
  }
  local path = snapshot_path(name)
  local ok = write_file(path, json_encode(snapshot))
  if not ok then
    return false, "Failed to write file: " .. path
  end
  return true, nil
end

local function do_restore_snapshot(snap)
  local content = read_file(snap.path)
  if not content then
    return false, "File not found: " .. snap.path
  end

  -- We need deeper parsing for restore — use the full flat parser on the file
  -- For simplicity, show a message and use the MCP bridge if available;
  -- otherwise we do a best-effort restore.
  local ok_parse, parsed = pcall(parse_flat_object, content)
  if not ok_parse or not parsed then
    return false, "Could not parse snapshot file"
  end

  -- The mixerState is a nested object — not directly accessible via parse_flat_object.
  -- We'll do a targeted string extraction of the "mixerState" block and parse it.
  -- For v2 snapshots this is complex; we perform a simplified restore of
  -- volume/pan/mute/solo from a targeted parse.
  local mixer_block_start = content:find('"mixerState"%s*:%s*{')
  if not mixer_block_start then
    return false, "No mixerState found in snapshot"
  end

  -- Find "tracks" array
  local tracks_start = content:find('"tracks"%s*:%s*%[', mixer_block_start)
  if not tracks_start then
    return false, "No tracks found in snapshot"
  end

  local arr_open = content:find('%[', tracks_start)
  if not arr_open then return false, "Invalid tracks format" end

  -- Extract each track object
  local track_objects = {}
  local depth = 0
  local obj_start = nil
  local i = arr_open

  while i <= #content do
    local ch = content:sub(i, i)
    if ch == '{' then
      depth = depth + 1
      if depth == 1 then obj_start = i end
    elseif ch == '}' then
      depth = depth - 1
      if depth == 0 and obj_start then
        track_objects[#track_objects + 1] = content:sub(obj_start, i)
        obj_start = nil
      end
    elseif ch == ']' and depth == 0 then
      break
    end
    i = i + 1
  end

  if #track_objects == 0 then
    return false, "No track data found in snapshot"
  end

  reaper.Undo_BeginBlock()
  local restored = 0

  for _, track_json in ipairs(track_objects) do
    local ok_t, track_data = pcall(parse_flat_object, track_json)
    if ok_t and track_data and track_data.index then
      local track_idx = tonumber(track_data.index)
      local track = reaper.GetTrack(0, track_idx)
      if track then
        if track_data.volume then
          reaper.SetMediaTrackInfo_Value(track, "D_VOL", tonumber(track_data.volume))
        end
        if track_data.pan then
          reaper.SetMediaTrackInfo_Value(track, "D_PAN", tonumber(track_data.pan))
        end
        if track_data.mute ~= nil then
          local mute_val = (track_data.mute == true or track_data.mute == "true") and 1 or 0
          reaper.SetMediaTrackInfo_Value(track, "B_MUTE", mute_val)
        end
        if track_data.solo ~= nil then
          local solo_val = (track_data.solo == true or track_data.solo == "true") and 1 or 0
          reaper.SetMediaTrackInfo_Value(track, "I_SOLO", solo_val)
        end
        restored = restored + 1
      end
    end
  end

  reaper.Undo_EndBlock("MCP Snapshot Manager: Restore '" .. snap.name .. "'", -1)
  reaper.TrackList_AdjustWindows(false)
  reaper.UpdateArrange()

  return true, nil, restored
end

local function do_delete_snapshot(snap)
  local ok, err = os.remove(snap.path)
  if not ok then
    return false, "Failed to delete: " .. (err or "unknown error")
  end
  return true, nil
end

-- =============================================================================
-- UI helpers
-- =============================================================================

local function set_color(c)
  gfx.r, gfx.g, gfx.b, gfx.a = c[1], c[2], c[3], c[4]
end

local function fill_rect(x, y, w, h)
  gfx.rect(x, y, w, h, 1)
end

local function draw_rect(x, y, w, h)
  gfx.rect(x, y, w, h, 0)
end

local function draw_text(text, x, y, color, align_right, max_w)
  set_color(color or C_TEXT)
  if max_w and max_w > 0 then
    -- Clip text to max_w (simple truncation)
    while #text > 1 do
      local tw, _ = gfx.measurestr(text)
      if tw <= max_w then break end
      text = text:sub(1, -2)
    end
  end
  if align_right then
    local tw, _ = gfx.measurestr(text)
    x = x - tw
  end
  gfx.x, gfx.y = x, y
  gfx.drawstr(text)
end

local function draw_button(label, x, y, w, h, bg_normal, bg_hover, is_hover, is_pressed)
  local bg = bg_normal
  if is_pressed then bg = C_BTN_PRESS
  elseif is_hover then bg = bg_hover or C_BTN_HOVER
  end
  set_color(bg)
  fill_rect(x, y, w, h)
  -- Border
  set_color(C_DIVIDER)
  draw_rect(x, y, w, h)
  -- Label centered
  local tw, th = gfx.measurestr(label)
  draw_text(label, x + math.floor((w - tw) / 2), y + math.floor((h - th) / 2), C_TEXT_SEL)
end

local function point_in_rect(px, py, rx, ry, rw, rh)
  return px >= rx and px < rx + rw and py >= ry and py < ry + rh
end

-- =============================================================================
-- Layout calculations
-- =============================================================================

local function get_list_rect()
  local w = gfx.w
  local h = gfx.h
  local list_x = PADDING
  local list_y = LIST_TOP
  local list_w = w - PADDING * 2
  local list_h = h - LIST_TOP - LIST_BOTTOM_MARGIN - PADDING
  return list_x, list_y, list_w, list_h
end

local function get_visible_rows(list_h)
  return math.floor(list_h / ROW_H)
end

local function get_button_rects()
  local h = gfx.h
  local w = gfx.w
  local btn_y = h - FOOTER_H + math.floor((FOOTER_H - BUTTON_H) / 2)
  local btns = {}
  local x = PADDING

  btns.save = { x = x, y = btn_y, w = BUTTON_W, h = BUTTON_H, label = "Save New" }
  x = x + BUTTON_W + PADDING

  btns.restore = { x = x, y = btn_y, w = BUTTON_W, h = BUTTON_H, label = "Restore" }
  x = x + BUTTON_W + PADDING

  btns.delete = { x = x, y = btn_y, w = BUTTON_W, h = BUTTON_H, label = "Delete" }
  x = x + BUTTON_W + PADDING

  btns.refresh = { x = x, y = btn_y, w = BUTTON_W, h = BUTTON_H, label = "Refresh" }

  -- Close button on right side
  btns.close = { x = w - BUTTON_W - PADDING, y = btn_y, w = BUTTON_W, h = BUTTON_H, label = "Close" }

  return btns
end

-- =============================================================================
-- Status message helpers
-- =============================================================================

local function set_status(msg, stype, duration)
  status_msg = msg
  status_type = stype or "info"
  status_timer = reaper.time_precise() + (duration or 4.0)
end

-- =============================================================================
-- Main draw function
-- =============================================================================

local function draw()
  local w = gfx.w
  local h = gfx.h
  local mx = gfx.mouse_x
  local my = gfx.mouse_y
  local mouse_cap = gfx.mouse_cap
  local mouse_down = (mouse_cap & 1) ~= 0

  -- Background
  set_color(C_BG)
  fill_rect(0, 0, w, h)

  -- Header bar
  set_color(C_HEADER_BG)
  fill_rect(0, 0, w, HEADER_H)
  gfx.setfont(1, "Arial", 16, string.byte('b'))
  draw_text(TITLE, PADDING, math.floor((HEADER_H - 16) / 2), C_TEXT_SEL)
  gfx.setfont(1, "Arial", 12, 0)

  -- Snapshot dir info
  local snap_dir = get_snapshot_dir()
  local dir_label = "Dir: " .. snap_dir
  draw_text(dir_label, PADDING + 200, math.floor((HEADER_H - 12) / 2) + 2, C_TEXT_DIM, false, w - 220 - PADDING)

  -- Column headers
  local lx, ly, lw, lh = get_list_rect()
  local col_header_y = ly - ROW_H - 2
  set_color(C_HEADER_BG)
  fill_rect(lx, col_header_y, lw - SCROLL_BAR_W, ROW_H)
  gfx.setfont(1, "Arial", 11, string.byte('b'))
  local cx = lx + 4
  draw_text("Name", cx, col_header_y + 7, C_TEXT_HEADER)
  cx = cx + COL_NAME_W
  draw_text("Description", cx, col_header_y + 7, C_TEXT_HEADER)
  cx = cx + COL_DESC_W
  draw_text("Saved", cx, col_header_y + 7, C_TEXT_HEADER)
  cx = cx + COL_DATE_W
  draw_text("Tracks", cx, col_header_y + 7, C_TEXT_HEADER)
  gfx.setfont(1, "Arial", 12, 0)

  -- Divider under col headers
  set_color(C_DIVIDER)
  fill_rect(lx, col_header_y + ROW_H - 1, lw, 1)

  -- Snapshot list
  local visible_rows = get_visible_rows(lh)
  local total_rows = #snapshots

  -- Clamp scroll
  local max_scroll = math.max(0, total_rows - visible_rows)
  if scroll_offset > max_scroll then scroll_offset = max_scroll end
  if scroll_offset < 0 then scroll_offset = 0 end

  hover_row = 0

  for row = 1, visible_rows do
    local snap_idx = row + scroll_offset
    local ry = ly + (row - 1) * ROW_H
    if ry + ROW_H > ly + lh then break end

    local row_w = lw - SCROLL_BAR_W

    if snap_idx <= total_rows then
      local snap = snapshots[snap_idx]
      local is_sel = snap_idx == selected_idx
      local is_hov = point_in_rect(mx, my, lx, ry, row_w, ROW_H)

      if is_hov then hover_row = snap_idx end

      -- Row background
      if is_sel then set_color(C_ROW_SEL)
      elseif is_hov then set_color(C_ROW_HOVER)
      elseif row % 2 == 0 then set_color(C_ROW_EVEN)
      else set_color(C_ROW_ODD)
      end
      fill_rect(lx, ry, row_w, ROW_H)

      -- Row content
      local text_color = is_sel and C_TEXT_SEL or C_TEXT
      local dim_color  = is_sel and C_TEXT_SEL or C_TEXT_DIM
      local text_y = ry + math.floor((ROW_H - 12) / 2)

      local cell_x = lx + 4
      draw_text(snap.name, cell_x, text_y, text_color, false, COL_NAME_W - 8)

      cell_x = cell_x + COL_NAME_W
      draw_text(snap.description, cell_x, text_y, dim_color, false, COL_DESC_W - 8)

      cell_x = cell_x + COL_DESC_W
      draw_text(format_timestamp(snap.timestamp), cell_x, text_y, dim_color, false, COL_DATE_W - 8)

      cell_x = cell_x + COL_DATE_W
      local tc_str = snap.trackCount and tostring(snap.trackCount) or "-"
      draw_text(tc_str, cell_x, text_y, dim_color)

      -- Row separator
      set_color(C_DIVIDER)
      fill_rect(lx, ry + ROW_H - 1, row_w, 1)
    else
      -- Empty row
      local bg = (row % 2 == 0) and C_ROW_EVEN or C_ROW_ODD
      set_color(bg)
      fill_rect(lx, ry, row_w, ROW_H)
    end
  end

  -- Empty state message
  if total_rows == 0 then
    local msg = "No snapshots found. Use 'Save New' to create one."
    gfx.setfont(1, "Arial", 13, 0)
    local tw, _ = gfx.measurestr(msg)
    draw_text(msg, lx + math.floor((lw - tw) / 2), ly + math.floor(lh / 2) - 8, C_TEXT_DIM)
    gfx.setfont(1, "Arial", 12, 0)
  end

  -- Scrollbar
  if total_rows > visible_rows then
    local sb_x = lx + lw - SCROLL_BAR_W
    local sb_y = ly
    local sb_h = lh

    set_color(C_SCROLLBAR)
    fill_rect(sb_x, sb_y, SCROLL_BAR_W, sb_h)

    local thumb_h = math.max(20, math.floor(sb_h * visible_rows / total_rows))
    local thumb_y = sb_y + math.floor((sb_h - thumb_h) * scroll_offset / math.max(1, max_scroll))

    set_color(C_SCROLLTHUMB)
    fill_rect(sb_x + 2, thumb_y + 1, SCROLL_BAR_W - 4, thumb_h - 2)
  end

  -- Footer divider
  set_color(C_DIVIDER)
  fill_rect(0, h - FOOTER_H - STATUS_H, w, 1)

  -- Status bar
  local status_y = h - STATUS_H - 2
  set_color(C_BG)
  fill_rect(0, status_y, w, STATUS_H)

  if status_msg ~= "" and reaper.time_precise() < status_timer then
    local sc = C_STATUS_INFO
    if status_type == "ok" then sc = C_STATUS_OK
    elseif status_type == "err" then sc = C_STATUS_ERR
    end
    gfx.setfont(1, "Arial", 11, 0)
    draw_text(status_msg, PADDING, status_y + 4, sc)
    gfx.setfont(1, "Arial", 12, 0)
  end

  -- Footer buttons
  set_color(C_BG)
  fill_rect(0, h - FOOTER_H, w, FOOTER_H)
  set_color(C_DIVIDER)
  fill_rect(0, h - FOOTER_H, w, 1)

  local btns = get_button_rects()
  hover_btn = nil

  local has_selection = selected_idx > 0 and selected_idx <= #snapshots

  for btn_name, btn in pairs(btns) do
    local is_hov = point_in_rect(mx, my, btn.x, btn.y, btn.w, btn.h)
    if is_hov then hover_btn = btn_name end
    local is_press = btn_pressed == btn_name

    -- Disable restore/delete if nothing selected
    local disabled = (btn_name == "restore" or btn_name == "delete") and not has_selection

    local bg_n = C_BTN_NORMAL
    local bg_h = C_BTN_HOVER
    if btn_name == "delete" then
      bg_n = has_selection and C_BTN_DELETE or C_BTN_NORMAL
      bg_h = C_BTN_DEL_HOV
    elseif btn_name == "restore" then
      bg_n = has_selection and C_BTN_RESTORE or C_BTN_NORMAL
      bg_h = C_BTN_RES_HOV
    end

    if disabled then
      set_color({ bg_n[1] * 0.6, bg_n[2] * 0.6, bg_n[3] * 0.6, 1.0 })
      fill_rect(btn.x, btn.y, btn.w, btn.h)
      set_color(C_DIVIDER)
      draw_rect(btn.x, btn.y, btn.w, btn.h)
      local tw, th = gfx.measurestr(btn.label)
      draw_text(btn.label, btn.x + math.floor((btn.w - tw) / 2), btn.y + math.floor((btn.h - th) / 2), C_TEXT_DIM)
    else
      draw_button(btn.label, btn.x, btn.y, btn.w, btn.h, bg_n, bg_h, is_hov and not disabled, is_press)
    end
  end

  -- Mouse interaction
  local mouse_clicked = mouse_was_down and not mouse_down

  if mouse_clicked then
    -- Check if clicked on list row
    if hover_row > 0 and hover_row <= total_rows then
      selected_idx = hover_row
    end

    -- Check button clicks
    if hover_btn and btn_pressed == hover_btn then
      local has_sel = selected_idx > 0 and selected_idx <= #snapshots

      if hover_btn == "save" then
        -- Show save dialog
        local retval, inputs = reaper.GetUserInputs(
          "Save Snapshot", 2,
          "Name:,Description:,extrawidth=200",
          ","
        )
        if retval then
          local fields = {}
          for part in (inputs .. ","):gmatch("([^,]*),") do
            fields[#fields + 1] = part
          end
          local sname = fields[1] and fields[1]:match("^%s*(.-)%s*$") or ""
          local sdesc = fields[2] and fields[2]:match("^%s*(.-)%s*$") or ""
          if sname == "" then
            set_status("Name cannot be empty.", "err")
          else
            local ok, err = do_save_snapshot(sname, sdesc)
            if ok then
              set_status("Saved snapshot: " .. sname, "ok")
              snapshots = load_snapshots()
              -- Select the newly saved snapshot
              for j, s in ipairs(snapshots) do
                if s.name == sname then selected_idx = j; break end
              end
            else
              set_status("Save failed: " .. (err or "unknown error"), "err")
            end
          end
        end

      elseif hover_btn == "restore" and has_sel then
        local snap = snapshots[selected_idx]
        local confirm = reaper.ShowMessageBox(
          "Restore snapshot '" .. snap.name .. "'?\n\nThis will overwrite current mixer state.\nAn undo point will be created.",
          "Restore Snapshot", 1  -- MB_OKCANCEL
        )
        if confirm == 1 then
          local ok, err, count = do_restore_snapshot(snap)
          if ok then
            set_status("Restored '" .. snap.name .. "' (" .. (count or "?") .. " tracks)", "ok")
          else
            set_status("Restore failed: " .. (err or "unknown error"), "err")
          end
        end

      elseif hover_btn == "delete" and has_sel then
        local snap = snapshots[selected_idx]
        local confirm = reaper.ShowMessageBox(
          "Delete snapshot '" .. snap.name .. "'?\n\nThis cannot be undone.",
          "Delete Snapshot", 1  -- MB_OKCANCEL
        )
        if confirm == 1 then
          local ok, err = do_delete_snapshot(snap)
          if ok then
            set_status("Deleted snapshot: " .. snap.name, "ok")
            snapshots = load_snapshots()
            if selected_idx > #snapshots then
              selected_idx = #snapshots
            end
          else
            set_status("Delete failed: " .. (err or "unknown error"), "err")
          end
        end

      elseif hover_btn == "refresh" then
        snapshots = load_snapshots()
        set_status("Refreshed — " .. #snapshots .. " snapshot(s) found.", "info", 2.5)

      elseif hover_btn == "close" then
        is_running = false
      end
    end

    btn_pressed = nil
  end

  if mouse_down and not mouse_was_down then
    -- Start press
    if hover_btn then
      btn_pressed = hover_btn
    end
  end

  mouse_was_down = mouse_down
  last_mouse_x = mx
  last_mouse_y = my
  last_mouse_cap = mouse_cap

  -- Keyboard navigation
  local char = gfx.getchar()
  if char == -1 then
    is_running = false  -- Window closed
  elseif char == 27 then -- Escape
    is_running = false
  elseif char == 1685026670 or char == 30064 then -- Up arrow
    if selected_idx > 1 then
      selected_idx = selected_idx - 1
      if selected_idx <= scroll_offset then
        scroll_offset = selected_idx - 1
      end
    end
  elseif char == 1685026669 or char == 30065 then -- Down arrow
    if selected_idx < #snapshots then
      selected_idx = selected_idx + 1
      local _, _, _, lh2 = get_list_rect()
      local vr = get_visible_rows(lh2)
      if selected_idx > scroll_offset + vr then
        scroll_offset = selected_idx - vr
      end
    end
  elseif char == 13 then -- Enter = restore
    if selected_idx > 0 and selected_idx <= #snapshots then
      local snap = snapshots[selected_idx]
      local ok, err, count = do_restore_snapshot(snap)
      if ok then
        set_status("Restored '" .. snap.name .. "' (" .. (count or "?") .. " tracks)", "ok")
      else
        set_status("Restore failed: " .. (err or "unknown error"), "err")
      end
    end
  elseif char == 6579564 then -- Delete key
    if selected_idx > 0 and selected_idx <= #snapshots then
      local snap = snapshots[selected_idx]
      local confirm = reaper.ShowMessageBox(
        "Delete snapshot '" .. snap.name .. "'?\n\nThis cannot be undone.",
        "Delete Snapshot", 1
      )
      if confirm == 1 then
        local ok, err = do_delete_snapshot(snap)
        if ok then
          set_status("Deleted snapshot: " .. snap.name, "ok")
          snapshots = load_snapshots()
          if selected_idx > #snapshots then selected_idx = #snapshots end
        else
          set_status("Delete failed: " .. (err or "unknown error"), "err")
        end
      end
    end
  end

  -- Mouse wheel scroll
  local wheel = gfx.mouse_wheel
  if wheel ~= 0 then
    local scroll_lines = wheel > 0 and -3 or 3
    scroll_offset = math.max(0, math.min(scroll_offset + scroll_lines, math.max(0, #snapshots - get_visible_rows((select(4, get_list_rect())  )))))
    gfx.mouse_wheel = 0
  end

  gfx.update()
end

-- =============================================================================
-- Defer loop
-- =============================================================================

local function loop()
  if not is_running then
    gfx.quit()
    return
  end
  draw()
  reaper.defer(loop)
end

-- =============================================================================
-- Initialization
-- =============================================================================

gfx.init(TITLE, WIN_W, WIN_H, 0)
gfx.setfont(1, "Arial", 12, 0)

snapshots = load_snapshots()
if #snapshots > 0 then
  selected_idx = 1
end

set_status("Loaded " .. #snapshots .. " snapshot(s) from " .. get_snapshot_dir(), "info", 5.0)

reaper.defer(loop)
