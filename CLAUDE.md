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
                                                                       |
                                                                 gmem[] shared memory
                                                                       |
                                                                 JSFX FFT Analyzer
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
      main.ts                 # CLI entry point: serve | setup | status
      server.ts               # McpServer creation, tool registration
      bridge.ts               # File-based IPC: sendCommand(), isBridgeRunning(), etc.
      tools/
        project.ts            # get_project_info
        tracks.ts             # list_tracks, get_track_properties, set_track_property
        fx.ts                 # add_fx, remove_fx, get/set_fx_parameter, set_fx_enabled, set_fx_offline
        meters.ts             # read_track_meters, read_track_spectrum
        transport.ts          # play, stop, record, get_transport_state, set_cursor_position
        discovery.ts          # list_available_fx, search_fx
        presets.ts            # get_fx_preset_list, set_fx_preset
        snapshots.ts          # snapshot_save, snapshot_restore, snapshot_list
        routing.ts            # get_track_routing
        analysis.ts           # read_track_lufs, read_track_correlation, read_track_crest
        midi.ts               # 14 MIDI editing tools (notes, CC, items, analysis, batch edit)
        media.ts              # 11 media item editing tools (properties, batch, split, move, trim, stretch)
        selection.ts          # get_selected_tracks, get_time_selection, set_time_selection
        markers.ts            # list_markers, list_regions, add_marker, add_region, delete_marker, delete_region
        tempo.ts              # get_tempo_map
        envelopes.ts          # get_track_envelopes, get_envelope_points, insert_envelope_point, delete_envelope_point

  libs/protocol/              # Shared TypeScript types (compiled with tsc)
    src/
      index.ts                # Re-exports commands + responses
      commands.ts             # BridgeCommand, CommandType, per-command param interfaces
      responses.ts            # BridgeResponse, ProjectInfo, TrackInfo, FxInfo, etc.

  apps/reaper-mix-agent/      # AI mix engineer agent (TypeScript, esbuild)
    src/
      agent.ts                # Agent context factory: loads knowledge, builds system prompt
      knowledge-loader.ts     # Loads/parses knowledge/ markdown files (frontmatter + body)
      plugin-resolver.ts      # Matches installed FX against plugin knowledge (fx_match patterns)
      modes/                  # Workflow mode implementations
        analyze.ts            # Analysis mode
        gain-stage.ts         # Gain staging mode
        mix.ts                # Full mix mode
        master.ts             # Mastering mode
        drum-bus.ts           # Drum bus processing
        vocal-chain.ts        # Vocal chain processing
        low-end.ts            # Low-end management
        stereo-image.ts       # Stereo image mode

  knowledge/                  # Shared audio engineering knowledge base (consumed by reaper-mix-agent)
    plugins/                  # Plugin-specific knowledge (FX match patterns, parameter guides)
      fabfilter/              # FabFilter Pro-Q 3, Pro-C 2, Pro-L 2
      neural-dsp/             # Helix Native
      stock-reaper/           # ReaEQ, ReaComp, ReaLimit, ReaVerb, ReaDelay, ReaGate, JS 1175
    genres/                   # Genre mixing conventions (targets, frequency balance, dynamics)
    workflows/                # Step-by-step mixing workflows (gain-staging, vocal-chain, etc.)
    reference/                # Reference material (frequencies, metering, compression, perceived loudness, common mistakes)

  reaper/                     # Files installed INTO REAPER (copied by setup command)
    mcp_bridge.lua            # Persistent Lua bridge (defer loop, JSON IPC, 67 handlers)
    mcp_analyzer.jsfx         # Real-time FFT analyzer (JSFX, writes to gmem[])
    install.sh                # Manual install helper script
