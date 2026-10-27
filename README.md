# reaper-mcp

AI-powered mixing for REAPER DAW. An MCP server that gives AI agents (Claude Code, etc.) full control over REAPER — real-time metering, FX management, transport control, frequency analysis, and an AI mix engineer knowledge base.

```
"Please gain stage my tracks"
"The chorus needs more energy — make the vocals cut through"
"I hear some low-end rumble, can you fix that?"
"Roast my mix — what could be improved?"
```

## Quick Start

Clone the repo, run one command, and start mixing. The mix skills, plugin
knowledge, and everything the agent learns live in your clone — versioned in git.

```bash
# Clone and enter the repo
git clone https://github.com/mthines/reaper-mcp.git && cd reaper-mcp

# One command: build, link the CLI, install the REAPER bridge,
# symlink the skills + knowledge into ~/.claude, and configure Claude Code
./scripts/install.sh
```

Then load `mcp_bridge.lua` in REAPER (Actions > Show action list > Load ReaScript
> Run) and open Claude Code — you're ready to mix. Everything the skills learn
lands in your clone.

```
/mixer Please gain stage my tracks   ·   /critique Roast my mix
```

> **Want to keep what the agent learns?** Fork the repo first, clone your fork
> instead, and commit the plugin knowledge and lessons the skills accumulate —
> they'll travel with you and ship to anyone who clones your fork. Everything
> below works the same either way; just swap in your fork's URL.

## What it does

```
Claude Code
  ├── MCP Tools (134) ──→ controls REAPER in real-time
  │   ├── Track management (list, get/set properties, add/delete/move, folders, color, groups/VCAs)
  │   ├── Master track (trackIndex -1 or "master" in track, FX, meter and routing tools)
  │   ├── FX management (add/remove, get/set parameters, enable/offline, presets)
  │   ├── FX housekeeping (move/copy/rename one FX, .RfxChain files, track templates)
  │   ├── Transport (play, stop, record, cursor position)
  │   ├── Metering (peak/RMS, FFT spectrum, LUFS, correlation, crest factor)
  │   ├── Selection (get/set selected tracks and items, time selection)
  │   ├── Markers & regions (list, add, edit, delete)
  │   ├── Tempo map (read, add/edit/delete tempo markers, project BPM)
  │   ├── Project operations (undo/redo, save, render settings, render)
  │   ├── Envelopes (list, read/write automation points)
  │   ├── MIDI editing (14 tools: notes, CC, items, analysis, batch ops)
  │   ├── Media items (11 tools: properties, split, move, trim, stretch)
  │   ├── Items & takes (insert audio files, takes, take FX, color, fade shapes)
  │   ├── Plugin discovery (list installed FX, search, presets)
  │   ├── Snapshots (save/restore/delete mixer state, optionally scoped to some tracks)
  │   ├── Routing (sends, receives, sidechains, hardware outputs, bus structure)
  │   ├── Plan executor (many edits in one call and one undo step, all or nothing)
  │   └── Actions proxy (search and run REAPER, SWS and custom actions safely)
  │
  └── Mix Engineer Knowledge ──→ knows HOW to use those tools
      ├── Plugin knowledge (ReaEQ, Pro-Q 3, Helix Native, etc.)
      ├── Genre rules (rock, pop, hip-hop, electronic, orchestral, metal)
      ├── Workflows (gain staging, vocal chain, drum bus, mastering)
      └── Reference (frequencies, compression, LUFS targets, perceived loudness, common mistakes)
```

## Architecture

```
Claude Code ←stdio→ MCP Server (TypeScript) ←JSON files→ Lua Bridge (REAPER)
                                                              │
                                              ReaScript API ←─┘
                                              gmem[] shared memory ←── JSFX Analyzers
```

REAPER's scripting environment is sandboxed — no sockets, no HTTP. The Lua bridge runs inside REAPER via `reaper.defer()` at ~30ms intervals, polling a shared directory for JSON command/response files. Round-trip latency: ~50-150ms.

