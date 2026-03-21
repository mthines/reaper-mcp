# REAPER MCP Server

An MCP (Model Context Protocol) server that enables AI agents (Claude Code, etc.) to control a live REAPER DAW session in real-time -- including track management, FX control, parameter adjustment, metering, and frequency analysis.

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
        fx.ts                 # add_fx, remove_fx, get_fx_parameters, set_fx_parameter
        meters.ts             # read_track_meters, read_track_spectrum

  libs/protocol/              # Shared TypeScript types (compiled with tsc)
    src/
      index.ts                # Re-exports commands + responses
      commands.ts             # BridgeCommand, CommandType, per-command param interfaces
      responses.ts            # BridgeResponse, ProjectInfo, TrackInfo, FxInfo, etc.

  reaper/                     # Files installed INTO REAPER (copied by setup command)
    mcp_bridge.lua            # Persistent Lua bridge (defer loop, JSON IPC, all 10 handlers)
    mcp_analyzer.jsfx         # Real-time FFT analyzer (JSFX, writes to gmem[])
    install.sh                # Manual install helper script
```

## Workspace Packages

| Package | Location | Build | Purpose |
|---------|----------|-------|---------|
| `@mthines/reaper-mcp` | `/` (root) | -- | Workspace root, scripts |
| `@mthines/reaper-mcp-server` | `apps/reaper-mcp-server` | `@nx/esbuild` (ESM bundle) | MCP server application |
| `@reaper-mcp/protocol` | `libs/protocol` | `@nx/js:tsc` | Shared command/response types |

## The 15 MCP Tools

| Tool | File | Description |
|------|------|-------------|
| `get_project_info` | `tools/project.ts` | Project name, tempo, time sig, sample rate, transport state |
| `list_tracks` | `tools/tracks.ts` | All tracks with volume, pan, mute/solo, FX count, routing |
| `get_track_properties` | `tools/tracks.ts` | Detailed single track info + full FX chain list |
| `set_track_property` | `tools/tracks.ts` | Set volume (dB), pan, mute, solo |
| `add_fx` | `tools/fx.ts` | Add FX by name (partial match: "ReaEQ", "VST: Pro-Q 3") |
| `remove_fx` | `tools/fx.ts` | Remove FX from chain by index |
| `get_fx_parameters` | `tools/fx.ts` | List all FX params with current values and ranges |
| `set_fx_parameter` | `tools/fx.ts` | Set FX parameter (normalized 0.0-1.0) |
| `read_track_meters` | `tools/meters.ts` | Peak/RMS L/R in dB |
| `read_track_spectrum` | `tools/meters.ts` | FFT frequency bins (auto-inserts JSFX analyzer) |
| `play` | `tools/transport.ts` | Start playback |
| `stop` | `tools/transport.ts` | Stop playback/recording |
| `record` | `tools/transport.ts` | Start recording (arms must be set on target tracks) |
| `get_transport_state` | `tools/transport.ts` | Play/record/pause status, cursor positions, tempo, time sig |
| `set_cursor_position` | `tools/transport.ts` | Move edit cursor to position in seconds |

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

To add a new tool, touch these 4 places:

1. **`libs/protocol/src/commands.ts`** -- Add command type to `CommandType` union, add params interface
2. **`libs/protocol/src/responses.ts`** -- Add response data interface if needed
3. **`apps/reaper-mcp-server/src/tools/`** -- Create or extend a tool file, register with `server.tool()`
4. **`reaper/mcp_bridge.lua`** -- Add handler function in the `handlers` table

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
- No test files exist yet -- tests should mock `sendCommand()` to test tools without REAPER running

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
