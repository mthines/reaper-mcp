# MCP Tools

Every tool reaper-mcp gives Claude, grouped by area. Back to the [README](../README.md) · [Reference](REFERENCE.md).

Every tool that takes a `trackIndex` (except media item, MIDI, item/take, track-template and `analyze_track_aesthetics` tools) accepts `-1` for the **master track**.

### Project & Tracks

| Tool | Description |
|------|-------------|
| `get_project_info` | Project name, tempo, time sig, sample rate, transport state |
| `list_tracks` | All tracks with volume, pan, mute/solo, arm, phase, FX count, routing |
| `get_track_properties` | Detailed track info + full FX chain list |
| `set_track_property` | Set volume (dB), pan, mute, solo, recordArm, phase, input |

### FX Management

| Tool | Description |
|------|-------------|
| `add_fx` | Add FX by name (partial match: "ReaEQ", "Pro-Q 3") |
| `remove_fx` | Remove FX from chain by index |
| `get_fx_parameters` | List all FX params with values and ranges |
| `set_fx_parameter` | Set FX parameter (normalized 0.0-1.0) |
| `set_fx_enabled` | Enable or disable (bypass) an FX plugin |
| `set_fx_offline` | Set FX online/offline (offline = no CPU, preserves settings) |
| `list_available_fx` | Discover all installed plugins (VST, VST3, JS, CLAP, AU) |
| `search_fx` | Fuzzy search installed plugins by name |
| `get_fx_preset_list` | List available presets for an FX |
| `set_fx_preset` | Load a preset by name |

### Transport

| Tool | Description |
|------|-------------|
| `play` | Start playback |
| `stop` | Stop playback/recording |
| `record` | Start recording |
| `get_transport_state` | Play/record/pause, cursor positions, tempo, time sig |
| `set_cursor_position` | Move edit cursor to position (seconds) |

### Selection & Navigation

| Tool | Description |
|------|-------------|
| `get_selected_tracks` | Currently selected tracks with indices and names (master as -1) |
| `get_time_selection` | Time/loop selection start, end, length |
| `set_time_selection` | Set the time selection range |
| `set_selected_tracks` / `set_selected_items` | Select tracks (index, name, GUID, master) or items, replacing or adding to the selection |

### Markers & Regions

| Tool | Description |
|------|-------------|
| `list_markers` | All project markers (index, name, position, color) |
| `list_regions` | All regions (index, name, start/end, color) |
| `add_marker` | Add marker at position with optional name/color |
| `add_region` | Add region with start/end, optional name/color |
| `delete_marker` | Delete a marker by index |
| `delete_region` | Delete a region by index |
| `edit_marker` | Rename, move or recolor a marker |
| `edit_region` | Rename, move/resize or recolor a region |

### Tempo Map

| Tool | Description |
|------|-------------|
| `get_tempo_map` | All tempo/time sig changes (position, BPM, time sig, linear) |
| `add_tempo_marker` / `edit_tempo_marker` / `delete_tempo_marker` | Edit the tempo map |
| `set_project_tempo` | Set the project BPM |

### Project Operations

| Tool | Description |
|------|-------------|
| `undo_project` / `redo_project` | Undo / redo, reporting the undo label |
| `save_project` | Save in place, or write a copy to a `.rpp` path — never opens a dialog |
| `get_render_settings` / `set_render_settings` | Output dir, pattern, format, bounds, sample rate, channels |
| `render_project` | Render with the current settings (refuses to overwrite unless asked) |
| `get_project_settings` / `set_project_settings` | Sample rate, title, author, notes, repeat, metronome |

### Envelopes / Automation

| Tool | Description |
|------|-------------|
| `get_track_envelopes` | List envelopes on a track (name, point count, active/visible/armed) |
| `get_envelope_points` | Get automation points with pagination |
| `insert_envelope_point` | Insert automation point (time, value, shape, tension) |
| `delete_envelope_point` | Delete an automation point by index |

### Metering & Analysis

| Tool | Description |
|------|-------------|
| `read_track_meters` | Peak/RMS L/R in dB |
| `read_track_spectrum` | FFT frequency bins (auto-inserts analyzer) |
| `read_track_lufs` | Integrated/short-term/momentary LUFS + true peak |
| `read_track_correlation` | Stereo correlation, width, mid/side levels |
| `read_track_crest` | Crest factor (peak-to-RMS ratio) |

### MIDI Editing (14 tools)

| Tool | Description |
|------|-------------|
| `create_midi_item` | Create empty MIDI item on a track |
| `list_midi_items` | List MIDI items with position, length, note/CC counts |
| `get_midi_notes` | Get notes with pagination (offset/limit) |
| `analyze_midi` | Per-pitch velocity stats, histogram, machine gun detection |
| `insert_midi_note` / `insert_midi_notes` | Insert single or batch notes |
| `edit_midi_note` / `edit_midi_notes` | Edit single or batch notes |
| `delete_midi_note` | Delete a note by index |
| `get_midi_cc` / `insert_midi_cc` / `delete_midi_cc` | CC event management |
| `get_midi_item_properties` / `set_midi_item_properties` | MIDI item props |

### Media Item Editing (11 tools)

| Tool | Description |
|------|-------------|
| `list_media_items` | List items on a track (position, length, name, volume, type) |
| `get_media_item_properties` | Detailed properties (fades, play rate, pitch, source) |
| `set_media_item_properties` / `set_media_items_properties` | Set single or batch |
| `split_media_item` | Split at position, returns left/right info |
| `delete_media_item` / `move_media_item` / `trim_media_item` | Edit operations |
| `add_stretch_marker` / `get_stretch_markers` / `delete_stretch_marker` | Time-stretching |

