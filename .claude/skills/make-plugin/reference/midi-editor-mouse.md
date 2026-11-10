# REAPER MIDI editor: mouse and key map

What REAPER's own MIDI editor does with the mouse and keyboard, so a note editor in a generated plugin (`ui_seq`, a piano roll, a pad grid) behaves the way a REAPER user expects. **Match this map before inventing a gesture.**

**Status of the entries.** *Confirmed* = the plugin's owner stated it or it was checked against REAPER. *Believed* = REAPER's default as remembered, not checked in this repo. Anyone can verify and change the real bindings in REAPER: Preferences > Editing Behavior > Mouse Modifiers > "MIDI editor" contexts (the user's overrides are stored in `reaper-mouse.ini`, sections `MM_CTX_MIDI_*`; only changed bindings are written there, never the defaults). Move an entry to *Confirmed* once checked.

JSFX reads modifiers from `mouse_cap`: 1 left button, 2 right button, 4 Cmd (macOS) / Ctrl, 8 Shift, 16 Alt/Option, 32 Ctrl on macOS, 64 Win key.

## Pointer gestures

| Gesture | Native MIDI editor | Status | In `ui_seq` |
| --- | --- | --- | --- |
| Click empty space | Adds a note (draw/insert) at the grid, length = the grid or the note-length setting | Confirmed | Adds one note in the cell under the pointer (left edge of the cell, not the nearest line), at the brush length, selects it and sounds its lane |
| Drag on empty space, no modifier | Marquee: selects the notes inside the rectangle | Confirmed | Marquee (Cmd/Ctrl keeps the earlier selection) |
| Shift-drag on empty space | Creates several notes in a row, one per grid step | Confirmed | Paints a run at the brush length and feel, either direction |
| Alt/Option-drag | Erases the notes the pointer crosses | Confirmed (owner) | Erases every note crossed |
| Click a note | Selects it (and deselects the rest) | Believed | Same |
| Cmd/Ctrl-click a note | Adds it to / removes it from the selection | Believed | Same |
| Drag a note | Moves it (and the selection) in time and pitch | Believed | Moves the selection in time, and up/down to another lane (a lane is the pitch). Shift-drag changes the pressed note's velocity |
| Drag a note's right edge | Changes its length | Believed | Same |
| Cmd/Ctrl while placing or moving | Ignores the grid (free position) | Believed | Same |
| Double-click a note | Deletes it | Believed | Deletes it |
| Right-click a note | Deletes it / context menu | Believed (menu in the editor, delete in `ui_seq`) | Deletes it |
| Mouse wheel over notes | Scrolls (zoom with Cmd/Ctrl) | Believed | Over a note: its length (Cmd/Ctrl = velocity). Over empty space: the brush length |

The modifier never changes the note's *value* (length or feel): a plugin keeps those on the brush (buttons and keys), so a Shift-drag that paints four notes always paints four of the same kind.

## Keys

| Key | Native | Status | In `ui_seq` |
| --- | --- | --- | --- |
| Delete / Backspace | Deletes the selected notes | Confirmed | Same, plus a DELETE n button for hosts that do not forward the key |
| Cmd/Ctrl+A | Selects all notes | Believed | Same |
| Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z | Undo, redo | Believed | Same, 100 steps inside the plugin; UNDO and REDO buttons too, since REAPER may keep the keys |
| Esc | Clears the selection / leaves a mode | Believed | Leaves the selection alone |
| 1-4 | Not a native binding | n/a | Brush length 1/4 1/8 1/16 1/32 |
| Q / W / E | Not a native binding | n/a | Brush feel: straight / triplet / dotted |

## Value widgets (every plugin)

These are the toolkit's own gestures (the FabFilter/Serum convention), not REAPER's; they are the same on every widget, so a user learns them once. Source of truth: the header of `reaper/mcp_ui.jsfx-inc` and each widget's comment. Confirmed in the toolkit code.

| Widget | Drag | Shift | Wheel | Double-click | Cmd/Ctrl/Alt-click | Other |
| --- | --- | --- | --- | --- | --- | --- |
| `ui_knob` | Up/down (200 px = the full range) | 10x finer | Steps (Shift = finer) | Type a value | Reset to default | Hover shows the up/down arrows |
| `ui_padmap` note cell | Up/down, 9 px per semitone | 10x finer | +/- 1 note | Type a number | Reset | Name large, number small; arrows on hover |
| `ui_hbar` (header Mix/Output) | Left/right | 10x finer | Steps | Type a value | Reset | |
| `ui_toggle`, `ui_choice` | n/a | n/a | n/a | n/a | Reset | Click = on/off or next option, right-click = previous option |
| `ui_fhandle` (band edge) | Left/right, kept between its neighbours | | Nudge | Type Hz | Reset | |
| `ui_fthresh` (threshold line) | Hovered band up/down = its threshold | Moves the band's gain instead | Ratio | Type a threshold | Reset | A click selects the band |
| `ui_fband` (level line) | Hovered band up/down = its level | Fine steps | Small steps | Type a value | Reset | A click selects the band |
| `ui_keyboard`, `ui_pads` | Press plays (pads: lower = harder), drag across moves the hit | n/a | n/a | n/a | n/a | The plugin sounds the note itself via `ui_kpoll()` |
| `ui_seq` lane name | n/a | n/a | n/a | n/a | Cmd/Ctrl-click mutes the lane | Click auditions the lane's note |

Rules that go with them:

1. **Dragging up/down changes a value, always.** A knob, a note cell, a threshold and a velocity all follow it: up = more. Left/right is for position (time, frequency) and for horizontal bars.
2. **Hover must say so.** Any control you drag or scroll shows the up/down arrows (`ui_chev`) while the mouse is over it; this is the standard for every new widget.
3. **Shift = finer** on every continuous drag (10x), except where Shift already means a different tool (paint in `ui_seq`, gain on `ui_fthresh`); say so in the hint.
4. **Double-click types a value, a modifier-click resets** (Cmd, Ctrl or Alt), on every widget that holds a slider.
5. **A hint line or tooltip names the gesture while it runs** ("VELOCITY 96", "LENGTH 1/8").

**Keys need the host's setting.** REAPER keeps its own shortcuts (Cmd+Z is the project's undo) unless the FX window's "+" menu has **"Send all keyboard input to plug-in"** ticked (confirmed: with it on, the plugin's Cmd+Z / Cmd+Shift+Z work). Never rely on a key alone: give every key action a visible button (UNDO, REDO, DELETE) and say in the hint what the setting does.

## Rules for a plugin editor

0. **Selection decides what an adjustment touches.** Moving, velocity, length and scroll act on every selected note when the one you grab is selected, and on that note alone when it is not.

1. **No modifier = the plain gesture; a modifier = a different tool, never a different value.** Selection, paint, erase and off-grid placement are tools; length and feel are the brush.
2. **A drag on empty space selects.** Creating notes by dragging needs Shift (paint), as in REAPER. A plain click still adds one.
3. **Delete and Backspace remove the selection**, and a visible button does too, since a JSFX window does not always receive keys.
4. **Show the active tool in a hint line** when the pointer is over the grid, and name the gesture while it runs ("ERASING NOTES", "PAINTING 1/16 NOTES").
5. **Never bind a feel or value to Shift/Alt**, they belong to paint and erase.
6. Keep `Cmd/Ctrl` for "more": add to the selection, or ignore the grid.

When REAPER's behaviour is in doubt, check it in the real MIDI editor (or the Mouse Modifiers preferences) and record the answer here.
