# REAPER MCP Server — MVP Implementation Plan

## Context

You have an existing repo (`mthines/jsfx-agent-skills`) containing Claude Code agent skills for writing JSFX plugins. You want to build a **separate Nx monorepo project** that provides an MCP server allowing AI agents (Claude Code, etc.) to control a live REAPER session in real-time — including adding FX, adjusting parameters, reading meters, and performing real-time frequency analysis for mixing decisions.

**Killer use case:** *"Add a limiter to all instrument busses and make sure the meters are even."*

### Research Summary

- **Existing solutions** (itsuzef/reaper-mcp, total-reaper-mcp) exist but are limited or overly complex
- **Best communication approach**: Lua bridge inside REAPER using `defer()` loop + file-based IPC with JSON — gives full ReaScript API access with no external dependencies inside REAPER
- **Real-time frequency analysis**: Achievable via a custom JSFX FFT analyzer writing to `gmem[]`, polled by the Lua bridge (~50-150ms latency)
- **Nx has official MCP server patterns** (nx-console/nx-mcp) using `@modelcontextprotocol/sdk` + esbuild

---

## Architecture

```
┌─────────────────────┐       JSON files        ┌──────────────────────┐
│   MCP Server (TS)   │ ◄──── bridge dir ─────► │  Lua Bridge (REAPER) │
│   (stdio transport) │      ~/reaper-mcp/       │  (defer loop ~30ms)  │
└─────────────────────┘                          └──────────┬───────────┘
         ▲                                                  │
         │ MCP protocol (stdio)                    ReaScript API calls
         ▼                                                  │
┌─────────────────────┐                          ┌──────────▼───────────┐
│   Claude Code /     │                          │    REAPER DAW        │
│   Any MCP Client    │                          │  (tracks, FX, audio) │
└─────────────────────┘                          └──────────────────────┘
                                                            │
                                                 ┌──────────▼───────────┐
                                                 │  JSFX FFT Analyzer   │
                                                 │  (writes to gmem[])  │
                                                 └──────────────────────┘
```

**Communication flow:**
1. MCP client sends tool call → MCP server writes `command_{id}.json` to bridge dir
2. Lua bridge polls bridge dir every ~30ms, reads command, executes ReaScript API
3. Lua bridge writes `response_{id}.json` with results
4. MCP server polls for response, returns to client

---

## New Project Structure (Nx Monorepo)

This is a **new repo**, not added to jsfx-agent-skills.

```
reaper-mcp/
├── nx.json
├── package.json
├── tsconfig.base.json
├── .gitignore
│
├── apps/
│   └── reaper-mcp-server/          # Main MCP server application
│       ├── src/
│       │   ├── main.ts             # CLI entry point + stdio transport
│       │   ├── server.ts           # McpServer setup, tool registration
│       │   ├── bridge.ts           # File-based IPC with Lua bridge
│       │   └── tools/
│       │       ├── tracks.ts       # list_tracks, get/set track properties
│       │       ├── fx.ts           # add_fx, remove_fx, get/set fx params
│       │       ├── meters.ts       # read_track_meters, read_spectrum
│       │       ├── transport.ts    # play, stop, record, get position
│       │       └── project.ts      # get_project_info
│       ├── project.json
│       ├── package.json
│       └── tsconfig.json
│
├── libs/
│   └── protocol/                   # Shared types for command/response
│       ├── src/
│       │   ├── index.ts
│       │   ├── commands.ts         # Command type definitions
│       │   └── responses.ts        # Response type definitions
│       ├── project.json
│       └── tsconfig.json
│
├── reaper/                         # Files to install into REAPER
│   ├── mcp_bridge.lua              # Main Lua bridge script
│   ├── mcp_analyzer.jsfx           # FFT analyzer JSFX plugin
│   └── install.sh                  # Setup script
│
└── scripts/
    └── setup.ts                    # Interactive setup wizard
```

---

## Implementation Steps

### Step 1: Scaffold Nx workspace

- `npx create-nx-workspace@latest reaper-mcp --preset=ts`
- Configure `nx.json` with esbuild plugin
- Set up `apps/reaper-mcp-server` and `libs/protocol`

### Step 2: Define the command/response protocol (`libs/protocol`)

```typescript
// libs/protocol/src/commands.ts
interface BridgeCommand {
  id: string;
  type: string;        // e.g. "list_tracks", "add_fx", "read_meters"
  params: Record<string, unknown>;
  timestamp: number;
}

// libs/protocol/src/responses.ts
interface BridgeResponse {
  id: string;           // matches command id
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp: number;
}
```

### Step 3: Build the Lua bridge (`reaper/mcp_bridge.lua`)

Core design:
- Uses `reaper.defer()` for polling loop (~30ms)
- Watches bridge directory for `command_*.json` files
- Parses JSON, dispatches to handler functions
- Writes `response_{id}.json` with results
- Handlers map to ReaScript API calls:

**Key Lua handlers:**

| Command | ReaScript API | Returns |
|---------|--------------|---------|
| `list_tracks` | `CountTracks()`, `GetTrack()`, `GetTrackName()` | Track list with names, indices, parent info |
| `add_fx` | `TrackFX_AddByName()` | FX index on track |
| `remove_fx` | `TrackFX_Delete()` | Success/fail |
| `get_fx_params` | `TrackFX_GetNumParams()`, `TrackFX_GetParam()`, `TrackFX_GetParamName()` | Param names + values |
| `set_fx_param` | `TrackFX_SetParam()` | Success/fail |
| `get_track_volume` | `GetMediaTrackInfo_Value("D_VOL")` | Volume in dB |
| `set_track_volume` | `SetMediaTrackInfo_Value("D_VOL")` | Success/fail |
| `read_track_meters` | `Track_GetPeakInfo()` | Peak L/R in dB |
| `read_spectrum` | `gmem_read()` (from JSFX analyzer) | FFT bin data |
| `get_project_info` | `GetProjectName()`, `CountTracks()`, `GetProjectTimeSignature2()` | Project metadata |

