# REAPER MCP Server

An MCP (Model Context Protocol) server that enables AI agents (Claude Code, etc.) to control a live REAPER DAW session in real-time -- including track management, FX control, parameter adjustment, metering, frequency analysis, MIDI editing, and media item manipulation.

## Quick Start

```bash
pnpm install                    # Install dependencies
pnpm nx run-many --target=build # Build everything
pnpm nx run-many --target=lint  # Lint everything
pnpm nx run-many --target=test  # Test everything
```

## Architecture Overview

```
Claude Code <--stdio--> MCP Server (TypeScript) <--JSON files--> Lua Bridge (REAPER) <--ReaScript API--> REAPER DAW
                                 |                                     |
                    newline-delimited JSON-RPC              gmem[] shared memory
                                 |                                     |
                    Python Sidecar (long-lived)              JSFX FFT Analyzer
                    Audiobox Aesthetics model
```

### Why File-Based IPC?

REAPER's Lua scripting environment is sandboxed -- no sockets, no HTTP, no stdin/stdout. The only reliable cross-process communication is file-based JSON IPC:

1. MCP Server writes `command_{uuid}.json` to bridge directory
2. Lua bridge polls directory every ~30ms via `reaper.defer()`, reads command, executes ReaScript API
3. Lua bridge writes `response_{uuid}.json` with results
4. MCP Server polls for response, returns to client

Bridge directory: `{REAPER_RESOURCE_PATH}/Scripts/mcp_bridge_data/` (override with `REAPER_RESOURCE_PATH` env var)

Round-trip latency: ~50-150ms -- fast enough for iterative AI mixing decisions.

## Project Structure

This is an **Nx monorepo** with **pnpm workspaces**.

```
reaper-mcp/
  apps/reaper-mcp-server/     # Main MCP server application (TypeScript, esbuild)
    src/
      main.ts                 # CLI entry point: serve | setup | setup-sidecar | init | doctor | status
      server.ts               # McpServer creation, tool registration
      bridge.ts               # File-based IPC: sendCommand(), isBridgeRunning(), etc.
      sidecar.ts              # Python subprocess lifecycle + JSON-RPC client (getSidecarClient())
      setup-sidecar.ts        # setup-sidecar CLI command: Python check, venv, deps, weights download
      tools/
        project.ts            # get_project_info; undo/redo, save, render settings + render, project settings (logic in reaper/mcp_project_lib.lua)
        tracks.ts             # list_tracks, get_track_properties, set_track_property
        fx.ts                 # add_fx, remove_fx, get/set_fx_parameter, set_fx_enabled, set_fx_offline
        meters.ts             # read_track_meters, read_track_spectrum
        transport.ts          # play, stop, record, get_transport_state, set_cursor_position
        discovery.ts          # list_available_fx, search_fx
        presets.ts            # get_fx_preset_list, set_fx_preset
        snapshots.ts          # snapshot_save, snapshot_restore, snapshot_list, snapshot_delete, snapshot_edit
        routing.ts            # get_track_routing
        structure.ts          # add/delete/move track, folders, name/color, groups; send/hardware-output setters
        analysis.ts           # read_track_lufs, read_track_correlation, read_track_crest, measure_tracks
        midi.ts               # 14 MIDI editing tools (notes, CC, items, analysis, batch edit)
        media.ts              # 11 media item editing tools (properties, batch, split, move, trim, stretch)
        selection.ts          # get/set_selected_tracks, set_selected_items, get/set_time_selection
        actions.ts            # search_actions, get_action, run_action (logic in reaper/mcp_actions_lib.lua)
        items.ts              # insert_audio_file, takes, take FX, item color/fades (logic in reaper/mcp_items_lib.lua)
        arrange.ts            # copy_media_items, insert/remove_time, copy_section, process_items (logic in reaper/mcp_arrange_lib.lua)
        fx-housekeeping.ts    # move/copy/rename_fx, .RfxChain save/load, track templates (logic in reaper/mcp_items_lib.lua)
        markers.ts            # list_markers, list_regions, add_marker, add_region, delete_marker, delete_region, edit_marker, edit_region
        tempo.ts              # get_tempo_map, add/edit/delete_tempo_marker, set_project_tempo
        envelopes.ts          # envelope points (read/insert/edit/delete, dB on volume envelopes) + automation items (logic in reaper/mcp_envelopes_lib.lua)
        aesthetics.ts         # analyze_track_aesthetics (requires Python sidecar)
        offline.ts            # analyze_track_offline, analyze_audio_file, measure_track_alignment (sidecar, no model)
        transients.ts         # detect_transients, create_transient_automation (sidecar onsets → envelope pulses, e.g. lighting)
        plan.ts               # run_plan (multi-op plan executor; logic in reaper/mcp_plan_lib.lua)

    sidecar/                  # Python sidecar for semantic audio analysis (opt-in)
      server.py               # JSON-RPC server (Meta Audiobox Aesthetics, CC-BY 4.0)
      requirements.txt        # Pinned Python deps
      tests/test_server.py    # pytest unit tests for the sidecar

  libs/protocol/              # Shared TypeScript types (compiled with tsc)
    src/
      index.ts                # Re-exports commands + responses
      commands.ts             # BridgeCommand, CommandType, per-command param interfaces
      responses.ts            # BridgeResponse, ProjectInfo, TrackInfo, FxInfo, etc.

  apps/bridge-ui/             # Bridge status page (React → one self-contained mcp_bridge.html)
    src/status.ts             # Parses ExtState MCPBridge/status, liveness, log merge (unit-tested)
    src/App.tsx               # Status, latency strip, searchable/filterable command log
    build.mjs                 # esbuild bundle inlined into dist/apps/bridge-ui/mcp_bridge.html
    build-config.mjs          # esbuild options + HTML template shared by build.mjs and dev.mjs
    dev.mjs                   # pnpm dev:bridge: live-reload page, /_/ proxied over one socket, reaper/ installed on save

  .claude/skills/             # Mix skills (one dir per skill, each with SKILL.md), symlinked into ~/.claude/skills by scripts/sync-symlinks.sh
    mixer/SKILL.md            # /mixer — executes mixes (live session, reads/writes memory)
    critique/SKILL.md         # /critique — read-only analysis ("roast my mix")
    mastering/SKILL.md        # /mastering — mix-bus mastering to a LUFS target
    learn-plugin/SKILL.md     # /learn-plugin — research + live-probe a plugin via plugin-researcher, ask only the gaps (LoreKit)
    mix-memory/SKILL.md       # /mix-memory — recall / consolidate / promote memory
  .claude/agents/             # Subagents, symlinked into ~/.claude/agents by scripts/sync-symlinks.sh
    plugin-researcher.md      # Web research + scratch-track probing → user::plugins:: record; used by /learn-plugin, /mixer, /mastering

  knowledge/                  # Knowledge base + memory; symlinked into ~/.claude/knowledge (primary install)
    genres/                   # Genre mixing conventions (targets, frequency balance, dynamics)
    workflows/                # Step-by-step mixing workflows (gain-staging, vocal-chain, etc.)
    reference/                # Reference material (frequencies, metering, compression, perceived loudness, memory-protocol)
                              # Balance/EQ decisions use perceived values only (LU, kDb), never raw dBFS: reference/perceived-loudness.md
                              # Plugin knowledge + process lessons live in LoreKit, scope project::reaper-mcp

  scripts/
    sync-symlinks.sh          # Symlink .claude/skills/*/ (skill dirs), .claude/agents/*.md + knowledge/ into ~/.claude (primary install model)
    plugin-list.mjs           # Rebuild docs/PLUGINS.md's built-in plugin table from LoreKit (logic: apps/bridge-ui/src/plugin-list.mjs)

  reaper/                     # Files installed INTO REAPER (copied by setup command)
    mcp_tracks_lib.lua        # Pure track-structure + routing logic (wasmoon-tested), loaded by the bridge
    mcp_bridge.lua            # Persistent Lua bridge (defer loop, JSON IPC, 131 handlers)
    mcp_snapshot_lib.lua      # Shared library for snapshot action scripts
    mcp_plan_lib.lua          # run_plan executor (pure Lua, takes the API as an argument; unit-tested via wasmoon)
    mcp_actions_lib.lua       # Action proxy + selection setters (pure Lua, unit-tested via wasmoon)
    mcp_project_lib.lua       # Project ops, tempo map + marker editing (pure Lua, unit-tested via wasmoon)
    mcp_envelopes_lib.lua     # Envelopes, points (dB through the envelope's scaling) and pooled automation items (pure Lua, unit-tested via wasmoon)
    mcp_items_lib.lua         # Items, takes, take FX, FX move/copy/rename, FX chains, track templates (pure Lua, unit-tested via wasmoon)
    mcp_arrange_lib.lua       # Copy items, insert/remove time, copy a section, normalize/reverse/glue (pure Lua, unit-tested via wasmoon)
    mcp_edit_views_lib.lua    # Status-page results: measurements, waveforms and before/after edit views (tested through the bridge)
    mcp_snapshots_ui_lib.lua  # Status-page Snapshots view: list, restore and save requests (tested through the bridge)
    mcp_snapshot_next.lua     # Action: restore next snapshot (keybind for A/B testing)
    mcp_snapshot_prev.lua     # Action: restore previous snapshot (keybind for A/B testing)
    mcp_snapshot_quick_save.lua # Action: quick save, named by the date and time
                              # The 3 snapshot actions are listed in reaper-kb.ini by setup (REAPER closed),
                              # else registered by the bridge on start (register_actions in mcp_snapshots_ui_lib.lua)
    mcp_analyzer.jsfx         # Real-time FFT analyzer (JSFX, writes to gmem[])
    mcp_midi_emitter.jsfx     # Real-time MIDI emitter (JSFX, reads from gmem[] ring buffer)
    mcp_gain_trace.jsfx       # Live pre/post gain trace (pumping/ducking meter: p5/p1/std as params, gmem MCPGainTrace)
    install.sh                # Manual install helper script
```

### Where mix knowledge lives

