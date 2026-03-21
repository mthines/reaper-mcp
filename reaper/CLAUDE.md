# REAPER Scripts

Files installed INTO the REAPER DAW by the `setup` command. These run inside REAPER's scripting environment.

## Files

| File | Language | Purpose |
|------|----------|---------|
| `mcp_bridge.lua` | Lua | Persistent bridge: polls for JSON commands, executes ReaScript API, writes responses |
| `mcp_analyzer.jsfx` | JSFX/EEL2 | Real-time FFT spectrum analyzer, writes to gmem[] |
| `mcp_lufs_meter.jsfx` | JSFX/EEL2 | LUFS loudness metering |
| `mcp_correlation_meter.jsfx` | JSFX/EEL2 | Stereo correlation and width analysis |
| `mcp_crest_factor.jsfx` | JSFX/EEL2 | Crest factor (peak-to-RMS) measurement |
| `install.sh` | Shell | Manual install helper |

## Lua Bridge (`mcp_bridge.lua`)

### How It Works
1. Runs as a persistent `reaper.defer()` loop (polls every ~30ms)
2. Reads `command_{uuid}.json` from bridge directory
3. Dispatches to handler function in the `handlers` table
4. Writes `response_{uuid}.json` with results
5. Writes `heartbeat.json` every 1s for liveness detection

### Adding a Handler
```lua
handlers["command_type"] = function(params)
  local result = reaper.SomeApiCall(params.paramName)
  return { field = result }
end
```

The command type string must exactly match `CommandType` in `libs/protocol/src/commands.ts`.

### Key Constraints
- REAPER Lua is sandboxed: **no sockets, no HTTP, no stdin/stdout** — file-based IPC only
- JSON parsing: uses `CF_Json_Parse` if available (REAPER 7+), falls back to custom Lua parser
- Track indices are 0-based (same as ReaScript)
- Volume values: bridge converts between dB (MCP protocol) and linear (ReaScript internally)
- Always wrap file reads in `pcall` for resilience

## JSFX Meters

- Run in REAPER's **audio thread** (not scripting thread)
- Communicate with Lua via `gmem[]` shared memory
- Each JSFX uses a unique gmem namespace (e.g., `MCPAnalyzer`, `MCPLufsMeter`)
- Must pass audio through unmodified (transparent inserts)
- Auto-inserted by corresponding MCP tools (`read_track_spectrum`, `read_track_lufs`, etc.)

## Testing

- **No automated tests possible** — REAPER's Lua/JSFX environment cannot be unit tested outside REAPER
- Test manually: install bridge, run MCP Inspector, exercise commands
- Server-side tests mock `sendCommand()` in `bridge.ts`

## Installation

Files are copied to `{REAPER_RESOURCE_PATH}/Scripts/` by:
- `node dist/apps/reaper-mcp-server/main.js setup` (programmatic)
- `install.sh` (manual)
