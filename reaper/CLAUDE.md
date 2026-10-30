# REAPER Scripts

Files installed INTO the REAPER DAW by the `setup` command. These run inside REAPER's scripting environment.

## Files

| File | Language | Purpose |
|------|----------|---------|
| `mcp_bridge.lua` | Lua | Persistent bridge: polls for JSON commands, executes ReaScript API, writes responses |
| `mcp_snapshot_lib.lua` | Lua | Shared library for snapshot action scripts (path helpers, JSON, restore logic) |
| `mcp_snapshots_ui_lib.lua` | Lua | Status page Snapshots view: lists the folder, runs page restore/save requests through the bridge's dispatcher |
| `mcp_snapshot_next.lua` | Lua | Action: restore next snapshot (bind to key for A/B testing) |
| `mcp_snapshot_prev.lua` | Lua | Action: restore previous snapshot (bind to key for A/B testing) |
| `mcp_snapshot_quick_save.lua` | Lua | Action: save snapshot with auto-name, no dialog |
| `mcp_analyzer.jsfx` | JSFX/EEL2 | Real-time FFT spectrum analyzer, writes to gmem[] |
| `mcp_lufs_meter.jsfx` | JSFX/EEL2 | LUFS loudness metering |
| `mcp_correlation_meter.jsfx` | JSFX/EEL2 | Stereo correlation and width analysis |
| `mcp_crest_factor.jsfx` | JSFX/EEL2 | Crest factor (peak-to-RMS) measurement |
| `mcp_gain_trace.jsfx` | JSFX/EEL2 | Pre/post gain trace for pumping/ducking: pair it around a chain (Mode pre/post, same Slot), read p5/p1/std after playback. No `1e9`-style literals (EEL2 rejects them; `jsfx-lint.test.ts` checks) |
| `install.sh` | Shell | Manual install helper |

## Lua Bridge (`mcp_bridge.lua`)

### How It Works
1. Runs as a persistent `reaper.defer()` loop (polls every ~30ms)
2. Reads `command_{uuid}.json` from bridge directory
3. Dispatches to handler function in the `handlers` table
4. Writes `response_{uuid}.json` with results
5. Writes `heartbeat.json` every 1s for liveness detection
6. Publishes a status feed to ExtState `MCPBridge/status` for the web status page (`apps/bridge-ui`)

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