- **`knowledge/`** (genres, workflows, reference) — curated markdown read on demand by the mix skills; symlinked into `~/.claude/knowledge`.
- **Plugin knowledge and process lessons** live in **LoreKit**, scope `project::reaper-mcp` — one record per plugin (tags `plugin-knowledge`, `category::…`, `preference::…`, `fx::…`) and lessons (`loop::mixing-lessons`), in two layers: the **built-in** layer (keys `plugins::<vendor>/<plugin>` / `mixing-lessons::<slug>`, owned by the `reaper-mcp` LoreKit org, tag `layer::built-in`, read by everyone through the server's `list_builtin_knowledge` / `get_builtin_knowledge` tools) and each user's own layer on top (keys `user::plugins::…` / `user::mixing-lessons::…`, tag `layer::user`, via the user's own LoreKit `memory.*`). The user's record wins. The skills only ever write `user::` keys; the maintainer moves records into the built-in layer with `/mix-memory publish`.
- **`docs/PLUGINS.md`** lists every built-in plugin record (table between `<!-- plugin-list:start/end -->`, rebuilt by `node scripts/plugin-list.mjs`, never by hand). A publisher's `/mix-memory publish` (and `/learn-plugin`, which offers to publish) rebuild it in the clone; the `Plugin list` workflow rebuilds it on `main` after every `Plugin contributions` run and daily (direct publishes from the bridge page). Contract: `knowledge/reference/memory-protocol.md`.

## Workspace Packages

| Package | Location | Build | Purpose |
|---------|----------|-------|---------|
| `@mthines/reaper-mcp` | `/` (root) | -- | Workspace root, scripts |
| `@mthines/reaper-mcp-server` | `apps/reaper-mcp-server` | `@nx/esbuild` (ESM bundle) | MCP server application |
| `@mthines/reaper-bridge-ui` | `apps/bridge-ui` | `build.mjs` (esbuild → single HTML) | Bridge status page served by REAPER's web interface |
| `@reaper-mcp/protocol` | `libs/protocol` | `@nx/js:tsc` | Shared command/response types |

## MCP Tools (153 total)

Every tool that takes a `trackIndex` (except media item, MIDI, item/take, track-template and `measure_track_alignment` tools) accepts `-1` for the **master track**; track references (`track`, `from`, `to`) also accept an exact name, a `"{GUID}"`, or `"master"`.

### Project & Tracks (5)

| Tool | File | Description |
|------|------|-------------|
| `get_project_info` | `tools/project.ts` | Project name, tempo, time sig, sample rate, transport state |
| `list_tracks` | `tools/tracks.ts` | All tracks with volume, pan, mute/solo, arm, phase, FX count, routing; optional `parent` (folder index/name → its descendants), `nameContains`, `compact`, `offset`/`limit` (then returns `{total, hasMore, tracks}`) |
| `get_track_properties` | `tools/tracks.ts` | Detailed single track info + full FX chain list |
| `set_track_property` | `tools/tracks.ts` | Set volume (dB), pan, mute, solo, recordArm, phase, input, playOffsetMs (track playback offset, ±500 ms) |
| `set_multiple_track_properties` | `tools/batch.ts` | **Batch** set properties on multiple tracks in one call |

### Track Structure (6)

| Tool | File | Description |
|------|------|-------------|
| `add_track` | `tools/structure.ts` | Insert a track (optional name, position) |
| `delete_track` | `tools/structure.ts` | Delete a track (never the master) |
| `move_track` | `tools/structure.ts` | Move a track to a new position; keeps the user's selection |
| `set_track_folder` | `tools/structure.ts` | Folder parent / last-in-folder / normal; collapse state |
| `set_track_info` | `tools/structure.ts` | Name, color (`#RRGGBB`/`none`), channel count, master/parent send |
| `set_track_group` | `tools/structure.ts` | Group (1-64) membership roles, incl. VCA lead/follow |

### FX Management (9)

| Tool | File | Description |
|------|------|-------------|
| `add_fx` | `tools/fx.ts` | Add FX by name (partial match: "ReaEQ", "VST: Pro-Q 3") |
| `remove_fx` | `tools/fx.ts` | Remove FX from chain by index |
| `get_fx_parameters` | `tools/fx.ts` | List all FX params with current values and ranges |
| `analyze_fx` | `tools/fx.ts` | Analyze FX parameters with filtering and pagination |
| `set_fx_parameter` | `tools/fx.ts` | Set FX parameter (normalized 0.0-1.0) |
| `set_fx_enabled` | `tools/fx.ts` | Enable or disable (bypass) an FX plugin |
| `set_fx_offline` | `tools/fx.ts` | Set FX online/offline (offline = no CPU, preserves settings) |
| `setup_fx_chain` | `tools/batch.ts` | **Batch** add multiple FX with initial parameters in one call |
| `set_multiple_fx_parameters` | `tools/batch.ts` | **Batch** set params across multiple FX/tracks in one call |

### Transport (5)

| Tool | File | Description |
|------|------|-------------|
| `play` | `tools/transport.ts` | Start playback |
| `stop` | `tools/transport.ts` | Stop playback/recording |
| `record` | `tools/transport.ts` | Start recording (arms must be set on target tracks) |
| `get_transport_state` | `tools/transport.ts` | Play/record/pause status, cursor positions, tempo, time sig |
| `set_cursor_position` | `tools/transport.ts` | Move edit cursor to position in seconds |

### MIDI Editing Tools (14)

| Tool | File | Description |
|------|------|-------------|
| `create_midi_item` | `tools/midi.ts` | Create an empty MIDI item on a track at a given time range (seconds) |
| `list_midi_items` | `tools/midi.ts` | List all MIDI items on a track with position, length, note/CC counts |
| `get_midi_notes` | `tools/midi.ts` | Get MIDI notes with pagination (offset/limit). Use analyze_midi first for large items. |
| `analyze_midi` | `tools/midi.ts` | Analyze MIDI item: per-pitch velocity stats, histogram, machine gun detection. Efficient for large items. |
| `insert_midi_note` | `tools/midi.ts` | Insert a single note (pitch 0-127, velocity 1-127, position/duration in beats) |
| `insert_midi_notes` | `tools/midi.ts` | Batch insert multiple notes via JSON array string |
| `edit_midi_note` | `tools/midi.ts` | Edit an existing note by index (partial updates: only provided fields change) |
| `edit_midi_notes` | `tools/midi.ts` | Batch edit multiple notes via JSON array string. Much faster than repeated edit_midi_note calls. |
| `delete_midi_note` | `tools/midi.ts` | Delete a note by index |
| `get_midi_cc` | `tools/midi.ts` | Get CC events, optionally filtered by CC number |
| `insert_midi_cc` | `tools/midi.ts` | Insert a CC event (cc 0-127, value 0-127, position in beats) |
| `delete_midi_cc` | `tools/midi.ts` | Delete a CC event by index |
| `get_midi_item_properties` | `tools/midi.ts` | Get MIDI item properties (position, length, note/CC count, mute, loop) |
| `set_midi_item_properties` | `tools/midi.ts` | Set MIDI item properties (position, length, mute, loop source) |

### Live MIDI Output (3)

| Tool | File | Description |
|------|------|-------------|
| `send_midi_cc` | `tools/midi.ts` | Send a CC event in real-time to a track's MIDI output (auto-inserts `mcp_midi_emitter.jsfx`) |
| `send_midi_pc` | `tools/midi.ts` | Send a program change (optionally preceded by bank select CC0 + CC32) |
| `send_midi_note` | `tools/midi.ts` | Send a note-on; if `durationMs` provided, schedules note-off automatically |

### Media Item Editing Tools (11)

| Tool | File | Description |
|------|------|-------------|
| `list_media_items` | `tools/media.ts` | List all items on a track (position, length, name, volume, MIDI/audio type) |
| `get_media_item_properties` | `tools/media.ts` | Detailed item properties (fades, play rate, pitch, source file, lock state) |
| `set_media_item_properties` | `tools/media.ts` | Set item properties (position, length, volume dB, mute, fades, play rate) |
| `set_media_items_properties` | `tools/media.ts` | Batch set properties on multiple items via JSON array string. |
| `split_media_item` | `tools/media.ts` | Split an item at a position (seconds), returns left/right item info |
| `delete_media_item` | `tools/media.ts` | Delete an item from a track |
| `move_media_item` | `tools/media.ts` | Move an item to a new position and/or a different track |
| `trim_media_item` | `tools/media.ts` | Trim item edges (positive=trim inward, negative=extend) |
| `add_stretch_marker` | `tools/media.ts` | Add a stretch marker for time-stretching audio |
| `get_stretch_markers` | `tools/media.ts` | List stretch markers with positions and source positions |
| `delete_stretch_marker` | `tools/media.ts` | Delete a stretch marker by index |

### Arrangement Tools (5)

| Tool | File | Description |
|------|------|-------------|
| `copy_media_items` | `tools/arrange.ts` | Copy/repeat items keeping their spacing (`times`, `position`, `trackIndex`); fresh GUIDs, MIDI unpooled unless `pooled` |
| `insert_time` | `tools/arrange.ts` | Open time across the project: items, markers, regions, tempo, envelope points and automation items after it move; spanning items split |
| `remove_time` | `tools/arrange.ts` | Cut a range out of the project and close the gap; crossing items trimmed, regions shrink, the tempo after the cut kept |
| `copy_section` | `tools/arrange.ts` | Copy a region (or start/end) to a position: items trimmed to it plus automation (points, and pooled copies of automation items inside it), optional `insert` and `tracks` |
| `process_items` | `tools/arrange.ts` | `normalize` (item gain to a peak/true-peak/LUFS/RMS target), `reverse`, `glue`; selection kept |

### Selection & Navigation Tools (5)

| Tool | File | Description |
|------|------|-------------|
| `get_selected_tracks` | `tools/selection.ts` | Get currently selected tracks with indices and names (master as -1) |
| `set_selected_tracks` | `tools/selection.ts` | Select tracks by index, name or GUID (`replace` or `add`); all resolved first, an unknown one changes nothing |
| `set_selected_items` | `tools/selection.ts` | Select media items by `{trackIndex, itemIndex}` (`replace` or `add`) |
| `get_time_selection` | `tools/selection.ts` | Get time/loop selection start, end, length in seconds |
| `set_time_selection` | `tools/selection.ts` | Set the time selection range (start/end in seconds) |

### Markers & Regions Tools (8)

| Tool | File | Description |
|------|------|-------------|
| `list_markers` | `tools/markers.ts` | List all project markers (index, name, position, color) |
| `list_regions` | `tools/markers.ts` | List all regions (index, name, start/end, color) |
| `add_marker` | `tools/markers.ts` | Add a marker at position with optional name/color |
| `add_region` | `tools/markers.ts` | Add a region with start/end, optional name/color |
| `delete_marker` | `tools/markers.ts` | Delete a marker by index |
| `delete_region` | `tools/markers.ts` | Delete a region by index |
| `edit_marker` | `tools/markers.ts` | Rename, move or recolor a marker by index; unknown index changes nothing |
| `edit_region` | `tools/markers.ts` | Rename, move/resize or recolor a region by index; end must stay after start |

### Tempo Map Tools (5)

| Tool | File | Description |
|------|------|-------------|
| `get_tempo_map` | `tools/tempo.ts` | All tempo/time sig changes (position, BPM, time sig, linear flag) |
| `add_tempo_marker` | `tools/tempo.ts` | Add a tempo/time sig marker at a position (seconds); returns the updated map |
| `edit_tempo_marker` | `tools/tempo.ts` | Edit a tempo marker by index (position, BPM, time sig, linear); unspecified fields kept |
| `delete_tempo_marker` | `tools/tempo.ts` | Delete a tempo marker by index |
| `set_project_tempo` | `tools/tempo.ts` | Set the tempo at the project start: project BPM with no markers, else the marker at 0 (added when the first marker is later) |

### Envelope / Automation Tools (14)

Every point tool takes an optional `automationItemIndex` to work on one automation item's (pool's) points instead of the underlying envelope.

| Tool | File | Description |
|------|------|-------------|
| `create_track_envelope` | `tools/envelopes.ts` | Create/show an envelope on a track (Volume, Pan, Mute, Width, Trim Volume via native actions, selection kept; or FX parameter); `created: false` when it existed |
| `get_track_envelopes` | `tools/envelopes.ts` | List envelopes on a track (name, point and automation item counts, active/visible/armed); send envelopes carry `send` (index, destination track) |
| `get_envelope_points` | `tools/envelopes.ts` | Get automation points with pagination (time, raw value, `db` on volume envelopes, shape, tension) |
| `insert_envelope_point` | `tools/envelopes.ts` | Insert an automation point (`value` or `db`) with shape/tension |
| `insert_envelope_points` | `tools/envelopes.ts` | Batch insert multiple automation points (JSON array) |
| `edit_envelope_points` | `tools/envelopes.ts` | Edit points by index (time, value/db, shape, tension); all validated before any write |
| `delete_envelope_point` | `tools/envelopes.ts` | Delete an automation point by index; returns the deleted point |
| `clear_envelope` | `tools/envelopes.ts` | Delete ALL points from an envelope (or an item's pool) |
| `remove_envelope_points` | `tools/envelopes.ts` | Delete automation points in a time range |
| `set_envelope_properties` | `tools/envelopes.ts` | Set envelope active/visible/armed state |
| `list_automation_items` | `tools/envelopes.ts` | Automation items on an envelope: index, poolId, pool name, position, length, loop, point count |
| `insert_automation_item` | `tools/envelopes.ts` | New pool from `points` (seconds from the item start), a pooled instance of `poolId` (any track), or `captureEnvelope`; returns `pooledWith` |
| `set_automation_item` | `tools/envelopes.ts` | Move/resize an item; start offset, play rate, baseline, amplitude, loop, pool name |
| `delete_automation_item` | `tools/envelopes.ts` | Delete one item (`preservePoints` keeps them on the envelope); other selections kept |

### FX Discovery & Presets (4)

| Tool | File | Description |
|------|------|-------------|
| `list_available_fx` | `tools/discovery.ts` | Discover all installed plugins (VST, VST3, JS, CLAP, AU) via REAPER's `EnumInstalledFX` (6.37+) |
| `search_fx` | `tools/discovery.ts` | Fuzzy search installed plugins by name |
| `get_fx_preset_list` | `tools/presets.ts` | List available presets for an FX |
| `set_fx_preset` | `tools/presets.ts` | Load a preset by name |

### Snapshots (5)

| Tool | File | Description |
|------|------|-------------|
| `snapshot_save` | `tools/snapshots.ts` | Save mixer state to `.reaper-mcp/snapshots/` (v2: volumes, pans, FX params, sends); `trackIndices` scopes it, `fullChunk` stores exact track chunks |
| `snapshot_restore` | `tools/snapshots.ts` | Restore a saved snapshot (FX params only if plugin name matches) |
| `snapshot_list` | `tools/snapshots.ts` | List project-scoped snapshots (falls back to global for unsaved projects) |
| `snapshot_delete` | `tools/snapshots.ts` | Delete a saved snapshot by name |
| `snapshot_edit` | `tools/snapshots.ts` | Rename a snapshot and/or change its description; the mixer state is copied unchanged, a name another snapshot's file uses is refused |

### Routing (5)

| Tool | File | Description |
|------|------|-------------|
| `get_track_routing` | `tools/routing.ts` | Sends, receives (index, mode, channels), hardware outputs, master send, parent/folder info |
| `add_send` | `tools/structure.ts` | Track → track send: level, pan, mute, mode, channels (sidechain into 3/4 widens the destination) |
| `set_send` | `tools/structure.ts` | Edit a send, receive or hardware output by index |
| `remove_send` | `tools/structure.ts` | Remove a send, receive or hardware output by index |
| `add_hardware_output` | `tools/structure.ts` | Route a track to an audio interface output (stereo or mono) |

### Metering & Analysis (6)

| Tool | File | Description |
|------|------|-------------|
| `read_track_meters` | `tools/meters.ts` | Peak/RMS L/R in dB |
| `read_track_spectrum` | `tools/meters.ts` | 1/3-octave bands, 25 Hz–16 kHz, raw `db` + K-weighted `kDb` (judge on `kDb`; table in `knowledge/reference/perceived-loudness.md`); auto-inserts JSFX analyzer; raw FFT bins with `includeBins` |
| `read_track_lufs` | `tools/analysis.ts` | Integrated/short-term/momentary LUFS + true peak |
| `read_track_correlation` | `tools/analysis.ts` | Stereo correlation, width, mid/side levels |
| `read_track_crest` | `tools/analysis.ts` | Crest factor (peak-to-RMS ratio) |
| `measure_tracks` | `tools/analysis.ts` | Play, collect LUFS/crest/correlation/spectrum for 1–8 tracks in one call, stop, then remove the meters it inserted (`keepMeters` keeps them). A metric that returned no data goes to the track's `errors` instead of zeros (TS-composed; cleanup via internal `remove_mcp_meters`) |

### Offline & Perceptual Audio Analysis (6) — Requires Python Sidecar

| Tool | File | Description |
|------|------|-------------|
| `analyze_track_aesthetics` | `tools/aesthetics.ts` | Perceptual quality scores via Meta Audiobox Aesthetics (CC-BY 4.0): Production Quality, Production Complexity, Content Enjoyment, Content Usefulness (all 0-10). Bounces a 30 s clip (default) of a track or the master (-1), normalizes it to `normalizeLufs` (default -18, `false` = as rendered) so level doesn't skew the scores, calls Python sidecar. Noise floor: `knowledge/reference/aesthetics-scoring.md`. Requires `setup-sidecar`. |
| `analyze_track_offline` | `tools/offline.ts` | Render a track or the master once (up to 900 s, no playback) and analyze it: integrated LUFS (BS.1770 gated), LRA (EBU 3342), true peak, sample peak, crest, per-section loudness, band balance, resonance and sibilance hints; with `referencePath`, loudness and tonal-balance deltas against that file |
| `analyze_audio_file` | `tools/offline.ts` | The same analysis for an audio file on disk (reference song, bounce, stem); no REAPER involved |
| `measure_track_alignment` | `tools/offline.ts` | Render two tracks over the same window (≤30 s) and cross-correlate: delay (ms, samples), polarity, correlation, and absolute `suggestedPlayOffsetMs` / `suggestedPhase` for `set_track_property` (include the track's current offset and polarity) |
| `detect_transients` | `tools/transients.ts` | Hits in a track (rendered, ≤900 s) or an audio file (MP3 too; `filePosition` maps it to project time): time, strength 0..1, dominant band (low/mid/high), peakDb, plus tempo, per-band counts and per-section density; filter by `band`/`bands`/`sensitivity`/`minGapMs`/`minStrength`, paginated |
| `create_transient_automation` | `tools/transients.ts` | Detect, then write one pulse per hit (attack, hold, exponential/linear decay, scaled by strength) onto an existing envelope — e.g. lighting that flashes on the kicks. Replaces the range's points (REAPER keeps an envelope's last point on a range delete; it becomes the first pulse point), `dryRun` returns the points. TS-composed over `remove_envelope_points` / `insert_envelope_points` |

### Plan Executor (1)

| Tool | File | Description |
|------|------|-------------|
| `run_plan` | `tools/plan.ts` | Execute an ordered list of ops in **one** bridge call and **one** undo block, all-or-nothing, with `$refs`, `dryRun`, `idempotencyKey`, and an optional `snapshotBefore` |

### Built-in Mix Knowledge (2)

| Tool | File | Description |
|------|------|-------------|
| `list_builtin_knowledge` | `tools/knowledge.ts` | List (summaries, tag filter) or full-text search the built-in plugin records and mixing lessons |
| `get_builtin_knowledge` | `tools/knowledge.ts` | Read one built-in record by key (`plugins::…` / `mixing-lessons::…`) |

TS-only (no bridge command): JSON-RPC to LoreKit with a bundled **public read-only** `lk_ro_` token
(`BUILTIN_LOREKIT_TOKEN`, scoped to `project::reaper-mcp` + the `reaper-mcp` org; override with
`REAPER_MCP_LOREKIT_TOKEN` / `REAPER_MCP_LOREKIT_URL`). Non-`lk_ro_` tokens are refused, rows are
filtered to tag `layer::built-in`, responses are cached 10 min. Scope the token with LoreKit's
`orgs_only` tenancy ("Selected orgs only") so it never sees its owner's personal rows; under any
other tenancy it does, and the owning account must keep nothing private in that scope.

### Actions Proxy (3)

| Tool | File | Description |
|------|------|-------------|
| `search_actions` | `tools/actions.ts` | Search REAPER's ~6k actions (native, SWS, scripts, `Custom:` macros) inside REAPER; returns id, stable `namedId`, name, toggle state, shortcuts |
| `get_action` | `tools/actions.ts` | One action's details; a `Custom:` macro's steps by name, or a script's path (from `reaper-kb.ini`) |
| `run_action` | `tools/actions.ts` | Run an action by id, named id or exact name in an undo block; returns the toggle state after. Dialog actions need `allowDialog`; quit/close/open project are always refused |

### Project Operations (9)

| Tool | File | Description |
|------|------|-------------|
| `undo_project` | `tools/project.ts` | Undo the last undo point; reports its label and the next undo/redo labels |
| `redo_project` | `tools/project.ts` | Redo the last undone point; reports its label |
| `save_project` | `tools/project.ts` | Save in place, or write a copy to an absolute `.rpp` `path` (the open project keeps its path; `savedAsCopy`). Never opens a dialog: a never-saved project without `path` is refused |
| `get_render_settings` | `tools/project.ts` | Output dir, file pattern, format + bit depth/bitrate, source, bounds, normalize/limit, dither, metadata, region matrix, and the resolved target files |
| `set_render_settings` | `tools/project.ts` | Set any render setting: format/secondaryFormat (wav/aiff/flac/mp3/ogg/opus, secondary also none), `source` (master, stems, master_and_stems, selected_via_master, selected_items, selected_items_via_master, region_matrix + `regionMatrix`), `bitDepth`/`mp3Bitrate`, dither, normalize/limit, `metadata`; all validated before any write, one undo point |
| `render_project` | `tools/project.ts` | Render with the current settings (synchronous action 42230), optionally for `tracks` (selected for the render, selection restored); returns each file's length, LUFS-I, true peak and peak; refuses to overwrite existing targets unless `overwrite` |
| `render_versions` | `tools/project.ts` | Render up to 16 versions in one call (e.g. full, instrumental, TV): each mutes its tracks, renders to `<pattern>-<name>`, and mutes and pattern are restored even when one fails; all targets checked before the first render |
| `get_project_settings` | `tools/project.ts` | Sample rate (+ forced flag), title, author, notes, repeat, metronome |
| `set_project_settings` | `tools/project.ts` | Set any of those; metronome is a global REAPER option (not undoable, not stored in the project) |

### Items & Takes (10)

| Tool | File | Description |
|------|------|-------------|
| `insert_audio_file` | `tools/items.ts` | Insert an audio file onto a track as a new item at a position (default: edit cursor); the item is the file's length |
| `list_takes` | `tools/items.ts` | An item's takes: name, active, MIDI/audio, source file, take FX count |
| `set_active_take` | `tools/items.ts` | Make one take the active (playing) take |
| `get_take_fx` | `tools/items.ts` | List a take's FX (default: active take); with `fxIndex`, that FX's parameters |
| `add_take_fx` | `tools/items.ts` | Add an FX to a take's FX chain by name |
| `remove_take_fx` | `tools/items.ts` | Remove one FX from a take's FX chain |
| `set_take_fx_parameter` | `tools/items.ts` | Set one take FX parameter and return the value REAPER reads back |
| `get_item_appearance` | `tools/items.ts` | Item color (`"#RRGGBB"` or `"none"`) and fade lengths, shapes (0-6) and curves |
| `set_item_color` | `tools/items.ts` | Set an item's color, or `"none"` for the track default |
| `set_item_fades` | `tools/items.ts` | Set fade-in/out lengths, shapes and curves (only the fields given change) |

### FX Housekeeping (9)

| Tool | File | Description |
|------|------|-------------|
| `move_fx` | `tools/fx-housekeeping.ts` | Move one FX within its chain or to another track |
| `copy_fx` | `tools/fx-housekeeping.ts` | Copy one FX (with settings) within its chain or onto another track |
| `rename_fx` | `tools/fx-housekeeping.ts` | Rename an FX instance (REAPER 6.37+); `""` restores the plugin name |
| `save_fx_chain` | `tools/fx-housekeeping.ts` | Save a track's FX chain as `<resource>/FXChains/<name>.RfxChain` |
| `load_fx_chain` | `tools/fx-housekeeping.ts` | Load an `.RfxChain` onto a track (`append` or `replace`), fresh FXIDs |
| `list_fx_chains` | `tools/fx-housekeeping.ts` | List saved `.RfxChain` names (FXChains folder and subfolders) |
| `save_track_template` | `tools/fx-housekeeping.ts` | Save a track as `<resource>/TrackTemplates/<name>.RTrackTemplate` (items only with `includeItems`) |
| `insert_track_template` | `tools/fx-housekeeping.ts` | Insert the track(s) of a template at a position, fresh GUIDs |
| `list_track_templates` | `tools/fx-housekeeping.ts` | List saved `.RTrackTemplate` names |

### Progressive Discovery (3)

| Tool | File | Description |
|------|------|-------------|
| `list_tool_categories` | `tools/categories.ts` | List all tool categories with descriptions and tool names (compact — avoids loading all 153 schemas) |
| `enable_tool_category` | `tools/categories.ts` | Get full tool list for a category; signals intent to use that category |
| `disable_tool_category` | `tools/categories.ts` | Semantic context-budget hint that a category is no longer needed |

Categories: `project`, `tracks`, `fx`, `transport`, `midi`, `media`, `arrange`, `selection`, `markers`, `tempo`, `envelopes`, `analysis`, `discovery`, `snapshots`, `routing`, `plan`, `actions`, `takes`, `fx_files`, `knowledge`

### MIDI Editing Concepts

- **Positions and durations** are in **beats** (quarter notes) from item start: `1.0` = quarter note, `0.5` = eighth note, `0.25` = sixteenth note
- **Pitch**: MIDI note number 0-127 where 60 = C4 (Middle C), 48 = C3, 72 = C5
- **Velocity**: 1-127 (64 = medium, 100 = strong, 127 = maximum)
- **Channel**: 0-15 (default 0; channel 9 = drums in General MIDI)
- **Batch operations** (`insert_midi_notes`, `edit_midi_notes`): Pass a JSON array of note objects for efficient multi-note operations
- The Lua bridge includes a fallback JSON array parser for REAPER versions without `CF_Json_Parse`

### Media Item Editing Concepts

- **Positions and lengths** are in **seconds** (absolute project time)
- **Volume** is in **dB** (0 = unity gain); internally converted to/from linear scale
- **Trim**: `trimStart` moves the left edge (adjusts start offset), `trimEnd` moves the right edge
- **Move**: Validates destination track upfront; moves to new track first, then adjusts position
- **Stretch markers**: Define time-stretch points mapping item position to source audio position

### Arrangement Concepts

- **Logic lives in `reaper/mcp_arrange_lib.lua`** (pure Lua over an injected API, unit-tested via wasmoon in `arrange-lib.test.ts` against `__fixtures__/fake_timeline.lua`); the bridge handlers decode `items`/`tracks` (JSON strings) and pass `reaper` in.
- **Time edits are done by hand, not with REAPER's ripple actions**, so the result never depends on the user's ripple or "move envelope points with items" options. Tempo markers change first; markers, envelopes and items are then set from absolute times read before any change (a beat-timebase item would otherwise follow the tempo edit on its own).
- **remove_time keeps the tempo after the cut**: the last tempo marker inside the range moves to the cut's start (unless one sits on its end). Automation items fully inside are deleted (selected alone and removed with action 42086, the user's other selected items kept); ones crossing an edge are trimmed like media items (`automationItemsTrimmed`: the part after the cut moves to its start with a later start offset, a tail inside the cut is dropped); one spanning the whole cut cannot lose its middle, so it stays and is counted (`automationItemsKept`).
- **Normalize** measures what the item plays (`CalculateNormalization` over its take's start offset and length) and sets item gain (`D_VOL`), so the take gain and source stay untouched. Reverse (41051) and glue (41588) run on the named items only, then put the user's selection back.
- **run_plan ops** `copy_items`, `insert_time`, `remove_time`: `copy_items` names items by index in the project as it is before the plan, so it is refused after an op that adds tracks or moves items (`add_track`, `copy_items`, `insert_time`, `remove_time`).

### Plan Executor Concepts (`run_plan`)

- **Use it for any multi-step edit**: one LLM turn and one bridge round trip instead of N sequential tool calls.
- **Op types**: `add_track`, `set_track` (volume dB, pan, mute, solo, recordArm, phase, input, name), `add_fx` (optional `params`, `enabled`, `position`), `set_fx_params`, `add_send` (volume dB, pan, mute), `graft_fxchain`, `select_tracks` (`tracks`, `mode`), `run_action` (`action`, `section`, `allowDialog` — same resolution and safety rules as the `run_action` tool, checked in the validate pass), and the arrangement ops `copy_items`, `insert_time`, `remove_time` (same parameters as the tools). Only `run_action` ops may follow a `run_action`: targets resolve before anything runs, and an action can add, delete or reorder tracks.
- **Targets**: tracks by 0-based index, exact name (then case-insensitive), `"{GUID}"`, or a `"$ref"` bound by an earlier `add_track`/`add_fx` via `as: "$name"`. A digit string matches a track name first, then the index. FX by index, unique name substring, or `$ref`. A numeric FX index means the slot when that op runs, so after `add_fx` with `position: 0` the older FX have moved up one; use a name or an `as` ref to pin a specific FX. Validation checks FX refs against each track's chain as earlier ops (`add_fx`, `graft_fxchain`) change it.
- **Two passes**: every target is resolved before anything is written; an unknown/ambiguous track or an undefined `$ref` rejects the whole plan. If an op fails mid-apply, the undo block is closed and undone (only when the top undo entry is the plan's own), so no partial edit remains.
- **`dryRun: true`** returns the resolved op list, `conflicts`, and `warnings` (e.g. an FX name not found in the installed-FX list) without writing.
- **`idempotencyKey`**: the bridge remembers the last 100 applied keys; re-sending one returns `{ alreadyApplied: true, result }`. The TS tool also uses a 120 s timeout so a slow apply is not reported as failed and retried.
- **`graft_fxchain`** copies a source `<FXCHAIN` block (from a track via `from`, or a base64 track chunk via `fromChunk`) onto the target, replacing the target's FX chain while keeping its items, envelopes, and sends. FXIDs are regenerated. It does not copy sends: sends live as `AUXRECV` lines on the receiving track and are outside the FX chain. Input FX (`<FXCHAIN_REC`) are not copied either.
- **No SWS needed**: the ops travel as a JSON string that `mcp_plan_lib.lua` decodes with its own small JSON decoder (SWS has no `CF_Json_Parse`; it is used only if present). Malformed JSON rejects the plan and writes nothing.

### Actions Proxy Concepts

- **Ids**: native actions have fixed numeric ids (`40001`). Custom actions, scripts and extension (SWS) actions get session-specific numbers; their stable handle is the named id (`"_aee8…"`, `"_SWS_…"`) — store and pass that. A digit string is a command id; anything else is a named id (leading `_` optional) or an exact, unique action name.
- **Sections**: `main` (default), `midi_editor` (needs an open MIDI editor), `midi_event_list`. The inline MIDI editor and media explorer have no command entry point.
- **Selection first**: most actions act on the selected tracks/items. Use `set_selected_tracks` / `set_selected_items`, or in one undo step `run_plan` with `select_tracks` then `run_action`.
- **Safety**: an action whose name ends in `...` opens a modal dialog that blocks REAPER's main thread (and with it the bridge) until a person closes it, so it is refused unless `allowDialog: true`. Any `File: Save…` action on a never-saved project counts as a dialog (REAPER asks for a path). Quit, close/open/new project, new or closed project tabs, switching tabs (native and SWS) and opening another project (SWS Resources slots, associated item projects) are always refused (REAPER names some with a `File:` prefix and some without, e.g. "Close current project tab"; both are matched). A Custom: macro is judged by every step it runs, nested macros included (steps are read from `reaper-kb.ini`). `search_actions`, `get_action` and `run_plan`'s dry run flag all of this (`opensDialog`, `denied`). A ReaScript can still open its own prompt — the gate only sees action names.
- **Search runs in Lua**: enumerating all ~6k main-section actions takes a few ms in REAPER; only matches (up to `limit`, max 100) cross the bridge, with the `total` count.

### Project Operations Concepts

- **No dialogs**: `save_project` without `path` on a never-saved project is refused (REAPER would open Save As) — the same rule `run_action` applies to `File: Save…`. `render_project` refuses when a target file exists (REAPER would ask to overwrite) unless `overwrite: true`, which deletes those files first, and when `bounds` is `time_selection` with no time selection.
- **Render formats**: `format` and `secondaryFormat` (a second file from the same render; `none` disables it) take wav/aiff/flac/mp3/ogg/opus, with REAPER's default options except the bit depth or MP3 bitrate `bitDepth` / `mp3Bitrate` set. `render_project` refuses when either is another encoder (seen live: a template's video secondary format left a modal dialog open) — set `secondaryFormat: "none"`.
- **Render source and encodings** (probed in REAPER 7.40): `source` maps to `RENDER_SETTINGS` (master 0, master_and_stems 1, stems 3 = stems of the *selected* tracks, selected_via_master 128, region_matrix 8, which needs region bounds, selected_items 32, selected_items_via_master 64; 2 renders nothing in REAPER 7). Bit depth lives in the `RENDER_FORMAT` blob (wav `evaw`+int16 bits, 32-bit int is 0x21 and float 0x20; aiff `ffia`; flac `calf`+int32 bits+compression), MP3 bitrate at bytes 4 and 24 of `l3pm`. Normalize target and limit ceiling are given in dB and stored linear (`RENDER_NORMALIZE_TARGET`, `RENDER_BRICKWALL`); REAPER hits both exactly.
- **Render analysis**: each rendered file (up to 16) is measured with `CalculateNormalization` (target 0 dB, so the gain is the level): LUFS-I, true peak, sample peak; `analyze: false` skips it.
- **Render metadata**: `metadata` fields (title, artist, album, genre, year, isrc, comment, description) write the matching ID3/INFO/VORBIS/AXML/BWF keys of `RENDER_METADATA`; `metadataRaw` sets any `SCHEME:KEY`; an empty value removes the key. Setting metadata turns on embedding (`RENDER_SETTINGS` &512) unless `embedMetadata: false`.
- **Render versions**: `render_versions` mutes each version's tracks on top of the current mutes and renders to the version's pattern; mutes and the pattern are always restored (the selection is never touched). Use it for instrumental / a cappella / TV mixes instead of muting by hand.
- **Render is synchronous**: action 42230 blocks REAPER (and the bridge) until the render finishes. Keep renders short (a time selection or custom bounds). `targets` in `get_render_settings` are the files REAPER will write (`RENDER_TARGETS`).
- **Undo**: every edit by these tools is one undo point labelled `MCP: …`, so `undo_project` reverts exactly that edit. Repeat and metronome changes are not undoable in REAPER.
- **Validation first**: invalid input (unknown marker/region/tempo index, BPM <= 0, unsupported format, end <= start) is refused before anything is written.
- **Tempo indexes** are `get_tempo_map` indexes; a map with `tempoMarkerCount: 0` holds only the project tempo, set it with `set_project_tempo`. Adding a marker where one already is replaces it (`replacedExisting: true`). REAPER can silently keep the start marker on delete; `delete_tempo_marker` then returns an error instead of a false success. `set_project_tempo` never uses `SetCurrentBPM` with markers present (it inserts a marker at the edit cursor).

### Items, Takes & FX Files Concepts

- **Logic lives in `reaper/mcp_items_lib.lua`** (pure Lua over an injected API and file system, unit-tested via wasmoon in `items-lib.test.ts`); the bridge handlers only pass `reaper`, `mcp_plan_lib.lua` and a small `io`-based file system in.
- **Validate, then write**: every input (track/item/take/FX index, file, color, shape, path) is checked before the first write; a refused call changes nothing and says why. Each write is one undo point.
- **Takes**: `takeIndex` is optional on take FX tools and defaults to the active take. Take FX are separate from track FX.
- **Fade shapes**: 0 linear, 1 fast start, 2 fast end, 3 fast start (steep), 4 fast end (steep), 5 slow start/end, 6 slow start/end (steep); curves are -1..1.
- **Files stay inside REAPER's resource folder**: `save_fx_chain` / `save_track_template` take a name (subfolders allowed) under `FXChains/` or `TrackTemplates/`; absolute paths, drive letters and `..` are refused, and an existing file is only replaced with `overwrite: true`. Loads also accept an absolute path with the right extension.
- **Chunks, like `graft_fxchain`**: loading a chain or inserting a template edits track state chunks with `mcp_plan_lib.lua`'s helpers, regenerating FXIDs (and TRACKID/item GUIDs for templates). A saved template drops receives (`AUXRECV`) and folder state (`ISBUS`), which depend on the surrounding tracks.

### Envelope / Automation Concepts

- **Creating envelopes**: Use `create_track_envelope` before adding points. Built-in envelopes use `envelopeName` ("Volume", "Pan", "Mute", "Width", "Trim Volume"). FX parameter envelopes use `fxIndex` + `paramIndex`.
- **Logic lives in `reaper/mcp_envelopes_lib.lua`** (pure Lua over an injected API, unit-tested via wasmoon in `envelopes-lib.test.ts`); the bridge handlers only pass `reaper` in.
- **Envelope values**: give `db` on volume envelopes (Volume, Trim Volume, Send Volume). REAPER's own Volume envelope is fader-scaled (716.2 = 0 dB, not 1.0); `db` is converted with the envelope's scaling mode (`ScaleToEnvelopeMode`). Raw `value`: Pan -1.0 to 1.0, Mute 0 or 1, FX parameters 0..1.
- **Automation items**: instances of one pool share their points, so editing one edits every instance; pool ids are project-wide, so pools reach across tracks. Point calls use the item index with `0x10000000` (one loop iteration = the pool's own points), except `SetEnvelopePointEx`, which ignores a flagged index (REAPER 7.40) and takes the plain one. A new pool's `D_POOL_QNLEN` is set to the item's length, since REAPER can make it shorter and drops pool points past it without an error; a point at the item end is kept 1 ms inside, and points outside an item are refused.
- **Section levels** (opinionated): pooled automation items on the Volume envelope, one pool per section type, never item gain (`knowledge/workflows/section-levels.md`).
- **Transient-driven automation** (lighting): `create_transient_automation` from a track render (a warped item's file is read without its stretch markers), onto a new muted track's plugin envelope (`knowledge/workflows/transient-lighting.md`).
- **Point shapes**: 0=linear, 1=square, 2=slow start/end, 3=fast start, 4=fast end, 5=bezier
- **Workflow**: `create_track_envelope` → `insert_envelope_point`/`insert_envelope_points` → optionally `set_envelope_properties` to arm for writing
- **Batch operations** (`insert_envelope_points`): Pass a JSON array of point objects for efficient multi-point automation curves
- **SWS extension**: `set_envelope_properties` works best with SWS installed; falls back to state chunk editing without it

## Large Response Handling

MCP tool responses must stay within token limits. When a tool could return unbounded data (e.g., all notes in a large MIDI item), apply these patterns:

1. **Provide an analysis/summary tool**: Compute aggregated stats server-side (in Lua) rather than dumping raw data for the AI to process. Example: `analyze_midi` returns per-pitch velocity stats, histograms, and machine gun detection — everything Claude would compute anyway — in ~2KB instead of 475KB of raw notes.

2. **Support pagination**: Add `offset` and `limit` parameters so the client can request data in chunks. Example: `get_midi_notes` with `offset=0, limit=100` returns the first 100 notes and includes `hasMore: true` and `total: 2044`.

3. **Prefer summary-first workflows**: Tool descriptions should guide the AI to use the summary tool first, then paginate raw data only when needed for targeted edits.

When adding new tools that could return large datasets, always implement both a summary path and a paginated path. The summary tool should return everything the AI typically needs to make decisions in a single call.

## Build System

- **Nx 20** with inferred targets via `@nx/eslint/plugin` and `@nx/vite/plugin`
- **esbuild** bundles the server app into `dist/apps/reaper-mcp-server/main.js` (ESM, Node 20)
- **tsc** compiles the protocol library to `dist/libs/protocol/`
- `reaper/` directory is copied as build assets so the `setup` command can install bridge files
- **Nx Cloud** enabled for remote caching

### Nx Targets

| Target | Inferred By | Description |
|--------|-------------|-------------|
| `build` | project.json (explicit) | Build with esbuild (server) or tsc (protocol) |
| `lint` | `@nx/eslint/plugin` | ESLint with typescript-eslint + Nx module boundaries |
| `test` | `@nx/vite/plugin` | Vitest (watch: false, passWithNoTests: true) |
| `typecheck` | `@nx/vite/plugin` | `tsc --noEmit` |
| `serve` | project.json (explicit) | Run the built server |

### Common Commands

```bash
pnpm nx build reaper-mcp-server     # Build server (bundles protocol dep)
pnpm nx build protocol              # Build protocol library only
pnpm nx lint reaper-mcp-server      # Lint server
pnpm nx test reaper-mcp-server      # Test server
pnpm nx run-many --target=build     # Build all
pnpm nx run-many --target=lint      # Lint all
pnpm nx run-many --target=test      # Test all
pnpm nx run-many --target=build,lint,test  # All targets at once
pnpm nx affected --target=build     # Build only affected by changes
```

## TypeScript Configuration

- Root `tsconfig.base.json` defines shared settings (ES2022, ESM, strict, bundler resolution)
- Path alias: `@reaper-mcp/protocol` -> `libs/protocol/src/index.ts`
- Each package has its own `tsconfig.json` extending the base
- The server's tsconfig has `references` to protocol for project references

## Adding New MCP Tools

To add a new tool, touch these 6 places:

1. **`libs/protocol/src/commands.ts`** -- Add command type to `CommandType` union, add params interface
2. **`libs/protocol/src/responses.ts`** -- Add response data interface if needed
3. **`apps/reaper-mcp-server/src/tools/`** -- Create or extend a tool file, register with `server.tool()`
4. **`apps/reaper-mcp-server/src/cli.ts`** -- Add tool name to `MCP_TOOL_NAMES` array (used by `ensureClaudeSettings()` to auto-allow tools)
5. **`apps/reaper-mcp-server/src/tools/categories.ts`** -- Add tool name to a category in `TOOL_CATEGORIES` (the bridge-coverage test fails on an uncategorized tool)
6. **`reaper/mcp_bridge.lua`** -- Add handler function in the `handlers` table

**Important:** Always use `z.coerce.number()` instead of `z.number()` for numeric parameters. MCP clients may pass numbers as strings (e.g. `"39"` instead of `39`), and `z.coerce` handles the conversion automatically.

### Tool Registration Pattern

```typescript
// In tools/example.ts
import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerExampleTools(server: McpServer): void {
  server.tool(
    'tool_name',
    'Description of what this tool does',
    { paramName: z.coerce.number().describe('What this param means') },
    async ({ paramName }) => {
      const response = await sendCommand('command_type', { paramName });
      if (!response.success) {
        return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    },
  );
}
```

Then register in `server.ts`:
```typescript
import { registerExampleTools } from './tools/example.js';
// ... inside createServer()
registerExampleTools(server);
```

### Lua Handler Pattern

```lua
-- In mcp_bridge.lua, add to the handlers table:
handlers["command_type"] = function(params)
  -- Use ReaScript API
  local result = reaper.SomeApiCall(params.paramName)
  return { someField = result }
end
```

## Python Sidecar (Semantic Audio Analysis)

An optional long-lived Python subprocess for AI-powered perceptual audio analysis (`analyze_track_aesthetics`) and offline signal analysis (`analyze_track_offline`, `analyze_audio_file`, `measure_track_alignment`).

### Sidecar Architecture

```
MCP Server (Node.js)
    |
    | newline-delimited JSON-RPC 2.0 over stdin/stdout
    v
Python sidecar (long-lived child process)
    |
    | loads model once at startup; inference per request
    v
Audiobox Aesthetics predictor (CC-BY 4.0)
```

### Key Design Points

- **Opt-in**: The sidecar is installed separately via `setup-sidecar`. `pnpm install` and `pnpm nx build` never touch Python.
- **Lazy spawn**: The sidecar process spawns on the first sidecar tool call, not at server startup; the aesthetics model loads only on the first `analyze` request.
- **JSON-RPC methods**: `analyze` (aesthetics, with optional `normalizeLufs`), `analyze_audio` (loudness/spectrum/reference, `sidecar/analysis.py`), `align` (cross-correlation delay + polarity), `transients` (per-band spectral-flux onsets: low <150 Hz, mid, high >4 kHz, each band scaled to its own 99th percentile so a kick counts as much as a hat; dominant band by mean per-bin log rise; tempo from the onset autocorrelation).
- **Audio loading**: always `soundfile` (`analysis.load_audio`). torchaudio 2.9+ removed `info()` and moved `load()` to torchcodec, so never call `torchaudio.load`/`torchaudio.info`; `torchaudio.functional` (filters, resampling) is fine.
- **Loudness**: `analysis.py` implements ITU-R BS.1770-4 (K-weighting, 400 ms blocks, -70/-10 gates, channels summed) and EBU 3342 LRA; `tests/test_analysis.py` checks them against the EBU 3341/3342 reference signals.
- **Lifecycle**: Sidecar receives SIGTERM when the MCP server receives SIGINT/SIGTERM. Managed via `getSidecarClient().shutdown()` in `main.ts`.
- **Auto-restart**: If the sidecar crashes, one restart is attempted automatically. If restart fails, the tool returns a clear error.
- **Script refresh**: every sidecar spawn first copies the build's `server.py` and modules over the installed ones, so an update (which never re-runs `setup-sidecar`) cannot leave an old `server.py` without the new methods.
- **Install location**: Venv at `~/.reaper-mcp/sidecar-venv/`, scripts at `~/.reaper-mcp/sidecar/` (`server.py` plus `SIDECAR_MODULES` in `setup-sidecar.ts`, e.g. `analysis.py` — add a new module there).
- **PYTHON_BIN env var**: Override the Python interpreter used by `setup-sidecar`.

### Source Files

| File | Purpose |
|------|---------|
| `apps/reaper-mcp-server/sidecar/server.py` | Python sidecar JSON-RPC server (source) |
| `apps/reaper-mcp-server/sidecar/analysis.py` | Loudness (BS.1770, LRA, true peak), spectrum hints, reference comparison, alignment, normalization (numpy/torch only) |
| `apps/reaper-mcp-server/sidecar/requirements.txt` | Pinned Python deps |
| `apps/reaper-mcp-server/src/sidecar.ts` | Node.js subprocess lifecycle + JSON-RPC client |
| `apps/reaper-mcp-server/src/setup-sidecar.ts` | `setup-sidecar` CLI command implementation |
| `apps/reaper-mcp-server/src/tools/aesthetics.ts` | `analyze_track_aesthetics` tool registration |
| `apps/reaper-mcp-server/src/tools/offline.ts` | `analyze_track_offline`, `analyze_audio_file`, `measure_track_alignment` |
| `apps/reaper-mcp-server/src/tools/transients.ts` | `detect_transients`, `create_transient_automation` (pulse generation in `pulsePoints()`) |

### Render Pipeline

The sidecar tools render a track segment to a temp WAV via the `render_track_to_wav` Lua bridge handler (a track renders as a stem — render mode 3, stems of the *selected* tracks only, so the target is soloed and made the only selected track; mode 2 lists no target in REAPER 7 and falls back to the master mix, which renders silence for a track that reaches the master only through sends; -1 renders the master mix, mode 0, with every solo cleared; solo and selection are restored after), then pass the path to the sidecar. The TS layer owns temp file cleanup (always deleted in `try/finally`).

The `render_track_to_wav` Lua handler uses `Main_OnCommand(42230)` which is **synchronous** — it blocks the defer loop during render (~0.5-1s for a short clip; a 4-minute folder track took ~55 s, so `offline.ts` scales the timeout with the range). This is expected behavior documented in the handler.

### Future Phases

The sidecar architecture admits new JSON-RPC methods easily — future phases (CLAP, MERT, Demucs, Parakeet, Essentia) just add new methods to `server.py` and new tools in TypeScript. The IPC channel and subprocess lifecycle are shared infrastructure.

## Spectrum Analysis (JSFX + gmem)

The JSFX analyzer (`mcp_analyzer.jsfx`) runs in REAPER's audio thread:
- Performs configurable FFT (512-8192 bins, default 4096)
- Writes magnitude spectrum to `gmem[]` under namespace `MCPAnalyzer`
- gmem layout: one 4100-value block per track at `(trackIndex + 1) * 4100` (master = 0; the bridge sets the slot on slider4): `[bin_count, peak_dB, rms_dB, bin[0], bin[1], ...]`, bins in frequency order (`fft_permute` after `fft_real`)
- The "MCP Meters" container holding the meters is force-enabled on every read: REAPER 7.40 creates it bypassed when it is a track's only FX
- Lua bridge reads via `reaper.gmem_attach("MCPAnalyzer")` + `reaper.gmem_read()`
- Auto-inserted by `read_track_spectrum` tool, passes audio through unmodified

## Live MIDI Output (JSFX + gmem ring buffer)

The MIDI emitter (`mcp_midi_emitter.jsfx`) uses a 16-slot ring buffer — the **reverse** direction of the analyzers:
- Lua bridge **writes** 3-byte events; JSFX **reads** and emits via `midisend()` in `@block`
- Namespace `MCPMidiEmitter`; gmem layout: `[write_head, read_head, slot0_status, slot0_d1, slot0_d2, ...]`
- `write_midi_to_ring(status, d1, d2)` in `mcp_bridge.lua` is the single write path — use it for all MIDI event types
- Deferred note-off (`send_midi_note` with `durationMs`) uses the same ring path; no separate code path
- Auto-inserted by all three live MIDI tools via `ensure_jsfx_on_track(track, MCP_MIDI_EMITTER_FX_NAME)`

## Bridge Status Page (REAPER web interface)

`reaper-mcp setup` installs `mcp_bridge.html` into `{REAPER_RESOURCE_PATH}/reaper_www_root/` and enables
REAPER's web interface by adding `csurf_N=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''` to `reaper.ini` (port via
`REAPER_WEB_PORT`; an existing HTTP surface is kept). It only edits `reaper.ini` while REAPER is closed — REAPER
rewrites it from memory on exit. On start the bridge opens the page as a small Chromium `--app` window (falls back to
the default browser; toggle `OPEN_UI_ON_START`) and only uses the ReaScript console when the web interface is missing.
`?demo` previews the page with fake data.

**Developing the page or the bridge: run `pnpm dev:bridge`** (`apps/bridge-ui/dev.mjs`) and open
`http://localhost:8098/mcp_bridge.html`, never REAPER's own `:8099` page.

- It rebuilds the page on every save (unminified, inline sourcemap) and reloads each open tab over `/__dev/events`.
- It proxies `/_/*` to REAPER over one keep-alive socket (`http.Agent`, `maxSockets: 1`) and never aborts an upstream
  request. Aborting closes the socket from the client side, the one close REAPER's web server never frees (see Stuck
  sockets below); a browser talking to REAPER directly hangs up on every reload, idle drop, and devtools refresh.
- A saved `reaper/` file listed in `REAPER_ASSETS` (`cli.ts`, read as text) is copied into REAPER: Lua into
  `Scripts/`, then the running bridge is asked to restart with the token from its status feed; JSFX into
  `Effects/reaper-mcp/`, where it loads only when the plugin is re-added.
- `build.mjs` and `dev.mjs` share the esbuild options and HTML template in `build-config.mjs`; change the page's build
  there so production and dev stay the same.
- Overrides: `BRIDGE_DEV_PORT` (8098), `REAPER_WEB_PORT` (8099), `REAPER_RESOURCE_PATH`.

```bash
# correct: the page talks to the dev server; REAPER sees one connection all session
pnpm dev:bridge   # then open http://localhost:8098/mcp_bridge.html
# incorrect: reloading REAPER's page or scripting it with curl leaks one REAPER socket per hang-up
open http://localhost:8099/mcp_bridge.html; curl http://127.0.0.1:8099/_/GET/EXTSTATE/MCPBridge/status
```

- Dedupe: every page poll is `SET/EXTSTATE/MCPBridge/ui_seen/<ms>;GET/EXTSTATE/MCPBridge/status`; the bridge skips
  opening a window when `ui_seen` is under 6s old (the page keeps pinging every 2s while hidden).
- Stuck sockets: REAPER's web server never frees a socket whose client hung up first (curl, Chrome dropping an idle
  connection); it stays in CLOSE_WAIT/CLOSED, and near 100 the server stops answering until REAPER restarts. The
  bridge counts them every 30 s (`web_watch` in `mcp_bridge.lua`: `lsof` in the background into
  `mcp_bridge_data/web_sockets`, macOS/Linux) and publishes `status.web = { stuck, limit }`; the page warns from 50%
  (`webSocketLevel()` in `status.ts`) and the bridge prints one console line at 90%. Test scripts that hit the web
  server reuse one connection (one `curl` with several URLs), or each request leaks a socket.

- The bridge publishes JSON to **non-persistent ExtState** `MCPBridge/status` (in memory, no disk IO): counters,
  defer-loop timing, and the last 50 commands (`n` seq, type, handler ms, ok, error). Throttled to ≤5 Hz and only
  when something changed, plus a 1s liveness tick. `_`-prefixed internal commands are excluded.
- The page polls `/_/GET/EXTSTATE/MCPBridge/status` every 500 ms (paused while the tab is hidden), keeps a
  1000-entry log in the browser, and renders entirely outside REAPER — no gfx/ImGui redraw on the main thread.
- Persistence: every logged command is appended to `<bridge dir>/history_log.jsonl` and the timeline is saved to
  `history.json` (every 30s and on exit); both reload on start, pruned to 7 days and the newest 1000 entries, and
  `n` continues across restarts (also saved in `history.json`). The saved log is published as ExtState `MCPBridge/log`
  (newest first) only on request: the page writes `MCPBridge/log_want/<ts>` on open, after a bridge restart, and when
  the 50-entry window skipped entries; the bridge answers once with `req` echoing it, and the page keeps only the answer
  to its latest request.
- Timeline: per-10s buckets for the last hour (sparse, `[id, total, errors, slow, sumMs]`) in ExtState
  `MCPBridge/history` (≤ 1 Hz), and 1m (24h) + 10m (7d) tiers in `MCPBridge/history_long` (≤ every 10s, polled every
  10s). The page draws each range (5m–7d, a listbox combo box) from the finest tier covering it (`timelineBars()`);
  dragging across bars selects a span that filters the log views, leaving the range unchanged. Without a span the
  Calls and Tools views (and their counts) show the range too; older matches end the list with a button that widens
  the range to the next one that includes them.
- URL state: navigation state lives in the query string via `useUrlState(key, default, { validate })` in
  `src/url-state.ts` (a History API port of LoreKit web's hook: JSON values, a value equal to the default is dropped,
  changes in one tick become one history entry), so Back/Forward step through it and a link or reload reopens it.
  Params: `view`, `range`, `span` (dragged timeline span), `filter` (all/errors), `q` (search; replaces, never pushes),
  `agent`, `entry` (open command by `n`), `sort` (Tools), `settings`, and on Plugins `coverage`, `inProject`, `plugin`
  (open plugin by FX name). Opening, closing or switching a drawer by click (a row, "Previous call") pushes; ↑/↓ between rows replaces. `view` and `range` default
  to the last pick in localStorage, so the bridge's bare `mcp_bridge.html` opens where you left off. Use it for any new
  state a viewer would want to go back to or share (tabs, filters, an open drawer); keep transient UI (hover, drag,
  copied flags) and per-viewer preferences (grouping, tokens) in `useState`/localStorage. Give each param a
  `validate` guard so a stale or hand-edited link falls back to the default, and keep keys unique across views.
- Search (`parseQuery()` / `matchesQuery()` in `status.ts`): space-separated terms, all must match. A word matches the
  command name, error or params text; `key:value` matches one param exactly (`trackIndex:6` is not 16; quote values
  with spaces, `fxName:"VST3: Pro-Q 3"`). Selecting text in a command's Params offers **Filter** (the whole param when
  the selection is on one `"key": value` line, `termFromSelection()`), which adds the term to `q` with a push.
