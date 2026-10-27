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
local COL_HEADER_H = 28
local BUTTON_H = 32
local BUTTON_W = 120
local FOOTER_H = BUTTON_H + PADDING * 2
local STATUS_H = 22
local LIST_TOP = COL_HEADER_H + PADDING
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
local selected = {}          -- set: { [snapshot_index] = true } for multi-select
local selected_idx = 0       -- 1-based "lead" row (last clicked); 0 = none
local sel_anchor = 0         -- anchor row for Shift+click range selection; 0 = none
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
local last_click_time = 0      -- reaper.time_precise() of the last row click
local last_click_row = 0       -- which row that click landed on (1-based)
local DOUBLE_CLICK_SECS = 0.4  -- max gap between clicks to count as a double-click

-- =============================================================================
-- Shared snapshot library — single source of truth for save/restore/list, so
-- the GUI performs the SAME full restore (FX params, sends) as the MCP tools
-- and the next/prev action scripts. Installed alongside this file by `setup`.
-- =============================================================================

local _info = debug.getinfo(1, "S")
local _script_dir = _info.source:match("@?(.*[\\/])")
local lib = dofile(_script_dir .. "mcp_snapshot_lib.lua")

-- =============================================================================
-- Snapshot logic — delegated to the shared library (single source of truth).
-- The GUI no longer carries its own JSON/capture/restore code; it uses the same
-- full restore (FX params + sends) as the MCP tools and the action scripts.
-- =============================================================================

local get_snapshot_dir = lib.get_snapshot_dir
local load_snapshots   = lib.load_snapshots

local function format_timestamp(ts_ms)
  if not ts_ms or ts_ms == 0 then return "Unknown" end
  return os.date("%Y-%m-%d %H:%M", math.floor(ts_ms / 1000))
end

local function do_save_snapshot(name, description)
  return lib.save_snapshot(name, description)
end

local function do_restore_snapshot(snap)
  return lib.restore_snapshot(snap)
end

local function do_delete_snapshot(snap)
  return lib.delete_snapshot(snap)
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
-- Selection model (multi-select). `selected` is the set of chosen rows;
-- `selected_idx` is the lead row (used for restore/double-click/keyboard nav).
-- =============================================================================

local function clear_selection()
  selected = {}
  selected_idx = 0
  sel_anchor = 0
end

local function select_single(idx)
  selected = { [idx] = true }
  selected_idx = idx
  sel_anchor = idx
end

local function toggle_select(idx)
  if selected[idx] then
    selected[idx] = nil
    if selected_idx == idx then            -- lead removed; pick any remaining
      selected_idx = 0
      for i in pairs(selected) do selected_idx = i; break end
    end
  else
    selected[idx] = true
    selected_idx = idx
  end
  sel_anchor = idx
end

local function select_range(a, b)
  selected = {}
  local lo, hi = math.min(a, b), math.max(a, b)
  for i = lo, hi do selected[i] = true end
  selected_idx = b
end

-- =============================================================================
-- Actions (single implementation shared by button, keyboard, and double-click)
-- =============================================================================

local function restore_selected()
  if selected_idx <= 0 or selected_idx > #snapshots then return end
  local snap = snapshots[selected_idx]
  -- No confirmation: restore applies immediately. It is a single undoable action
  -- (Ctrl+Z reverts it), which is what makes fast A/B-ing snapshots practical.
  local ok, err, count, warnings = do_restore_snapshot(snap)
  if ok then
    local nwarn = warnings and #warnings or 0
    local suffix = nwarn > 0 and (", " .. nwarn .. " warning(s) — see console") or ""
    set_status("Restored '" .. snap.name .. "' (" .. (count or "?") .. " tracks" .. suffix .. ")", "ok")
    if nwarn > 0 then
      reaper.ShowConsoleMsg("Restore '" .. snap.name .. "' warnings:\n  " ..
        table.concat(warnings, "\n  ") .. "\n")
    end
  else
    set_status("Restore failed: " .. (err or "unknown error"), "err")
  end
end