The bridge also publishes its own status (connection, defer-loop timing, the last 50 commands with handler time and errors) to REAPER's in-memory ExtState. A small React page, served by REAPER's built-in web interface, reads it — see [Bridge status window](#bridge-status-window).

## Installation

### Prerequisites

- [REAPER](https://www.reaper.fm/) v6.0+ (v7.0+ recommended)
- [Node.js](https://nodejs.org/) 20+
- [SWS Extensions](https://www.sws-extension.org/) (recommended — enables plugin discovery and enhanced features)

### One command

Clone the repo and run the installer — the repo is the source of truth:

```bash
git clone https://github.com/mthines/reaper-mcp.git && cd reaper-mcp
./scripts/install.sh
```

> Prefer to keep the knowledge the skills learn? Fork first and clone your fork
> instead — see the note in [Quick Start](#quick-start).

`scripts/install.sh` runs these steps (each is also runnable on its own):

1. `pnpm install && pnpm nx build reaper-mcp-server` — deps + build.
2. `pnpm link --global` (from `dist/apps/reaper-mcp-server`) — puts the
   `reaper-mcp` command on your PATH, pointing at this clone.
3. `reaper-mcp setup` — installs the Lua bridge, snapshot scripts and JSFX into
   REAPER, installs the bridge status page, and turns on REAPER's web interface
   for it.
4. `scripts/sync-symlinks.sh` — symlinks the skills + knowledge into `~/.claude`:
   - `~/.claude/skills/<name>` → `<repo>/.claude/skills/<name>` (skill dir with `SKILL.md`)
   - `~/.claude/knowledge` → `<repo>/knowledge` (plugins, genres, workflows, reference, lessons)
5. `reaper-mcp init` — writes the REAPER tool allow-list to `~/.claude/settings.json`
   and a `.mcp.json` pointing at your local `reaper-mcp` (copy-free).

`sync-symlinks.sh` is idempotent and **refuses to overwrite a real file or
directory** (run it with `--dry-run` to preview). Because `~/.claude/knowledge`
*is* your repo, every plugin you teach and every lesson the skills learn lands in
the working tree — commit it (and, if you forked, it travels with you and ships
to whoever clones your fork).

The repo's `.claude/rules/` (architecture, development, lua-bridge, testing) are
**not** symlinked globally — they're for developing reaper-mcp, and load
automatically when you work inside the repo.

> If `reaper-mcp` isn't found in new shells, add pnpm's global bin dir to your
> PATH (where `pnpm link --global` installs) — see
> [pnpm docs](https://pnpm.io/installation).

**What `setup` installs** into your REAPER resource folder:
- `mcp_bridge.lua` — persistent Lua bridge script, plus the Lua libraries it loads (`mcp_*_lib.lua`)
- `mcp_snapshot_manager.lua` — snapshot manager GUI (save/restore/delete from REAPER)
- `mcp_snapshot_next.lua`, `mcp_snapshot_prev.lua`, `mcp_snapshot_quick_save.lua` — A/B action scripts
- `reaper_www_root/mcp_bridge.html` — the bridge status page
- `mcp_analyzer.jsfx` — FFT spectrum analyzer
- `mcp_lufs_meter.jsfx` — ITU-R BS.1770 LUFS meter
- `mcp_correlation_meter.jsfx` — stereo correlation analyzer
- `mcp_crest_factor.jsfx` — dynamics/crest factor meter
- `mcp_midi_emitter.jsfx` — live MIDI output for `send_midi_*`

It also enables REAPER's web browser interface on port 8099 (set
`REAPER_WEB_PORT` to change it) by adding a control surface to `reaper.ini`. An
existing web interface is kept as it is. REAPER rewrites `reaper.ini` when it
quits, so setup only edits it while REAPER is closed and asks you to quit REAPER
if it is running.

### Start the Lua Bridge in REAPER

After setup (either option), load the bridge in REAPER:

1. Open REAPER
2. **Actions > Show action list > Load ReaScript**
3. Select `mcp_bridge.lua` from your REAPER Scripts folder
4. Click **Run** — the bridge runs persistently in the background

The bridge opens its status window (see below). Without the web interface it
prints a one-line note to REAPER's console instead.

### Bridge status window

On start the bridge opens `http://localhost:8099/mcp_bridge.html` as a small
app window (Chrome, Edge, Brave or Chromium, else your default browser). It
skips this when the page is already open, so restarting the bridge never stacks
windows. The page shows:

- live / stale / offline state and the bridge's defer-loop timing
- a latency strip of recent commands
- a searchable command log with an errors filter, expandable rows, pause and copy

Rendering happens in the browser, off REAPER's main thread; the bridge only
writes a small JSON status to memory, at most 5 times a second. Add `?demo` to
the URL to preview the page with fake data. To stop the window opening, set
`OPEN_UI_ON_START = false` at the top of `mcp_bridge.lua`.

### Verify

```bash
reaper-mcp doctor
```

Checks that the bridge is connected, knowledge is installed, and MCP config exists.

## MCP Tools (134)

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

## 🔒 Privacy

reaper-mcp sends **anonymous usage telemetry** by default: which tools run, whether they
fail, and how long they take. It helps me, a solo developer, improve it. It never sends
your projects, track names, parameters or file paths. Opt out any time with
`reaper-mcp telemetry off`. The full details are in [TELEMETRY.md](TELEMETRY.md).

---

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

## Using the Mix Skills

Once you've run `./scripts/install.sh`, open Claude Code. Three
focused mix **skills** are available. They run **in your live session** — the one
already connected to REAPER — so they use the MCP tools directly (no separate
agent context that can't reach the DAW).

### Available skills

| Skill         | Invocation   | What it does                                                                      |
| ------------- | ------------ | --------------------------------------------------------------------------------- |
| **Mixer**     | `/mixer`     | Does the mixing — gain stages, builds chains, fixes problems. Follows the matching workflow (gain-staging, vocal-chain, low-end, drum-bus, stereo-image, …) on demand. |
| **Critique**  | `/critique`  | "Roast my mix" — analysis only, no changes; produces a measured, actionable report. |
| **Mastering** | `/mastering` | Mastering chain on the mix bus targeting a specific LUFS/platform standard.        |

> The earlier per-task agents (gain-staging, stems, session-prep, editing,
> delivery, producer) are now **workflows** the mixer follows from
> `knowledge/workflows/*.md` — fewer, sharper skills instead of many overlapping
> agents. They're skills (not subagents) because mixing is interactive and
> stateful: the live session holds the REAPER connection, and a subagent's
> restricted tool set can't write to the DAW.

### How to use them

Say what you want — the skills auto-trigger on intent — or invoke by slash:

```
/mixer Please gain stage all my tracks
/mixer Build a vocal chain on track 3
/mixer The low end is muddy — can you fix it?
/critique Roast my mix — what could be improved?
/mastering Master this for Spotify
```

### Memory — the skills get better over time

The mix skills read and write a **versioned memory** in the knowledge base at
`~/.claude/knowledge/` — which, for a cloned + symlinked install, *is* your repo.
So everything they learn is tracked in git (and, if you forked, ships with your
fork):

- **Plugin memory** (`knowledge/plugins/`) — as the skills work with a plugin
  (JST Heat, Pro-Q 3, Helix Native, …) they record verified parameter maps,
  settings that worked, and gotchas — *with context*. Asked to use a plugin they
  don't know, they **research the web, inspect it live, and write its `plugin.md`
  first**, then use it. Teach one up front with `/learn-plugin`.
- **Process memory** (`knowledge/lessons/mixing/`) — when a change is reverted or
  measures worse, the skill records a lesson. A lesson that recurs is promoted into
  the mixer skill's hard rules, so recurring mistakes self-heal.

Commit what they write (`git add knowledge/…`) — and if you forked, it travels
with you. Recall or tidy memory anytime with `/mix-memory`. Full contract:
`knowledge/reference/memory-protocol.md`.

### What happens under the hood

Each skill:

- **Loads a mix-engineer system prompt** into your session when triggered
- **Uses pre-approved REAPER tools** — `reaper-mcp init` allow-lists all of them, so
  there are no permission prompts mid-mix
- **Loads knowledge on demand** — pulls frequency, LUFS, compression, and plugin
  data from the knowledge base (plus personal memory) only when a task needs it

The workflow is always:

1. **Recall memory** + **save a snapshot** (so you can always A/B or undo)
2. **Analyze** — read meters, spectrum, LUFS, correlation, crest factor
3. **Reason** — apply genre rules, frequency knowledge, and plugin expertise
4. **Act** — add FX, set parameters, adjust levels using the best available plugins
5. **Verify** — re-read meters to confirm the change had the intended effect
6. **Capture & report** — record durable learnings; explain what changed and why

### A/B Comparison

Every change is bracketed by snapshots:

1. The skill saves a "Before" snapshot automatically
2. Makes all changes
3. Saves an "After" snapshot
4. You can restore either with `snapshot_restore` to A/B compare, or use the Snapshot Manager GUI in REAPER

### Genre Awareness

Tell the skill the genre and it adjusts its approach:

```
/mixer This is a hip-hop track — please gain stage and check the 808
/mixer Mix this rock song — make sure the guitars are wide and the drums punch
```

The skill reads `knowledge/genres/{genre}.md` for genre-specific conventions.

## AI Mix Engineer Knowledge

The knowledge base is what makes this more than just a remote control — it's a mix engineer's brain.

### Plugin Knowledge

Ships with knowledge for stock REAPER plugins and popular third-party suites:

| Plugin                                               | Category                | Preference |
| ---------------------------------------------------- | ----------------------- | ---------- |
| ReaEQ, ReaComp, ReaDelay, ReaVerb, ReaGate, ReaLimit | Stock                   | 30-50      |
| FabFilter Pro-Q 3, Pro-C 2, Pro-L 2                  | Premium EQ/Comp/Limiter | 85-92      |
| Line 6 Helix Native                                  | Amp Sim                 | 82         |
| JS: 1175 Compressor                                  | Character Comp          | 50         |

The skills automatically discover your installed plugins and use the best available option for each task. If you have Pro-Q 3, they use that. If not, they fall back to ReaEQ.

### Adding Your Own Plugins

Use the `/learn-plugin` skill in Claude Code:

```
You: /learn-plugin
Claude: What plugin would you like me to learn about?
You: JST Gain Reduction Deluxe — it's a VCA compressor from Joey Sturgis Tones
Claude: [asks about parameters, presets, usage]
Claude: Created knowledge/plugins/jst/gain-reduction-deluxe.md
```

Or manually add a markdown file to `knowledge/plugins/`. See `knowledge/plugins/_template.md` for the format.

### Genre Rules

Processing decisions adapt to the genre:

| Genre      | LUFS Target | Key Characteristics                             |
| ---------- | ----------- | ----------------------------------------------- |
| Rock       | -11 to -9   | Parallel drum compression, hard-panned guitars  |
| Pop        | -14 to -10  | Vocal-forward, two-stage compression, bus glue  |
| Hip-Hop    | -10 to -7   | 808 saturation, aggressive vocal comp, mono sub |
| Electronic | -10 to -6   | Sidechain pump, sub mono, stereo width          |
| Orchestral | -23 to -16  | Preserve dynamics, hall reverb staging          |
| Metal      | -11 to -8   | V-scoop guitars, tight drums, 4-guitar wall     |

## Autonomous Mode (Allow All Tools)

By default Claude Code asks permission for each MCP tool call. `reaper-mcp init` (run by `scripts/install.sh`) configures `~/.claude/settings.json` to allow all REAPER tools. If you need to set this up manually, add to your project's `.claude/settings.json` (or `~/.claude/settings.json` for global):

```json
{
  "permissions": {
    "allow": ["mcp__reaper"]
  }
}
```

`mcp__reaper` allows every tool of the `reaper` server; to allow single tools, list them as `mcp__reaper__{tool_name}`. Once added, Claude Code runs them without prompting.

## CLI Commands

`scripts/install.sh` runs the full setup; these are the underlying commands (the
`reaper-mcp` CLI is put on your PATH by `pnpm link --global` during install):

| Command | Description |
|---------|-------------|
| `reaper-mcp` / `reaper-mcp serve` | Start the MCP server in stdio mode (what Claude Code runs) |
| `reaper-mcp setup` | Install the Lua bridge, snapshot scripts, JSFX and status page into REAPER; enable the web interface |
| `reaper-mcp setup-sidecar` | Install the optional Python sidecar (perceptual analysis) |
| `reaper-mcp init` | Configure Claude Code — tool allow-list + `.mcp.json` (copy-free) |
| `reaper-mcp doctor` | Verify everything is configured correctly |
| `reaper-mcp status` | Check bridge connection |
| `scripts/sync-symlinks.sh` | Symlink the mix skills + knowledge into `~/.claude` |

## Claude Code Integration

`reaper-mcp init` writes a `.mcp.json` pointing at your local CLI:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "reaper-mcp",
      "args": ["serve"]
    }
  }
}
```

Claude Code reads this automatically. Open Claude Code in your project and the REAPER tools are available.

### Running from source (development)

For an edit-reload loop without rebuilding, run the server from the TypeScript
source with tsx and point `.mcp.json` at it:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "npx",
      "args": ["tsx", "/path/to/reaper-mcp/apps/reaper-mcp-server/src/main.ts", "serve"]
    }
  }
}
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full dev workflow.

## Environment Variables

| Variable               | Description                        | Default              |
| ---------------------- | ---------------------------------- | -------------------- |
| `REAPER_RESOURCE_PATH` | Override REAPER resource directory | Auto-detected per OS |
| `REAPER_WEB_PORT`      | Port `setup` gives REAPER's web interface (status window) | `8099` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for traces, metrics and logs | unset (no export) |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | Set to `otlp` to export that signal | `none` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the OTLP endpoint, e.g. `Authorization=Bearer <token>` | unset |
| `OTEL_SERVICE_NAME` | Service name on exported telemetry | `reaper-mcp-server` |

Platform defaults:

- **macOS**: `~/Library/Application Support/REAPER`
- **Windows**: `%APPDATA%/REAPER`
- **Linux**: `~/.config/REAPER`

### Telemetry

With the `OTEL_*` variables set, the server exports OpenTelemetry data:

- a span per tool call and per bridge command (the file-IPC round trip)
- metrics for command duration, handler time, pickup delay and timeouts
- structured logs (also written to stderr), including the bridge's own
  lifecycle events and handler errors, timestamped when the bridge recorded them

Put the variables in the `env` block of your `.mcp.json` entry. Keep the token
out of version control.

## Project Structure

```
reaper-mcp/
├── apps/
│   ├── reaper-mcp-server/        # MCP server (134 tools, esbuild bundle)
│   ├── reaper-mix-agent/         # AI mix agent (knowledge loader, plugin resolver)
│   └── bridge-ui/                # Bridge status page (React → one self-contained HTML file)
├── libs/protocol/                # Shared TypeScript types
├── .claude/skills/               # Mix skills (/mixer, /critique, /mastering, /learn-plugin, /mix-memory)
├── knowledge/                    # AI mix engineer knowledge base (symlinked into ~/.claude/knowledge)
│   ├── plugins/                  # Plugin-specific knowledge (read + written by the skills)
│   ├── genres/                   # Genre mixing conventions
│   ├── workflows/                # Step-by-step mixing workflows
│   ├── reference/                # Frequency, compression, metering, memory-protocol, … cheat sheets
│   └── lessons/mixing/           # Process lessons the skills accumulate (versioned)
├── scripts/sync-symlinks.sh      # Symlink skills + knowledge into ~/.claude (primary install)
├── reaper/                       # Files installed into REAPER
│   ├── mcp_bridge.lua            # Persistent Lua bridge
│   ├── mcp_*_lib.lua             # Lua libraries the bridge loads (plan, actions, tracks, project, items, snapshots)
│   ├── mcp_snapshot_manager.lua  # Snapshot manager GUI (save/restore/delete)
│   ├── mcp_snapshot_*.lua        # Snapshot action scripts (next/prev/quick-save + shared lib)
│   ├── mcp_analyzer.jsfx         # FFT spectrum analyzer
│   ├── mcp_lufs_meter.jsfx       # LUFS meter (BS.1770)
│   ├── mcp_correlation_meter.jsfx # Stereo correlation meter
│   ├── mcp_crest_factor.jsfx     # Crest factor meter
│   └── mcp_midi_emitter.jsfx     # Live MIDI output
├── docs/TESTING.md               # End-to-end testing guide
└── nx.json                       # Nx workspace config
```

## Updating the Lua Bridge

The MCP server (TypeScript) and the Lua bridge (REAPER) are two separate components. After updating to a new version — or after adding new tools during development — you need to reinstall the bridge files and reload the script in REAPER:

```bash
# Reinstall bridge files into REAPER
reaper-mcp setup
```

Then in REAPER:

1. **Stop** the running bridge: Actions > Running Scripts > stop `mcp_bridge.lua`
2. **Reload** the updated script: Actions > Load ReaScript > select `mcp_bridge.lua` > Run

If existing tools (like `get_project_info`) work but new tools fail or timeout, this is almost always because the Lua bridge needs to be updated and reloaded.

## Development

```bash
pnpm install
pnpm nx run-many --target=build      # Build all
pnpm nx run-many --target=lint       # Lint all
pnpm nx run-many --target=test       # Test all (470+ tests)
pnpm nx run-many --target=build,lint,test  # Everything
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full dev workflow including running from source, MCP Inspector, and bridge update details.

## License

MIT