- Measurement results: the bridge keeps a compact result `r` (built in `reaper/mcp_edit_views_lib.lua`, which keeps
  `mcp_bridge.lua` under Lua's 200-locals limit) on meters/LUFS/correlation/crest/spectrum entries
  (`RESULT_FIELDS`, 48 spectrum bands) and, for `render_track_to_wav`, a waveform read from the WAV before the server
  deletes it (`wav_waveform()`: 120 min/max slices, peak/RMS dBFS, clipped sample count; drawn on a dB scale to −48). `Measurement.tsx` draws them,
  colored by value (amber from −6 dB, red at 0), with the previous call on the same track ghosted (dashed/hollow) and
  its headline value and change in a "Previous call" line. Add a measuring command in `RESULT_FIELDS`, `MEASUREMENTS`
  (`status.ts`) and a `Measurement` kind together.
  Sidecar tools the server composes itself (`analyze_track_offline`, `analyze_audio_file`, `measure_track_alignment`,
  `analyze_track_aesthetics`) never pass through a bridge handler, so the server logs each result with the internal
  `_log_result` command (`src/tool-log.ts`, fire-and-forget; `r` travels as a JSON string), which the bridge records as
  an entry for that tool (`record_tool_result()`). Their compact `r` is built by `offlineSummary()` /
  `alignmentSummary()` / `aestheticsSummary()` and drawn as the `offline` / `alignment` / `aesthetics` measurements.
- Edit views: writes and listings also keep an `r` (`M.summary` in `mcp_edit_views_lib.lua`), drawn by
  `EditViews.tsx` from `editViewOf()` (`src/edit-views.ts`). A write reads the state it touches before its handler
  runs (`M.before`) and again after, so the drawer shows before → after: track and FX parameter changes (the
  plugin's own readout), the automation window an edit touched (padded 25%, at least 4 s; automation items drawn as blocks tinted by
  pool with their name and shared curve, moved/deleted items and a changed pool's old curve dashed), MIDI notes as a piano
  roll (first 256, `more` counts the rest; added notes solid, removed dashed), `analyze_midi` velocity per pitch,
  markers/regions/tempo/items on one timeline, `list_tracks` as a mixer, and `run_plan`'s ops; also FX chains
  (add/remove/move/copy/bypass/offline/rename/preset, `get_track_properties`: slots marked added/moved/changed/removed by
  FX GUID), item edits as one lane per touched track with the items before dashed, track structure edits on the mixer
  (tracks diffed by GUID), routing (sends/receives/hardware outs with level bars, the old level ghosted), the time
  selection and edit cursor, MIDI CC as a stepped lane in beats (the automation view, unit `cc`), and
  `get_fx_parameters` as readout bars; `render_project` / `render_versions` as a render result (one row per file,
  ≤8: mini waveform from `PCM_Source_GetPeaks`, LUFS-I against the normalize target, true peak against the limit
  ceiling, length; versions grouped with their muted tracks; format, source and target as readouts); and arrangement
  edits (`op`, the `span` they opened, cut or copied from
  hatched or outlined, where they copied `to`, a lane for up to 4 touched tracks plus `moreTracks`, normalized items
  with their gain as a 7th item field). List diffs share `listDiff()` in `edit-views.ts`. Lists are capped so
  an entry stays a few KB. Add a command in `M.summary`, `KIND_OF` (`edit-views.ts`) and a gallery story together;
  behaviour tests run the real bridge in wasmoon (`bridge-status.test.ts`, "edit views in the log").
- Short windows (≤ 640px tall, an app window docked beside REAPER): the log is the page. Stats, timeline and footer
  hide; the header's Rebuild & reload, Settings and GitHub fold into a ⋯ menu (`HeaderMenu`, dotted when a rebuild
  is available) with a **Stats & timeline** toggle (`mcp-bridge-overview` in localStorage). The log's toolbar is one row: a grouped combo box
  (`GroupedCombobox` in `Combobox.tsx`, LoreKit's Combobox in headed groups: View, Show, Agent, Actions) and the search box. CSS switches it: `@media (max-height: 640px)`.
- Narrow drawer: the drawer is resizable, so its content answers to its own width with container queries
  (`.drawer-body` and `.measure` are `inline-size` containers), never `@media`. Under ~300px readouts go two a row,
  the mixer drops its pan column, and what gives way stays reachable (the ISO timestamp is the When row's tooltip,
  marker labels that would collide — `fittingLabels()` in `edit-views.ts` — show on hover; on item and selection
  views, where markers are only context, every marker name waits for hover). Under ~460px mixer and
  route rows drop their added/moved/changed word for a coloured edge plus one legend (`ChangeLegend`), so names stay
  readable. Structure edits in a big project draw a 64-row window around the change (`from`). Check new views at
  ~300px in the gallery.
- Component gallery (`?gallery`, like Storybook): the page's real components from fixed example data, every
  state side by side (`src/Gallery.tsx`, stories in `src/gallery-stories.ts`). Opens only from a local build
  (`file://`) or when the bridge runs in developer mode (`galleryAllowed()`; while REAPER is unreachable, the mode it last reported, `developerMode()`); otherwise the page opens as usual.
  Shift-click the logo to get there. Add a story with every new component or state; `gallery-stories.test.ts`
  fails when a measuring command or an edit view kind has no story.
- Slow (≥100 ms) / very slow (≥500 ms) marks skip commands that are slow by nature (renders, plugin loads, project
  IO, `run_plan`/`run_action`): `LONG_RUNNING` in `status.ts` and `mcp_bridge.lua`, kept equal by `status.test.ts`.
- Installable PWA: `apps/bridge-ui/public/` (manifest, service worker, icons) is copied next to the page; every file is
  `mcp_bridge*` and the service worker is scoped to `/mcp_bridge` so REAPER's other web remotes are untouched.
- Sessions: each `reaper-mcp serve` process tags every command with flat top-level `sessionId` / `sessionDir` /
  `sessionClient` (from Claude Code's `CLAUDE_CODE_SESSION_ID` / `CLAUDE_PROJECT_DIR`, else `pid-<n>` / cwd — no hook
  needed) and pings `_session` every 20s plus a goodbye on exit (`src/session.ts`). The bridge keeps the last hour of
  sessions in the status; the page shows connected agents, per-session chips, and Calls / Tools / Sessions views.
  Entries also carry `s` (session) and `p` (params JSON, truncated to 400 chars).
- Settings the page writes via `/_/SET/EXTSTATE[PERSIST]/MCPBridge/<key>/<0|1>`, echoed back in `status.settings`:
  `cfg_paused` (in-memory: every non-`_` command fails until resumed or REAPER restarts), `cfg_readonly` (persistent:
  only `get_`/`list_`/`read_`/`analyze_`/`search_`/`measure_` + transport/navigation pass — `readonly_allows()`,
  mirrored by `commandKind()` in `status.ts`), `cfg_open_on_start` (persistent, overrides `OPEN_UI_ON_START`).
  Desktop error notifications are page-side (Notification API + localStorage).
- `status.health` (re-checked every 10s): SWS present, JSFX installed in `Effects/reaper-mcp/`, and `outdated` when the
  installed `mcp_bridge.lua` differs from the running copy (setup ran; restart the script). Tested in wasmoon by
  `bridge-status.test.ts`.
- One-click update and restart (`status.control`): the page checks GitHub's latest release (cached 6h in
  localStorage, `src/update.ts`) and offers **Update**; the outdated notice offers **Restart bridge**. The page writes
  `/_/SET/EXTSTATE/MCPBridge/request/<update|restart>-<token>`; the token is random per bridge run and only readable
  from the status feed (REAPER's web server sends no CORS headers), so other sites can fire the request but never with
  a valid token. Update runs `<clone>/scripts/update.sh` (`git pull --ff-only` + `install.sh`; refuses on local changes)
  detached, with the clone and node path from `Scripts/mcp_update.conf` (written by `setup` when it runs from a git
  clone; never on Windows). The bridge starts with `set_action_options(1)` (REAPER 7.03+), so re-running
  `mcp_bridge.lua` stops it; restart switches to `set_action_options(3)` and re-runs its own action, and REAPER
  relaunches the installed copy. It restarts itself after a successful update; the page reloads when
  `startedAt` changes (or once when the update is done, if the bridge script didn't change).
  **Developer mode** (`settings.dev`): `setup` writes `dev=1` for a clone with uncommitted changes, a branch other
  than `main` or unpushed commits (`isDevClone()` in `cli.ts`); the Settings toggle (`cfg_dev`, persistent) overrides
  it. In dev mode the release notice is hidden and, once source files are newer than the last install (a detached `find -newer mcp_update.conf` every 5s, `control.changed`), the header shows **Rebuild & reload** (request `rebuild-<token>`):
  `update.sh --rebuild` builds the working tree as it is (`--skip-nx-cache`) and runs `setup`, no git involved.
- Plugins tab: the bridge publishes every installed FX (native `EnumInstalledFX`, REAPER 6.37+; the same list
  `list_available_fx` returns) to ExtState `MCPBridge/installed` as `{v, supported, fx:[{n,t}]}`, re-enumerated every 60s
  and republished only on change (`.jsfx-inc` libraries are skipped). FX in the open project (track, master, input and
  take FX, by original name via `fx_name`) go to ExtState `MCPBridge/used` as `{v, fx:[{n,c}]}`, recounted when the
  project state changes; the page polls `used` every 5s and `installed` every 30s. Rows group by creator (record vendor,
  else REAPER's `(Vendor)` suffix), project plugins first, with Teach prompts per row, per creator and for all. Plugin records come straight from LoreKit's **REST** API
  (`GET /memories`, which allows browser origins — the server's `/mcp` endpoint does not): the built-in layer with the
  public token, which `build.mjs` reads out of `tools/knowledge.ts` at build time, and the viewer's own `user::` records
  only with their own `lk_ro_` token from Settings (kept in localStorage, never sent to the bridge). Records link into
  LoreKit by row id. The tab stays hidden until the bridge has published its list. **Contribute N** (with a token, when you have
  `user::` records) opens GitHub's new-file page with them as one file under `knowledge/contributions/` (format and
  checks: `apps/bridge-ui/src/plugin-contributions.mjs`), so GitHub forks and opens the PR. The `plugin-contributions`
  workflow (`pull_request_target`, never runs PR code) comments what would be published; the maintainer's
  `publish-to-lorekit` label writes them to the built-in layer with secret `LOREKIT_PUBLISH_TOKEN` (`lk_rw_`, a
  writer in the `reaper-mcp` org) and closes the PR. Files a maintainer commits straight to `main` are published by
  running the workflow by hand (`workflow_dispatch`, job `publish-main`, optional `dry_run`): it publishes every file
  in the folder and removes them in one bot commit. Records too long for the URL open with a paste prompt
  (`PASTE_HERE` in `src/contribute.ts`) and are on the clipboard. Client: `src/lorekit.ts`,
  hook: `src/useKnowledge.ts`, matching: `src/plugins.ts`.
  Members of the `reaper-mcp` LoreKit org can skip GitHub: an `lk_rw_` token under
  Settings → **Publish to built-in** (localStorage, separate from the read token) adds a **Publish to built-in** button
  to their own records. It runs the same `parseContribution` checks, `POST /memories` with `org: reaper-mcp`, then
  soft-archives the `user::` copy (opt-out checkbox). LoreKit enforces write membership; add a publisher by inviting
  them to the org as a member. With that token the header's **Contribute N** becomes **Publish N to built-in**: one
  inline confirm, then each record in turn (`publishAll()`, carries on past a failure, offers Retry for the failed).
  Settings links non-members to ask on Discord or through the `contributor-request` GitHub issue form
  (`.github/ISSUE_TEMPLATE/contributor-request.yml`). Logic: `publishRecord()` in `src/lorekit.ts`; `?demo` fakes it.
  One plugin installed in several formats (same title and vendor, e.g. `VST3i:`/`CLAPi:`/`VSTi: Vital (Vital Audio)`)
  is one row (`PluginRow.variants`, VST3 preferred for the Teach prompt), counting the instances of every format.
- Snapshots tab (`view=snapshots`, shown when `status.control.snapshots`): lists the project's snapshots, loads one
  with a click or `1`–`9` (A/B/C while listening) and saves the current mix (name + optional description; a name that
  saves to an existing file asks to replace it; a blank name saves under the date and time, `timeSnapshotName()`, the
  same name the quick-save action gives). Each row renames (name + description, `snapshot_edit`) or deletes (inline
  confirm, `snapshot_delete`). While the view is open the page pings ExtState `snap_seen/<ms>` and
  reads `snapshots` once a second; the bridge re-reads the folder about once a second while pinged (a file is decoded
  again only when its size changed) and rewrites `snapshots` only when the list, the current snapshot or a result
  changed. Requests: `snap_req/<id>-<token>-<op>-<hex field>[-<hex field>…]` with the per-run control token (restore/delete:
  name; save: name, description; edit: name, new name, description); the bridge runs it as an ordinary
  `snapshot_restore` / `_save` / `_delete` / `_edit` command through the dispatcher
  (`run_command()`), so it is logged (entry `src: "page"`), one undo point, and refused while read-only or paused,
  then answers in `snapshots.result` (echoing `id`). A successful restore from anywhere becomes `current`
  (ExtState `MCP_Snapshots/current_name`, which the next/prev actions continue from). Logic:
  `reaper/mcp_snapshots_ui_lib.lua`; page: `src/snapshots.ts`, `src/useSnapshots.ts`, `src/SnapshotsView.tsx`;
  tests: `bridge-snapshots.test.ts` (wasmoon), `snapshots.test.ts`. `snapshot_save` writes metadata (name,
  description, timestamp, trackCount, scoped, fullChunk) ahead of `mixerState`.
- Usage statistics: `src/analytics.ts` is the only module that imports `@dash0/sdk-web` (pinned); components call
  `track()` / `trackView()` with a typed `TrackEvent`. Events are listed in `apps/bridge-ui/tracking-plan.yaml`; add an
  event there and in `TrackEvent` together, never with names, search text, tokens or paths. The destination is the
  server's `DEFAULT_DESTINATION` (read by `build.mjs` from `telemetry-consent.ts`), service `reaper-mcp-bridge-ui`.
  On by default, off via Settings → Privacy, GPC/DNT, or `?demo`; fetch/xhr tracing stays off (the page polls the bridge).
- Payload shapes live in `apps/bridge-ui/src/status.ts` (`BridgeStatus`, `BridgeHistory`, `LongHistory`) and
  `publish_status()` / `publish_history()` / `publish_log()` in `mcp_bridge.lua` — change both together.

## Platform-Specific Paths

The bridge auto-detects REAPER's resource path:
- **macOS**: `~/Library/Application Support/REAPER`
- **Windows**: `%APPDATA%/REAPER`
- **Linux**: `~/.config/REAPER`

Override with `REAPER_RESOURCE_PATH` environment variable.

## Module Boundaries

ESLint enforces dependency rules via `@nx/enforce-module-boundaries`:
- `type:app` projects can only depend on `type:lib` projects
- `type:lib` projects can only depend on other `type:lib` projects
- The server app depends on the protocol library, not the other way around

## Testing

- **Framework**: Vitest with `globals: true`, `environment: 'node'`
- **Server tests**: `apps/reaper-mcp-server/vitest.config.ts` (has `@reaper-mcp/protocol` alias)
- **Protocol tests**: `libs/protocol/vitest.config.ts`
- **Test behaviour, never implementation**: every test asserts what a caller can observe — the tool's response
  to the agent, the error it returns, the state REAPER ends up in (through the fake API), the status feed, what the
  page renders. Never assert private helpers, internal call order, how many times a function ran, or the exact
  shape of intermediate data. A test should survive a refactor that keeps the behaviour and fail when the behaviour
  breaks; if a rename or restructure breaks it, it was testing implementation.
  - Drive the code through its public entry point (a registered tool, a bridge command, an exported pure function)
    with real inputs, and assert the outcome.
  - Mock only at the boundary you can't run (REAPER, the file system, network, the sidecar). Mocking `sendCommand()`
    is for feeding the tool a bridge response, not for asserting it was called with particular arguments — assert
    what the tool returned instead.
  - Name tests after the behaviour (`"refuses an unknown marker index and changes nothing"`), not the function.
- **Test files**: `tools/*.test.ts` (tool responses with `sendCommand()` stubbed), `*-lib.test.ts` and
  `bridge-*.test.ts` (the real Lua libraries and bridge running in wasmoon against a fake `reaper` API)
- **Validate changes with tests**: Always write small, simple, and effective tests to validate your changes. Prefer focused tests that check one behaviour well. If modifying existing code, add or update tests to cover the change before considering it complete.

## Running the MCP Server

Clone-only model: clone the fork, run the one-command installer, done.

```bash
# Full setup from a fresh clone (deps, build, link CLI, bridge, symlinks, config)
./scripts/install.sh

# The installer runs these underlying steps (each runnable on its own):
pnpm nx build reaper-mcp-server                              # build
( cd dist/apps/reaper-mcp-server && pnpm link --global )    # put `reaper-mcp` on PATH
reaper-mcp setup                                            # Lua bridge + JSFX into REAPER
scripts/sync-symlinks.sh                                    # skills + agents + knowledge → ~/.claude
reaper-mcp init                                             # tool allow-list + .mcp.json (copy-free)

# Start MCP server (stdio mode — what Claude Code runs)
reaper-mcp serve

# Diagnostics
reaper-mcp doctor    # Verify all components configured correctly
reaper-mcp status    # Quick bridge connectivity check

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/apps/reaper-mcp-server/main.js
```

### CLI Commands Reference

| Command | Description |
|---------|-------------|
| `serve` (default) | Start MCP server in stdio mode for Claude Code |
| `setup` | Install Lua bridge + JSFX analyzers into REAPER |
| `setup-sidecar` | Install Python sidecar for perceptual audio analysis (opt-in, ~831 MB). Requires Python 3.10+. Installs venv at `~/.reaper-mcp/sidecar-venv/`, downloads Audiobox Aesthetics weights. |
| `init` | Configure Claude Code — write the REAPER tool allow-list to `~/.claude/settings.json` and a `.mcp.json` that runs the clone's built `main.js` (copy-free) |
| `doctor` | Verify all components are configured correctly (includes 4 sidecar sub-checks) |
| `status` | Check if Lua bridge is running in REAPER |

> Skills + knowledge are wired by `scripts/sync-symlinks.sh` (symlinks into
> `~/.claude`), not by a CLI command — the repo is the source of truth.

### Claude Code MCP Config

```json
{
  "mcpServers": {
    "reaper": {
      "command": "node",
      "args": ["/path/to/reaper-mcp/dist/apps/reaper-mcp-server/main.js", "serve"]
    }
  }
}
```

Generated by `reaper-mcp init`: it runs your clone's built `main.js` by absolute
path, so it works without the `reaper-mcp` command on PATH.
