# REAPER Scripts

Files installed INTO the REAPER DAW by the `setup` command. These run inside REAPER's scripting environment.

## Files

| File | Language | Purpose |
|------|----------|---------|
| `mcp_bridge.lua` | Lua | Persistent bridge: polls for JSON commands, executes ReaScript API, writes responses |
| `mcp_tracks_lib.lua` | Lua | Track structure and routing |
| `mcp_plan_lib.lua` | Lua | `run_plan` executor, JSON decoder, chunk helpers |
| `mcp_actions_lib.lua` | Lua | Action search/run proxy, selection setters |
| `mcp_project_lib.lua` | Lua | Project ops, render settings, tempo map, markers |
| `mcp_items_lib.lua` | Lua | Items, takes, take FX, FX chains, track templates |
| `mcp_recording_lib.lua` | Lua | Record inputs, monitoring and modes, punch, fixed lanes, comping |
| `mcp_envelopes_lib.lua` | Lua | Envelopes, points (dB through the envelope's scaling), pooled automation items |
| `mcp_edit_views_lib.lua` | Lua | Status page results and before/after edit views |
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

- **Lua runs in tests through wasmoon** (Lua 5.4 in WebAssembly) against a fake `reaper` API: the `*_lib.lua`
  files are pure (they take the API as an argument) and are tested in `*-lib.test.ts`; the whole bridge runs in
  `bridge-*.test.ts`. Put new logic in a lib, not in `mcp_bridge.lua` (its main chunk is at Lua's 200-locals limit)
- Check REAPER's real behaviour live before trusting the fake: some calls ignore arguments without an error
  (e.g. `SetEnvelopePointEx` with a flagged automation item index), and the fake should model what you saw
- Server-side tests stub `sendCommand()` in `bridge.ts`

## Installation

Files are copied to `{REAPER_RESOURCE_PATH}/Scripts/` by:
- `node dist/apps/reaper-mcp-server/main.js setup` (programmatic)
- `install.sh` (manual)