local function delete_selected()
  -- Collect the chosen snapshots (resolve to objects before the list reloads).
  local victims = {}
  for i in pairs(selected) do
    if snapshots[i] then victims[#victims + 1] = snapshots[i] end
  end
  if #victims == 0 then return end

  local prompt
  if #victims == 1 then
    prompt = "Delete snapshot '" .. victims[1].name .. "'?\n\nThis cannot be undone."
  else
    prompt = "Delete " .. #victims .. " snapshots?\n\nThis cannot be undone."
  end
  if reaper.ShowMessageBox(prompt, "Delete Snapshot", 1) ~= 1 then return end  -- MB_OKCANCEL

  local deleted, failed = 0, 0
  for _, snap in ipairs(victims) do
    local ok = do_delete_snapshot(snap)
    if ok then deleted = deleted + 1 else failed = failed + 1 end
  end

  clear_selection()
  snapshots = load_snapshots()
  if failed > 0 then
    set_status("Deleted " .. deleted .. ", " .. failed .. " failed", "err")
  else
    set_status("Deleted " .. deleted .. " snapshot(s)", "ok")
  end
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

  -- Column headers (title is already in the window title bar)
  local lx, ly, lw, lh = get_list_rect()
  set_color(C_HEADER_BG)
  fill_rect(0, 0, w, COL_HEADER_H)
  gfx.setfont(1, "Arial", 11, string.byte('b'))
  local col_text_y = math.floor((COL_HEADER_H - 11) / 2)
  local cx = PADDING + 4
  draw_text("Name", cx, col_text_y, C_TEXT_HEADER)
  cx = cx + COL_NAME_W
  draw_text("Description", cx, col_text_y, C_TEXT_HEADER)
  cx = cx + COL_DESC_W
  draw_text("Saved", cx, col_text_y, C_TEXT_HEADER)
  cx = cx + COL_DATE_W
  draw_text("Tracks", cx, col_text_y, C_TEXT_HEADER)
  gfx.setfont(1, "Arial", 12, 0)

  -- Divider under col headers
  set_color(C_DIVIDER)
  fill_rect(0, COL_HEADER_H - 1, w, 1)

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
      local is_sel = selected[snap_idx] == true
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
    local msg = "No snapshots found. Click 'Save New' to capture your current mixer state."
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

  gfx.setfont(1, "Arial", 11, 0)
  if status_msg ~= "" and reaper.time_precise() < status_timer then
    local sc = C_STATUS_INFO
    if status_type == "ok" then sc = C_STATUS_OK
    elseif status_type == "err" then sc = C_STATUS_ERR
    end
    draw_text(status_msg, PADDING, status_y + 4, sc)
  else
    -- Default info: what snapshots contain
    draw_text("Snapshots store: track volumes, pans, mute/solo, FX chains (params + presets), and send levels", PADDING, status_y + 4, C_TEXT_DIM)
  end
  gfx.setfont(1, "Arial", 12, 0)

  -- Footer buttons
  set_color(C_BG)
  fill_rect(0, h - FOOTER_H, w, FOOTER_H)
  set_color(C_DIVIDER)
  fill_rect(0, h - FOOTER_H, w, 1)

  local btns = get_button_rects()
  hover_btn = nil

  local has_selection = next(selected) ~= nil

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
      local now = reaper.time_precise()
      local is_double = (hover_row == last_click_row)
        and (now - last_click_time) < DOUBLE_CLICK_SECS
      -- Modifier keys (cross-platform): Cmd(32)/Ctrl(4) = toggle, Shift(8) = range.
      local toggle_mod = (mouse_cap & 4) ~= 0 or (mouse_cap & 32) ~= 0
      local shift_mod  = (mouse_cap & 8) ~= 0

      if is_double then
        -- Double-click a row = restore it immediately (acts on the one row).
        select_single(hover_row)
        last_click_time = 0  -- reset so a third click doesn't chain
        last_click_row = 0
        restore_selected()
      else
        if shift_mod and sel_anchor > 0 then
          select_range(sel_anchor, hover_row)   -- contiguous range from anchor
        elseif toggle_mod then
          toggle_select(hover_row)              -- add/remove this row
        else
          select_single(hover_row)              -- plain click: just this row
        end
        last_click_time = now
        last_click_row = hover_row
      end
    end

    -- Check button clicks
    if hover_btn and btn_pressed == hover_btn then
      local has_sel = next(selected) ~= nil

      if hover_btn == "save" then
        -- Generate default name: "Snapshot N" where N is the next available index
        local next_idx = #snapshots + 1
        for _, s in ipairs(snapshots) do
          local num = s.name:match("^Snapshot (%d+)$")
          if num then next_idx = math.max(next_idx, tonumber(num) + 1) end
        end
        local default_name = "Snapshot " .. next_idx

        -- Show save dialog with default name pre-filled
        local retval, inputs = reaper.GetUserInputs(
          "Save Snapshot", 2,
          "Name (leave default for auto-name):,Description (optional):,extrawidth=200",
          default_name .. ","
        )
        if retval then
          local fields = {}
          for part in (inputs .. ","):gmatch("([^,]*),") do
            fields[#fields + 1] = part
          end
          local sname = fields[1] and fields[1]:match("^%s*(.-)%s*$") or ""
          local sdesc = fields[2] and fields[2]:match("^%s*(.-)%s*$") or ""
          if sname == "" then sname = default_name end
          -- Warn before clobbering an existing snapshot (names sanitize to a
          -- filename, so distinct names can also collide to the same file).
          local proceed = true
          if lib.snapshot_exists(sname) then
            proceed = reaper.ShowMessageBox(
              "A snapshot named '" .. sname .. "' already exists.\n\nOverwrite it?",
              "Overwrite Snapshot", 1  -- MB_OKCANCEL
            ) == 1
          end
          local ok, err
          if proceed then ok, err = do_save_snapshot(sname, sdesc) end
          if not proceed then
            set_status("Save cancelled (name already exists).", "info")
          elseif ok then
            set_status("Saved snapshot: " .. sname, "ok")
            snapshots = load_snapshots()
            -- Select only the newly saved snapshot
            clear_selection()
            for j, s in ipairs(snapshots) do
              if s.name == sname then select_single(j); break end
            end
          else
            set_status("Save failed: " .. (err or "unknown error"), "err")
          end
        end

      elseif hover_btn == "restore" and has_sel then
        restore_selected()

      elseif hover_btn == "delete" and has_sel then
        delete_selected()

      elseif hover_btn == "refresh" then
        snapshots = load_snapshots()
        clear_selection()  -- row indices may have changed; don't keep stale selection
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
  elseif char == 1685026670 or char == 30064 then -- Up arrow (collapses to single)
    if selected_idx > 1 then
      select_single(selected_idx - 1)
      if selected_idx <= scroll_offset then
        scroll_offset = selected_idx - 1
      end
    elseif selected_idx == 0 and #snapshots > 0 then
      select_single(1)
    end
  elseif char == 1685026669 or char == 30065 then -- Down arrow (collapses to single)
    if selected_idx > 0 and selected_idx < #snapshots then
      select_single(selected_idx + 1)
      local _, _, _, lh2 = get_list_rect()
      local vr = get_visible_rows(lh2)
      if selected_idx > scroll_offset + vr then
        scroll_offset = selected_idx - vr
      end
    elseif selected_idx == 0 and #snapshots > 0 then
      select_single(1)
    end
  elseif char == 13 then -- Enter = restore
    restore_selected()
  elseif char == 6579564 then -- Delete key
    delete_selected()
  end

  -- Mouse wheel scroll
  local wheel = gfx.mouse_wheel
  if wheel ~= 0 then
    local scroll_lines = wheel > 0 and -3 or 3
    local _, _, _, lh_scroll = get_list_rect()
    local max_scroll_wheel = math.max(0, #snapshots - get_visible_rows(lh_scroll))
    scroll_offset = math.max(0, math.min(scroll_offset + scroll_lines, max_scroll_wheel))
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
  select_single(1)
end

set_status("Loaded " .. #snapshots .. " snapshot(s) from " .. get_snapshot_dir(), "info", 5.0)

reaper.defer(loop)
