# reaper-mcp

AI-powered mixing for REAPER DAW. An MCP server that gives AI agents (Claude Code, etc.) full control over REAPER — real-time metering, FX management, transport control, frequency analysis, and an AI mix engineer knowledge base.

```
"Please gain stage my tracks"
"The chorus needs more energy — make the vocals cut through"
"I hear some low-end rumble, can you fix that?"
"Roast my mix — what could be improved?"
```

## Quick Start

```bash
# 1. Install REAPER components (Lua bridge + JSFX analyzers)
npx @mthines/reaper-mcp setup

# 2. In REAPER: Actions > Load ReaScript > select mcp_bridge.lua > Run

# 3. Install AI mix knowledge in your project
cd your-project
npx @mthines/reaper-mcp install-skills

# 4. Open Claude Code — you're ready to mix
```

That's it. Claude Code now has 67 REAPER tools and a professional mix engineer's knowledge base.

## What it does

```
Claude Code
  ├── MCP Tools (67) ──→ controls REAPER in real-time
  │   ├── Track management (list, get/set properties, arm, phase, input)
  │   ├── FX management (add/remove, get/set parameters, enable/offline, presets)
  │   ├── Transport (play, stop, record, cursor position)
  │   ├── Metering (peak/RMS, FFT spectrum, LUFS, correlation, crest factor)
  │   ├── Selection (selected tracks, time selection)
  │   ├── Markers & regions (list, add, delete)
  │   ├── Tempo map (all tempo/time sig changes)
  │   ├── Envelopes (list, read/write automation points)
  │   ├── MIDI editing (14 tools: notes, CC, items, analysis, batch ops)
  │   ├── Media items (11 tools: properties, split, move, trim, stretch)
  │   ├── Plugin discovery (list installed FX, search, presets)
  │   ├── Snapshots (save/restore mixer state for A/B comparison)
  │   └── Routing (sends, receives, bus structure)
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

## Installation

### Prerequisites

- [REAPER](https://www.reaper.fm/) v6.0+ (v7.0+ recommended)
- [Node.js](https://nodejs.org/) 20+
- [SWS Extensions](https://www.sws-extension.org/) (recommended — enables plugin discovery and enhanced features)

### Step 1: Install REAPER components

```bash
npx @mthines/reaper-mcp setup
```

This copies into your REAPER resource folder:

- `mcp_bridge.lua` — persistent Lua bridge script
- `mcp_analyzer.jsfx` — FFT spectrum analyzer
- `mcp_lufs_meter.jsfx` — ITU-R BS.1770 LUFS meter
- `mcp_correlation_meter.jsfx` — stereo correlation analyzer
- `mcp_crest_factor.jsfx` — dynamics/crest factor meter

### Step 2: Start the Lua bridge in REAPER

1. Open REAPER
2. **Actions > Show action list > Load ReaScript**
3. Select `mcp_bridge.lua` from your REAPER Scripts folder
4. Click **Run** — the bridge runs persistently in the background

You should see in REAPER's console: `MCP Bridge: Started`

### Step 3: Install AI mix knowledge in your project

```bash
cd your-music-project
npx @mthines/reaper-mcp install-skills
```

This creates in your project:

- `.claude/agents/` — mix engineer subagents (`@mix-engineer`, `@gain-stage`, `@mix-analyzer`, `@master`)
- `.claude/rules/` — architecture and development rules
- `.claude/skills/` — skills like `/learn-plugin`
- `knowledge/` — plugin knowledge, genre rules, workflows, reference data
- `.mcp.json` — MCP server configuration for Claude Code

### Step 4: Verify

```bash
npx @mthines/reaper-mcp doctor
```

Checks that the bridge is connected, knowledge is installed, and MCP config exists.

## MCP Tools (67)

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
| `get_selected_tracks` | Currently selected tracks with indices and names |
| `get_time_selection` | Time/loop selection start, end, length |
| `set_time_selection` | Set the time selection range |

### Markers & Regions

| Tool | Description |
|------|-------------|
| `list_markers` | All project markers (index, name, position, color) |
| `list_regions` | All regions (index, name, start/end, color) |
| `add_marker` | Add marker at position with optional name/color |
| `add_region` | Add region with start/end, optional name/color |
| `delete_marker` | Delete a marker by index |
| `delete_region` | Delete a region by index |

### Tempo Map

| Tool | Description |
|------|-------------|
| `get_tempo_map` | All tempo/time sig changes (position, BPM, time sig, linear) |

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

| Tool | Description |
|------|-------------|
| `snapshot_save` | Save current mixer state (volumes, pans, FX, mutes) |
| `snapshot_restore` | Restore a saved snapshot |
| `snapshot_list` | List all saved snapshots |

### Routing

| Tool | Description |
|------|-------------|
| `get_track_routing` | Sends, receives, parent/folder info for a track |

## Using the Mix Agents

Once you've run `setup` and `install-skills`, open Claude Code in your project directory. Four specialized mix agents are available:

### Available Agents

| Agent            | Invocation      | What it does                                                              |
| ---------------- | --------------- | ------------------------------------------------------------------------- |
| **Mix Engineer** | `@mix-engineer` | General-purpose mix agent — analyzes, suggests, and executes any mix task |
| **Gain Stage**   | `@gain-stage`   | Perceived-loudness-aware gain staging with proper headroom                |
| **Mix Analyzer** | `@mix-analyzer` | "Roast my mix" — analysis only, no changes, produces detailed report      |
| **Master**       | `@master`       | Mastering chain targeting specific LUFS/platform standards                |

### How to use them

Just mention the agent by name in Claude Code:

```
@mix-engineer Please gain stage all my tracks
@mix-engineer Build a vocal chain on track 3
@mix-engineer The low end is muddy — can you fix it?
@mix-analyzer Roast my mix — what could be improved?
@master Master this for Spotify
@gain-stage Set proper levels on everything
```

Or start a full session as the mix engineer:

```bash
claude --agent mix-engineer
```

### What happens under the hood

Each agent has:

- **Its own system prompt** — thinks like a mix engineer, not a general assistant
- **Pre-approved REAPER tools** — no permission prompts for every MCP call
- **Scoped MCP access** — only the `reaper` MCP server is loaded
- **Embedded reference data** — frequency bands, LUFS targets, compression settings

The workflow is always:

1. **Save a snapshot** (so you can always A/B or undo)
2. **Analyze** — read meters, spectrum, LUFS, correlation, crest factor
3. **Reason** — apply genre rules, frequency knowledge, and plugin expertise
4. **Act** — add FX, set parameters, adjust levels using the best available plugins
5. **Verify** — re-read meters to confirm the change had the intended effect
6. **Report** — explain what it did and why in audio engineering terms

### A/B Comparison

Every change is bracketed by snapshots:

1. Agent saves a "Before" snapshot automatically
2. Makes all changes
3. Saves an "After" snapshot
4. You can restore either with `snapshot_restore` to A/B compare

### Genre Awareness

Tell the agent the genre and it adjusts its approach:

```
@mix-engineer This is a hip-hop track — please gain stage and check the 808
@mix-engineer Mix this rock song — make sure the guitars are wide and the drums punch
```

The agent reads `knowledge/genres/{genre}.md` for genre-specific conventions.

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

The agent automatically discovers your installed plugins and uses the best available option for each task. If you have Pro-Q 3, it uses that. If not, it falls back to ReaEQ.

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

By default Claude Code asks permission for each MCP tool call. To let the mix agents work autonomously, add the REAPER tools to your allow list.

Add to your project's `.claude/settings.json` (or `~/.claude/settings.json` for global):

```json
{
  "permissions": {
    "allow": [
      "mcp__reaper__get_project_info",
      "mcp__reaper__list_tracks",
      "mcp__reaper__get_track_properties",
      "mcp__reaper__set_track_property",
      "mcp__reaper__add_fx",
      "mcp__reaper__remove_fx",
      "mcp__reaper__get_fx_parameters",
      "mcp__reaper__set_fx_parameter",
      "mcp__reaper__list_available_fx",
      "mcp__reaper__search_fx",
      "mcp__reaper__get_fx_preset_list",
      "mcp__reaper__set_fx_preset",
      "mcp__reaper__play",
      "mcp__reaper__stop",
      "mcp__reaper__record",
      "mcp__reaper__get_transport_state",
      "mcp__reaper__set_cursor_position",
      "mcp__reaper__read_track_meters",
      "mcp__reaper__read_track_spectrum",
      "mcp__reaper__read_track_lufs",
      "mcp__reaper__read_track_correlation",
      "mcp__reaper__read_track_crest",
      "mcp__reaper__snapshot_save",
      "mcp__reaper__snapshot_restore",
      "mcp__reaper__snapshot_list",
      "mcp__reaper__get_track_routing",
      "mcp__reaper__set_fx_enabled",
      "mcp__reaper__set_fx_offline",
      "mcp__reaper__get_selected_tracks",
      "mcp__reaper__get_time_selection",
      "mcp__reaper__set_time_selection",
      "mcp__reaper__list_markers",
      "mcp__reaper__list_regions",
      "mcp__reaper__add_marker",
      "mcp__reaper__add_region",
      "mcp__reaper__delete_marker",
      "mcp__reaper__delete_region",
      "mcp__reaper__get_tempo_map",
      "mcp__reaper__get_track_envelopes",
      "mcp__reaper__get_envelope_points",
      "mcp__reaper__insert_envelope_point",
      "mcp__reaper__delete_envelope_point",
      "mcp__reaper__create_midi_item",
      "mcp__reaper__list_midi_items",
      "mcp__reaper__get_midi_notes",
      "mcp__reaper__analyze_midi",
      "mcp__reaper__insert_midi_note",
      "mcp__reaper__insert_midi_notes",
      "mcp__reaper__edit_midi_note",
      "mcp__reaper__edit_midi_notes",
      "mcp__reaper__delete_midi_note",
      "mcp__reaper__get_midi_cc",
      "mcp__reaper__insert_midi_cc",
      "mcp__reaper__delete_midi_cc",
      "mcp__reaper__get_midi_item_properties",
      "mcp__reaper__set_midi_item_properties",
      "mcp__reaper__list_media_items",
      "mcp__reaper__get_media_item_properties",
      "mcp__reaper__set_media_item_properties",
      "mcp__reaper__set_media_items_properties",
      "mcp__reaper__split_media_item",
      "mcp__reaper__delete_media_item",
      "mcp__reaper__move_media_item",
      "mcp__reaper__trim_media_item",
      "mcp__reaper__add_stretch_marker",
      "mcp__reaper__get_stretch_markers",
      "mcp__reaper__delete_stretch_marker"
    ]
  }
}
```

The format is `mcp__reaper__{tool_name}`. Once added, Claude Code will run these tools without prompting.

## CLI Commands

```bash
npx @mthines/reaper-mcp                  # Start MCP server (default)
npx @mthines/reaper-mcp serve            # Start MCP server (stdio mode)
npx @mthines/reaper-mcp setup            # Install Lua bridge + JSFX into REAPER
npx @mthines/reaper-mcp install-skills   # Install AI knowledge + agents into your project
npx @mthines/reaper-mcp doctor           # Verify everything is configured
npx @mthines/reaper-mcp status           # Check bridge connection
```

Or install globally for shorter commands:

```bash
npm install -g @mthines/reaper-mcp
reaper-mcp setup
```

## Claude Code Integration

After `install-skills`, your project has a `.mcp.json`:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "npx",
      "args": ["@mthines/reaper-mcp", "serve"]
    }
  }
}
```