```

### knowledge/ ↔ reaper-mix-agent Relationship

The `knowledge/` directory and `apps/reaper-mix-agent/` are tightly coupled:

- **`knowledge/`** contains markdown files with YAML frontmatter that define audio engineering knowledge (plugin parameters, genre conventions, mixing workflows, reference material).
- **`reaper-mix-agent`** loads and parses these files at runtime via `knowledge-loader.ts`, which categorizes them by directory path (`plugins/`, `genres/`, `workflows/`, `reference/`).
- **`plugin-resolver.ts`** matches the `fx_match` frontmatter field in plugin knowledge files against the user's installed FX list to determine which plugins are available.
- **Workflow modes** in `modes/` correspond to workflow knowledge files (e.g., `modes/gain-stage.ts` uses `workflows/gain-staging.md`).

**When editing one, update the other:** Adding a new plugin knowledge file requires the `fx_match` patterns that `PluginResolver` uses. Adding a new workflow mode should have a corresponding `knowledge/workflows/` file. Adding new knowledge types requires updating `typeFromPath()` in `knowledge-loader.ts`.

## Workspace Packages

| Package | Location | Build | Purpose |
|---------|----------|-------|---------|
| `@mthines/reaper-mcp` | `/` (root) | -- | Workspace root, scripts |
| `@mthines/reaper-mcp-server` | `apps/reaper-mcp-server` | `@nx/esbuild` (ESM bundle) | MCP server application |
| `@mthines/reaper-mix-agent` | `apps/reaper-mix-agent` | `@nx/esbuild` (ESM bundle) | AI mix engineer agent (loads `knowledge/`) |
| `@reaper-mcp/protocol` | `libs/protocol` | `@nx/js:tsc` | Shared command/response types |

## MCP Tools (71 total)

### Project & Tracks (4)

| Tool | File | Description |
|------|------|-------------|
| `get_project_info` | `tools/project.ts` | Project name, tempo, time sig, sample rate, transport state |
| `list_tracks` | `tools/tracks.ts` | All tracks with volume, pan, mute/solo, arm, phase, FX count, routing |
| `get_track_properties` | `tools/tracks.ts` | Detailed single track info + full FX chain list |
| `set_track_property` | `tools/tracks.ts` | Set volume (dB), pan, mute, solo, recordArm, phase, input |

### FX Management (6)

| Tool | File | Description |
|------|------|-------------|
| `add_fx` | `tools/fx.ts` | Add FX by name (partial match: "ReaEQ", "VST: Pro-Q 3") |
| `remove_fx` | `tools/fx.ts` | Remove FX from chain by index |
| `get_fx_parameters` | `tools/fx.ts` | List all FX params with current values and ranges |
| `set_fx_parameter` | `tools/fx.ts` | Set FX parameter (normalized 0.0-1.0) |
| `set_fx_enabled` | `tools/fx.ts` | Enable or disable (bypass) an FX plugin |
| `set_fx_offline` | `tools/fx.ts` | Set FX online/offline (offline = no CPU, preserves settings) |

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

### Selection & Navigation Tools (3)

| Tool | File | Description |
|------|------|-------------|
| `get_selected_tracks` | `tools/selection.ts` | Get currently selected tracks with indices and names |
| `get_time_selection` | `tools/selection.ts` | Get time/loop selection start, end, length in seconds |
| `set_time_selection` | `tools/selection.ts` | Set the time selection range (start/end in seconds) |

### Markers & Regions Tools (6)

| Tool | File | Description |
|------|------|-------------|
| `list_markers` | `tools/markers.ts` | List all project markers (index, name, position, color) |
| `list_regions` | `tools/markers.ts` | List all regions (index, name, start/end, color) |
| `add_marker` | `tools/markers.ts` | Add a marker at position with optional name/color |
| `add_region` | `tools/markers.ts` | Add a region with start/end, optional name/color |
| `delete_marker` | `tools/markers.ts` | Delete a marker by index |
| `delete_region` | `tools/markers.ts` | Delete a region by index |

### Tempo Map Tools (1)

| Tool | File | Description |
|------|------|-------------|
| `get_tempo_map` | `tools/tempo.ts` | All tempo/time sig changes (position, BPM, time sig, linear flag) |

### Envelope / Automation Tools (8)

| Tool | File | Description |
|------|------|-------------|
| `create_track_envelope` | `tools/envelopes.ts` | Create/show an envelope on a track (Volume, Pan, Mute, Width, Trim Volume, or FX parameter) |
| `get_track_envelopes` | `tools/envelopes.ts` | List envelopes on a track (name, point count, active/visible/armed) |
| `get_envelope_points` | `tools/envelopes.ts` | Get automation points with pagination (time, value, shape, tension) |
| `insert_envelope_point` | `tools/envelopes.ts` | Insert an automation point with shape/tension |
| `insert_envelope_points` | `tools/envelopes.ts` | Batch insert multiple automation points (JSON array) |
| `delete_envelope_point` | `tools/envelopes.ts` | Delete an automation point by index |
| `clear_envelope` | `tools/envelopes.ts` | Delete ALL points from an envelope |
| `set_envelope_properties` | `tools/envelopes.ts` | Set envelope active/visible/armed state |

### FX Discovery & Presets (4)

| Tool | File | Description |
|------|------|-------------|
| `list_available_fx` | `tools/discovery.ts` | Discover all installed plugins (VST, VST3, JS, CLAP, AU) |
| `search_fx` | `tools/discovery.ts` | Fuzzy search installed plugins by name |
| `get_fx_preset_list` | `tools/presets.ts` | List available presets for an FX |
| `set_fx_preset` | `tools/presets.ts` | Load a preset by name |

### Snapshots (3)

| Tool | File | Description |
|------|------|-------------|
| `snapshot_save` | `tools/snapshots.ts` | Save current mixer state (volumes, pans, FX, mutes) |
| `snapshot_restore` | `tools/snapshots.ts` | Restore a saved snapshot |
| `snapshot_list` | `tools/snapshots.ts` | List all saved snapshots |

### Routing (1)

| Tool | File | Description |
|------|------|-------------|
| `get_track_routing` | `tools/routing.ts` | Sends, receives, parent/folder info for a track |

### Metering & Analysis (5)

| Tool | File | Description |
|------|------|-------------|
| `read_track_meters` | `tools/meters.ts` | Peak/RMS L/R in dB |
| `read_track_spectrum` | `tools/meters.ts` | FFT frequency bins (auto-inserts JSFX analyzer) |
| `read_track_lufs` | `tools/analysis.ts` | Integrated/short-term/momentary LUFS + true peak |
| `read_track_correlation` | `tools/analysis.ts` | Stereo correlation, width, mid/side levels |
| `read_track_crest` | `tools/analysis.ts` | Crest factor (peak-to-RMS ratio) |

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

### Envelope / Automation Concepts

- **Creating envelopes**: Use `create_track_envelope` before adding points. Built-in envelopes use `envelopeName` ("Volume", "Pan", "Mute", "Width", "Trim Volume"). FX parameter envelopes use `fxIndex` + `paramIndex`.
- **Envelope values**: Scale depends on envelope type. Volume envelopes use linear scale (1.0 = 0 dB), Pan uses -1.0 to 1.0, Mute uses 0 or 1.
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

To add a new tool, touch these 5 places:

1. **`libs/protocol/src/commands.ts`** -- Add command type to `CommandType` union, add params interface
2. **`libs/protocol/src/responses.ts`** -- Add response data interface if needed
3. **`apps/reaper-mcp-server/src/tools/`** -- Create or extend a tool file, register with `server.tool()`
4. **`apps/reaper-mcp-server/src/cli.ts`** -- Add tool name to `MCP_TOOL_NAMES` array (used by `ensureClaudeSettings()` to auto-allow tools)
5. **`reaper/mcp_bridge.lua`** -- Add handler function in the `handlers` table

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

## Spectrum Analysis (JSFX + gmem)

The JSFX analyzer (`mcp_analyzer.jsfx`) runs in REAPER's audio thread:
- Performs configurable FFT (512-8192 bins, default 4096)
- Writes magnitude spectrum to `gmem[]` under namespace `MCPAnalyzer`
- gmem layout: `[bin_count, peak_dB, rms_dB, bin[0], bin[1], ...]`
- Lua bridge reads via `reaper.gmem_attach("MCPAnalyzer")` + `reaper.gmem_read()`
- Auto-inserted by `read_track_spectrum` tool, passes audio through unmodified

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
- **Test approach**: Mock `sendCommand()` to test tool registration, parameter passing, success/error handling without REAPER running
- **Test files**: `tools/midi.test.ts` (MIDI tools), `tools/media.test.ts` (media tools), and others in `tools/`
- All tests verify: tool registration, correct command dispatch, success response formatting, error propagation
- The Lua bridge cannot be unit tested outside REAPER -- test manually with the MCP Inspector

## Running the MCP Server

```bash
# Build first
pnpm nx build reaper-mcp-server

# One-time setup (copies bridge files to REAPER)
node dist/apps/reaper-mcp-server/main.js setup

# Start MCP server (stdio mode)
node dist/apps/reaper-mcp-server/main.js serve

# Check bridge status
node dist/apps/reaper-mcp-server/main.js status

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/apps/reaper-mcp-server/main.js
```

### Claude Code MCP Config

```json
{
  "mcpServers": {
    "reaper": {
      "command": "node",
      "args": ["/path/to/dist/apps/reaper-mcp-server/main.js"]
    }
  }
}
```
