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

That's it. Claude Code now has 26 REAPER tools and a professional mix engineer's knowledge base.

## What it does

```
Claude Code
  ├── MCP Tools (26) ──→ controls REAPER in real-time
  │   ├── Track management (list, get/set properties)
  │   ├── FX management (add/remove, get/set parameters, presets)
  │   ├── Transport (play, stop, record, cursor position)
  │   ├── Metering (peak/RMS, FFT spectrum, LUFS, correlation, crest factor)
  │   ├── Plugin discovery (list installed FX, search, presets)
  │   ├── Snapshots (save/restore mixer state for A/B comparison)
  │   └── Routing (sends, receives, bus structure)
  │
  └── Mix Engineer Knowledge ──→ knows HOW to use those tools
      ├── Plugin knowledge (ReaEQ, Pro-Q 3, Helix Native, etc.)
      ├── Genre rules (rock, pop, hip-hop, electronic, orchestral, metal)
      ├── Workflows (gain staging, vocal chain, drum bus, mastering)
      └── Reference (frequencies, compression, LUFS targets, common mistakes)
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

## MCP Tools (26)

### Track Management
| Tool | Description |
|------|-------------|
| `get_project_info` | Project name, tempo, time sig, sample rate, transport state |
| `list_tracks` | All tracks with volume, pan, mute/solo, FX count, routing |
| `get_track_properties` | Detailed track info + full FX chain list |
| `set_track_property` | Set volume (dB), pan, mute, solo |

### FX Management
| Tool | Description |
|------|-------------|
| `add_fx` | Add FX by name (partial match: "ReaEQ", "Pro-Q 3") |
| `remove_fx` | Remove FX from chain by index |
| `get_fx_parameters` | List all FX params with values and ranges |
| `set_fx_parameter` | Set FX parameter (normalized 0.0-1.0) |
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

### Metering & Analysis
| Tool | Description |
|------|-------------|
| `read_track_meters` | Peak/RMS L/R in dB |
| `read_track_spectrum` | FFT frequency bins (auto-inserts analyzer) |
| `read_track_lufs` | Integrated/short-term/momentary LUFS + true peak |
| `read_track_correlation` | Stereo correlation, width, mid/side levels |
| `read_track_crest` | Crest factor (peak-to-RMS ratio) |

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

| Agent | Invocation | What it does |
|-------|-----------|-------------|
| **Mix Engineer** | `@mix-engineer` | General-purpose mix agent — analyzes, suggests, and executes any mix task |
| **Gain Stage** | `@gain-stage` | Sets all tracks to -18 dBFS average with proper headroom |
| **Mix Analyzer** | `@mix-analyzer` | "Roast my mix" — analysis only, no changes, produces detailed report |
| **Master** | `@master` | Mastering chain targeting specific LUFS/platform standards |

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

| Plugin | Category | Preference |
|--------|----------|-----------|
| ReaEQ, ReaComp, ReaDelay, ReaVerb, ReaGate, ReaLimit | Stock | 30-50 |
| FabFilter Pro-Q 3, Pro-C 2, Pro-L 2 | Premium EQ/Comp/Limiter | 85-92 |
| Line 6 Helix Native | Amp Sim | 82 |
| JS: 1175 Compressor | Character Comp | 50 |

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

| Genre | LUFS Target | Key Characteristics |
|-------|------------|---------------------|
| Rock | -11 to -9 | Parallel drum compression, hard-panned guitars |
| Pop | -14 to -10 | Vocal-forward, two-stage compression, bus glue |
| Hip-Hop | -10 to -7 | 808 saturation, aggressive vocal comp, mono sub |
| Electronic | -10 to -6 | Sidechain pump, sub mono, stereo width |
| Orchestral | -23 to -16 | Preserve dynamics, hall reverb staging |
| Metal | -11 to -8 | V-scoop guitars, tight drums, 4-guitar wall |

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
      "mcp__reaper__get_track_routing"
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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REAPER_RESOURCE_PATH` | Override REAPER resource directory | Auto-detected per OS |

Platform defaults:
- **macOS**: `~/Library/Application Support/REAPER`
- **Windows**: `%APPDATA%/REAPER`
- **Linux**: `~/.config/REAPER`

## Project Structure

```
reaper-mcp/
├── apps/
│   ├── reaper-mcp-server/        # MCP server (26 tools, esbuild bundle)
│   └── reaper-mix-agent/         # AI mix agent (knowledge loader, plugin resolver)
├── libs/protocol/                # Shared TypeScript types
├── knowledge/                    # AI mix engineer knowledge base
│   ├── plugins/                  # Plugin-specific knowledge (extensible)
│   ├── genres/                   # Genre mixing conventions
│   ├── workflows/                # Step-by-step mixing workflows
│   └── reference/                # Frequency, compression, metering cheat sheets
├── reaper/                       # Files installed into REAPER
│   ├── mcp_bridge.lua            # Persistent Lua bridge
│   ├── mcp_analyzer.jsfx         # FFT spectrum analyzer
│   ├── mcp_lufs_meter.jsfx       # LUFS meter (BS.1770)
│   ├── mcp_correlation_meter.jsfx # Stereo correlation meter
│   └── mcp_crest_factor.jsfx     # Crest factor meter
├── docs/TESTING.md               # End-to-end testing guide
└── nx.json                       # Nx workspace config
```

## Development

```bash
pnpm install
pnpm nx run-many --target=build      # Build all
pnpm nx run-many --target=lint       # Lint all
pnpm nx run-many --target=test       # Test all (130+ tests)
pnpm nx run-many --target=build,lint,test  # Everything
```

## License

MIT