Claude Code reads this automatically. Open Claude Code in your project and the REAPER tools are available.

### Running from source (development)

If you're developing reaper-mcp and want changes reflected immediately without rebuilding, point your `.mcp.json` at the TypeScript source using `npx tsx`:

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

Platform defaults:

- **macOS**: `~/Library/Application Support/REAPER`
- **Windows**: `%APPDATA%/REAPER`
- **Linux**: `~/.config/REAPER`

## Project Structure

```
reaper-mcp/
├── apps/
│   ├── reaper-mcp-server/        # MCP server (67 tools, esbuild bundle)
│   └── reaper-mix-agent/         # AI mix agent (knowledge loader, plugin resolver)
├── libs/protocol/                # Shared TypeScript types
├── knowledge/                    # AI mix engineer knowledge base
│   ├── plugins/                  # Plugin-specific knowledge (extensible)
│   ├── genres/                   # Genre mixing conventions
│   ├── workflows/                # Step-by-step mixing workflows
│   └── reference/                # Frequency, compression, metering, perceived loudness cheat sheets
├── reaper/                       # Files installed into REAPER
│   ├── mcp_bridge.lua            # Persistent Lua bridge
│   ├── mcp_analyzer.jsfx         # FFT spectrum analyzer
│   ├── mcp_lufs_meter.jsfx       # LUFS meter (BS.1770)
│   ├── mcp_correlation_meter.jsfx # Stereo correlation meter
│   └── mcp_crest_factor.jsfx     # Crest factor meter
├── docs/TESTING.md               # End-to-end testing guide
└── nx.json                       # Nx workspace config
```

## Updating the Lua Bridge

The MCP server (TypeScript) and the Lua bridge (REAPER) are two separate components. After updating to a new version — or after adding new tools during development — you need to reinstall the bridge files and reload the script in REAPER:

```bash
# Reinstall bridge files into REAPER
npx @mthines/reaper-mcp setup
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
pnpm nx run-many --target=test       # Test all (200+ tests)
pnpm nx run-many --target=build,lint,test  # Everything
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full dev workflow including running from source, MCP Inspector, and bridge update details.

## License

MIT