### Step 4: Build the JSFX FFT analyzer (`reaper/mcp_analyzer.jsfx`)

A lightweight JSFX plugin that:
- Performs 4096-point FFT on incoming audio in `@sample`
- Writes magnitude spectrum to `gmem[]` (using `options:gmem=MCPAnalyzer`)
- Lua bridge reads via `reaper.gmem_attach("MCPAnalyzer")` + `reaper.gmem_read()`
- Provides ~21Hz frequency resolution at 44.1kHz (4096 bins / 44100 = ~10.7Hz per bin)
- Writes: bin count at gmem[0], peak dB at gmem[1], RMS dB at gmem[2], bins starting at gmem[3]

**This enables the AI agent to:**
- See frequency balance across tracks
- Detect resonances and muddiness
- Compare levels between busses
- Make EQ and dynamics decisions based on actual audio content

### Step 5: Build the MCP server (`apps/reaper-mcp-server`)

**MCP Tools (MVP — 10 tools):**

| Tool | Description |
|------|-------------|
| `get_project_info` | Get project name, track count, tempo, time sig |
| `list_tracks` | List all tracks with name, index, volume, mute/solo, parent |
| `get_track_properties` | Get detailed track properties (volume, pan, mute, solo, FX list) |
| `set_track_property` | Set volume, pan, mute, solo on a track |
| `add_fx` | Add FX plugin to a track by name (VST, JS, etc.) |
| `remove_fx` | Remove FX from a track |
| `get_fx_parameters` | List all parameters of an FX with current values |
| `set_fx_parameter` | Set a specific FX parameter value |
| `read_track_meters` | Get peak/RMS levels for a track (L/R) |
| `read_track_spectrum` | Get FFT frequency spectrum data for a track (requires JSFX analyzer on track) |

**Bridge communication (`bridge.ts`):**
- Writes command JSON to bridge directory
- Polls for response JSON with timeout (default 5s)
- Configurable bridge directory path
- Cleanup of stale command/response files

### Step 6: CLI entry point and setup

```bash
# Install globally
npm install -g @mthines/reaper-mcp

# One-time setup: copies Lua bridge + JSFX to REAPER scripts folder
reaper-mcp setup

# Run as MCP server (stdio mode for Claude Code)
reaper-mcp serve
```

**Claude Code MCP config** (`.mcp.json`):
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

---

## Real-Time Frequency Analysis Flow

For the "make sure meters are even" use case:

1. Agent calls `list_tracks` → gets all tracks and identifies instrument busses
2. Agent calls `add_fx` on each bus → adds "JS: MCP Spectrum Analyzer"
3. Agent calls `add_fx` on each bus → adds limiter (e.g., "JS: Brickwall Limiter" or a VST)
4. Agent calls `read_track_meters` on each bus → gets peak/RMS levels
5. Agent calls `read_track_spectrum` on each bus → gets frequency data
6. Agent compares levels and adjusts limiter thresholds via `set_fx_parameter`
7. Agent re-reads meters to verify levels are balanced
8. Repeat steps 4-7 until meters are even

**Latency budget:** ~50-150ms per read cycle — fast enough for iterative mixing decisions.

---

## Verification Plan

1. **Unit tests**: Test protocol serialization, bridge file I/O, tool schemas
2. **Integration test script**: Lua script that simulates the bridge (reads commands, writes canned responses) — allows testing MCP server without REAPER running
3. **End-to-end test**:
   - Start REAPER with a test project (a few tracks with audio)
   - Load `mcp_bridge.lua` in REAPER's ReaScript console
   - Run `reaper-mcp serve` and connect via Claude Code
   - Execute: "List all tracks", "Add limiter to track 1", "Read meters on track 1"
   - Verify real-time responses and REAPER state changes

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Separate repo** | Yes | This is an MCP server, not a JSFX skill — different concerns |
| **Communication** | File-based IPC (JSON) | Simple, cross-platform, no dependencies in REAPER, full API access |
| **Server language** | TypeScript | Nx ecosystem, MCP SDK support, Claude Code standard |
| **Bridge language** | Lua | Embedded in REAPER, no setup, full ReaScript API |
| **FFT analysis** | JSFX + gmem[] | Only way to get real-time frequency data from REAPER audio |
| **Transport** | stdio | Standard for Claude Code MCP integration |
| **Build tool** | esbuild via @nx/esbuild | Fast, recommended by Nx for CLI tools |

---

## Decisions Made

| Question | Decision |
|----------|----------|
| **JSFX analyzer placement** | Auto-insert: Lua bridge adds analyzer to track when `read_track_spectrum` is called, removes when done |
| **Bridge directory** | REAPER scripts folder: `{REAPER_RESOURCE_PATH}/Scripts/mcp_bridge_data/` |
| **Project location** | New repo: `mthines/reaper-mcp` (scaffolded in this repo for now, moved later) |

## Implementation Note

Since we're currently working in `jsfx-agent-skills`, we'll scaffold the full Nx project structure here on the `claude/reaper-mcp-research-H21hg` branch as a reference/prototype. The plan and research will serve as the blueprint for creating `mthines/reaper-mcp`.