### Snapshots (A/B Testing)

Snapshots capture your full mixer state: track volumes, pans, mute/solo, FX chains (all parameter values, enabled/offline states, presets), and send levels. Use them to A/B compare mix decisions or revert to a known-good state.

Pass `trackIndices` to `snapshot_save` to capture only some tracks; restoring that snapshot touches only those tracks. Pass `fullChunk` (on by default for a scoped snapshot) to store each track's exact state chunk. A chunk restore reproduces a plugin's complete internal state, including plugins whose sound lives in their own internal snapshots (such as Helix Native) that parameter values can't capture. Snapshots don't include the master track yet.

| Tool | Description |
|------|-------------|
| `snapshot_save` | Save current mixer state (volumes, pans, FX params, sends, mutes); `trackIndices` scopes it, `fullChunk` stores exact track chunks |
| `snapshot_restore` | Restore a saved snapshot (chunk snapshots restore their tracks exactly; parameter snapshots only restore params if plugin names match) |
| `snapshot_list` | List all saved snapshots with metadata |
| `snapshot_delete` | Delete a saved snapshot by name |

You can also manage snapshots directly in REAPER using the **Snapshot Manager** GUI (`mcp_snapshot_manager.lua`) — load it as a ReaScript action for a visual list with save/restore/delete buttons.

For quick A/B testing, bind these action scripts to keyboard shortcuts in REAPER:

| Script | Purpose | Suggested Key |
|--------|---------|---------------|
| `mcp_snapshot_quick_save.lua` | Save snapshot instantly (auto-named) | `Ctrl+Shift+S` |
| `mcp_snapshot_next.lua` | Restore next snapshot (wraps around) | `Ctrl+Right` |
| `mcp_snapshot_prev.lua` | Restore previous snapshot (wraps around) | `Ctrl+Left` |

### Track Structure

| Tool | Description |
|------|-------------|
| `add_track` | Insert a track (optional name, position) |
| `delete_track` | Delete a track (never the master) |
| `move_track` | Move a track to a new position; keeps the user's selection |
| `set_track_folder` | Folder parent / last-in-folder / normal; collapse state |
| `set_track_info` | Name, color (`#RRGGBB`/`none`), channel count, master/parent send |
| `set_track_group` | Group (1-64) membership roles, incl. VCA lead/follow |

### Routing

| Tool | Description |
|------|-------------|
| `get_track_routing` | Sends, receives (index, mode, channels), hardware outputs, master send, parent/folder info |
| `add_send` | Track → track send: level, pan, mute, mode, channels (sidechain into 3/4 widens the destination) |
| `set_send` | Edit a send, receive or hardware output by index |
| `remove_send` | Remove a send, receive or hardware output by index |
| `add_hardware_output` | Route a track to an audio interface output (stereo or mono) |

### Plan Executor

| Tool | Description |
|------|-------------|
| `run_plan` | Execute an ordered list of ops in **one** bridge call and **one** undo block, all-or-nothing, with `$refs`, `dryRun`, `idempotencyKey`, and an optional `snapshotBefore` |

### Actions Proxy

| Tool | Description |
|------|-------------|
| `search_actions` | Search REAPER's ~6k actions (native, SWS, scripts, `Custom:` macros) inside REAPER; returns id, stable `namedId`, name, toggle state, shortcuts |
| `get_action` | One action's details; a `Custom:` macro's steps by name, or a script's path (from `reaper-kb.ini`) |
| `run_action` | Run an action by id, named id or exact name in an undo block; returns the toggle state after. Dialog actions need `allowDialog`; quit/close/open project are always refused |

### Items & Takes

| Tool | Description |
|------|-------------|
| `insert_audio_file` | Insert an audio file onto a track as a new item at a position (default: edit cursor); the item is the file's length |
| `list_takes` | An item's takes: name, active, MIDI/audio, source file, take FX count |
| `set_active_take` | Make one take the active (playing) take |
| `get_take_fx` | List a take's FX (default: active take); with `fxIndex`, that FX's parameters |
| `add_take_fx` | Add an FX to a take's FX chain by name |
| `remove_take_fx` | Remove one FX from a take's FX chain |
| `set_take_fx_parameter` | Set one take FX parameter and return the value REAPER reads back |
| `get_item_appearance` | Item color (`"#RRGGBB"` or `"none"`) and fade lengths, shapes (0-6) and curves |
| `set_item_color` | Set an item's color, or `"none"` for the track default |
| `set_item_fades` | Set fade-in/out lengths, shapes and curves (only the fields given change) |

### FX Housekeeping

| Tool | Description |
|------|-------------|
| `move_fx` | Move one FX within its chain or to another track |
| `copy_fx` | Copy one FX (with settings) within its chain or onto another track |
| `rename_fx` | Rename an FX instance (REAPER 6.37+); `""` restores the plugin name |
| `save_fx_chain` | Save a track's FX chain as `<resource>/FXChains/<name>.RfxChain` |
| `load_fx_chain` | Load an `.RfxChain` onto a track (`append` or `replace`), fresh FXIDs |
| `list_fx_chains` | List saved `.RfxChain` names (FXChains folder and subfolders) |
| `save_track_template` | Save a track as `<resource>/TrackTemplates/<name>.RTrackTemplate` (items only with `includeItems`) |
| `insert_track_template` | Insert the track(s) of a template at a position, fresh GUIDs |
| `list_track_templates` | List saved `.RTrackTemplate` names |

