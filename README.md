# reaper-mcp

MCP server for controlling REAPER DAW — real-time mixing, FX control, and frequency analysis for AI agents.

## Architecture

```
Claude Code ←→ MCP Server (TS, stdio) ←→ JSON files ←→ Lua Bridge (REAPER defer loop) ←→ ReaScript API ←→ REAPER
                                                                                           ↑
                                                                  JSFX FFT Analyzer → gmem[] → spectrum data
```

## Quick Start

```bash
# Install dependencies
npm install

# Build
npx nx build reaper-mcp-server

# Install REAPER components (Lua bridge + JSFX analyzer)
node dist/apps/reaper-mcp-server/main.js setup
# OR manually:
./reaper/install.sh

# In REAPER: Actions > Load ReaScript > select mcp_bridge.lua > Run

# Start MCP server
node dist/apps/reaper-mcp-server/main.js serve
```

## Claude Code Integration

Add to your project's `.mcp.json`:

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

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_project_info` | Project name, track count, tempo, time sig, sample rate, transport state |
| `list_tracks` | All tracks with name, volume, mute/solo, folder structure |
| `get_track_properties` | Detailed track info including FX chain |
| `set_track_property` | Set volume (dB), pan, mute, solo |
| `add_fx` | Add FX plugin by name (VST, JS, etc.) |
| `remove_fx` | Remove FX from chain |
| `get_fx_parameters` | List all FX parameters with values |
| `set_fx_parameter` | Set FX parameter (normalized 0.0–1.0) |
| `read_track_meters` | Real-time peak/RMS levels (dB) |
| `read_track_spectrum` | FFT frequency spectrum (auto-inserts analyzer JSFX) |

## Real-Time Frequency Analysis

The `read_track_spectrum` tool uses a custom JSFX plugin (`mcp_analyzer.jsfx`) that:
- Performs 4096-point FFT on incoming audio
- Writes magnitude spectrum to REAPER's shared memory (`gmem[]`)
- Lua bridge reads via `gmem_attach()`/`gmem_read()`
- ~50-150ms end-to-end latency

The analyzer is auto-inserted onto the track when requested and can be removed with `remove_fx`.

## Project Structure

```
reaper-mcp/
├── apps/reaper-mcp-server/   # TypeScript MCP server (Nx app)
│   └── src/
│       ├── main.ts           # CLI entry point
│       ├── server.ts         # McpServer + tool registration
│       ├── bridge.ts         # File-based IPC with Lua bridge
│       └── tools/            # Tool definitions (tracks, fx, meters, project)
├── libs/protocol/            # Shared TypeScript types
├── reaper/                   # Files installed into REAPER
│   ├── mcp_bridge.lua        # Persistent Lua bridge script
│   ├── mcp_analyzer.jsfx     # FFT spectrum analyzer
│   └── install.sh            # Quick install script
├── nx.json                   # Nx workspace config
└── package.json              # Root workspace
```

## How the Bridge Works

1. MCP server writes `command_{uuid}.json` to `{REAPER_RESOURCE_PATH}/Scripts/mcp_bridge_data/`
2. Lua bridge polls directory every ~30ms via `reaper.defer()` loop
3. Lua bridge reads command, executes ReaScript API calls
4. Lua bridge writes `response_{uuid}.json` with results
5. MCP server polls for response, returns to client

## Development

```bash
npx nx build reaper-mcp-server    # Build
npx nx test reaper-mcp-server     # Test
npx nx serve reaper-mcp-server    # Build + run
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REAPER_RESOURCE_PATH` | Override REAPER resource directory | Auto-detected per OS |

## License

MIT
