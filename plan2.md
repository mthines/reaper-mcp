## REAPER MCP Server — Full Project Report

### What Was Built

A complete, buildable MCP (Model Context Protocol) server that enables AI agents (Claude Code, etc.) to control REAPER DAW in real-time. The project lives at `reaper-mcp/` and follows an Nx monorepo structure.

---

### Architecture & Design Decisions

**Communication Pattern: File-Based IPC (JSON files)**

The core challenge is that REAPER's scripting environment (ReaScript/Lua) is sandboxed — no sockets, no HTTP server, no stdin/stdout. The only reliable cross-process communication options are:

1. File-based IPC (chosen)
2. OSC protocol
3. REAPER's built-in web interface

File-based IPC was chosen because:
- Works on all platforms (macOS, Windows, Linux) with zero dependencies
- Lua has native `io.open`/`io.close` — no extensions needed
- REAPER's `reaper.defer()` provides a reliable polling loop (~30ms intervals)
- Simple to debug (just read the JSON files)
- ~50-150ms round-trip latency, which is fine for AI agent use cases

**Flow:**
```
Claude Code ←stdio→ MCP Server (TypeScript)
                        ↓ writes command_{uuid}.json
                        ↓ polls for response_{uuid}.json
    REAPER Scripts/mcp_bridge_data/
                        ↑ Lua bridge reads commands via defer() loop
                        ↑ Executes ReaScript API calls
                        ↑ Writes response_{uuid}.json
```

**Spectrum Analysis: JSFX + gmem Shared Memory**

For real-time FFT frequency data, a custom JSFX plugin (`mcp_analyzer.jsfx`) was built because:
- JSFX runs in the audio thread — sample-accurate access to audio data
- JSFX can write to `gmem[]` (REAPER's global shared memory between JSFX and Lua)
- Lua bridge reads `gmem[]` via `reaper.gmem_attach()` / `reaper.gmem_read()`
- No temp files needed for high-frequency spectrum data
- The analyzer is auto-inserted onto tracks when `read_track_spectrum` is called

**gmem layout:**
```
gmem[0] = bin_count (fft_size / 2)
gmem[1] = peak dB
gmem[2] = RMS dB
gmem[3 .. 3+bin_count-1] = magnitude in dB per frequency bin
```

---

### Project Structure

```
reaper-mcp/
├── package.json              # Root workspace, npm scripts
├── nx.json                   # Nx workspace config (build caching, targets)
├── tsconfig.base.json        # Shared TS config with path aliases
├── mcp.json.example          # Example MCP client configuration
├── README.md                 # Usage docs
├── PLAN.md                   # Detailed architecture/research plan
│
├── apps/reaper-mcp-server/   # The MCP server (Nx application)
│   ├── package.json
│   ├── project.json          # Nx build/serve/test targets (esbuild bundler)
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── main.ts           # CLI entry: serve | setup | status
│       ├── server.ts         # Creates McpServer, registers all 10 tools
│       ├── bridge.ts         # File-based IPC: sendCommand(), isBridgeRunning(), etc.
│       └── tools/
│           ├── project.ts    # get_project_info
│           ├── tracks.ts     # list_tracks, get_track_properties, set_track_property
│           ├── fx.ts         # add_fx, remove_fx, get_fx_parameters, set_fx_parameter
│           └── meters.ts     # read_track_meters, read_track_spectrum
│
├── libs/protocol/            # Shared TypeScript types (Nx library)
│   ├── package.json
│   ├── project.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # Re-exports
│       ├── commands.ts       # BridgeCommand, CommandType, per-command param interfaces
│       └── responses.ts      # BridgeResponse, ProjectInfo, TrackInfo, FxInfo, etc.
│
└── reaper/                   # Files that get installed INTO REAPER
    ├── mcp_bridge.lua        # Persistent Lua bridge (defer loop, JSON IPC)
    ├── mcp_analyzer.jsfx     # FFT spectrum analyzer (audio thread, gmem output)
    └── install.sh            # Shell script to copy files to REAPER resource path
```

---

### The 10 MCP Tools

| # | Tool | Params | What It Does |
|---|------|--------|--------------|
| 1 | `get_project_info` | none | Returns project name, path, track count, tempo, time sig, sample rate, play/record state, cursor position |
| 2 | `list_tracks` | none | Returns array of all tracks with name, volume (dB + raw), pan, mute, solo, FX count, sends/receives, folder depth, parent index, color |
| 3 | `get_track_properties` | `trackIndex` | Same as list_tracks but for one track, plus full FX chain list (name, enabled, preset) |
| 4 | `set_track_property` | `trackIndex, property, value` | Sets volume (dB), pan (-1..1), mute (0/1), or solo (0/1) on a track |
| 5 | `add_fx` | `trackIndex, fxName, position?` | Adds FX by name (partial match: "ReaEQ", "VST: Pro-Q 3", "JS: ..."). Returns inserted FX index |
| 6 | `remove_fx` | `trackIndex, fxIndex` | Removes FX from chain by index |
| 7 | `get_fx_parameters` | `trackIndex, fxIndex` | Lists all parameters of an FX: name, normalized value, formatted value (e.g. "-6.0 dB"), min/max |
| 8 | `set_fx_parameter` | `trackIndex, fxIndex, paramIndex, value` | Sets a parameter (normalized 0.0–1.0) |
| 9 | `read_track_meters` | `trackIndex` | Returns real-time peak L/R and RMS L/R in dB |
| 10 | `read_track_spectrum` | `trackIndex, fftSize?` | Returns FFT frequency bins in dB. Auto-inserts JSFX analyzer if not present. Default 4096-point FFT |

---

### Key Files — What Each Does

**`apps/reaper-mcp-server/src/main.ts`** — CLI entry point with three commands:
- `serve` (default): Starts MCP server on stdio, cleans stale files, checks if Lua bridge is running
- `setup`: Copies `mcp_bridge.lua` and `mcp_analyzer.jsfx` to REAPER's resource folders, prints next-steps
- `status`: Checks if bridge heartbeat file was updated in the last 5 seconds

**`apps/reaper-mcp-server/src/bridge.ts`** — The IPC layer:
- `sendCommand(type, params, timeout)`: Writes `command_{uuid}.json`, polls for `response_{uuid}.json`, returns result or timeout error
- `isBridgeRunning()`: Checks `heartbeat.json` mtime
- `cleanupStaleFiles()`: Removes orphaned command/response files older than 30s
- `ensureBridgeDir()`: Creates `{REAPER_RESOURCE}/Scripts/mcp_bridge_data/`
- OS-aware REAPER path detection: macOS (`~/Library/Application Support/REAPER`), Windows (`%APPDATA%/REAPER`), Linux (`~/.config/REAPER`)
- Override via `REAPER_RESOURCE_PATH` env var

**`apps/reaper-mcp-server/src/server.ts`** — Creates `McpServer` from the official `@modelcontextprotocol/sdk`, registers all tool groups.

**`reaper/mcp_bridge.lua`** — The REAPER-side bridge:
- Runs as a persistent `reaper.defer()` loop (survives between calls, runs until REAPER closes or script is stopped)
- Polls `mcp_bridge_data/` every ~30ms for `command_*.json` files
- Minimal JSON parser (uses REAPER 7+ `CF_Json_Parse` if available, falls back to Lua pattern matching)
- JSON encoder for response objects (handles strings, numbers, booleans, arrays, nested objects)
- Heartbeat: writes `heartbeat.json` every 1 second so MCP server can detect if bridge is alive
- All 10 command handlers implemented using ReaScript API:
  - Track enumeration, property get/set
  - FX chain management (add/remove/get params/set params)
  - Peak metering via `Track_GetPeakInfo()`
  - Spectrum via `gmem_attach("MCPAnalyzer")` + `gmem_read()`

**`reaper/mcp_analyzer.jsfx`** — Real-time FFT analyzer:
- Runs in REAPER's audio processing thread
- Mixes stereo to mono, applies configurable window function (Hann default)
- Performs `fft_real()` on configurable FFT size (512–8192, default 4096)
- Calculates magnitude in dB per bin with configurable smoothing (default 0.8)
- Tracks peak and RMS levels
- Writes everything to `gmem[]` under namespace `MCPAnalyzer`
- Passes audio through unmodified (transparent insert)
- Slider controls: FFT size, window function (Rectangular/Hann/Hamming/Blackman-Harris), smoothing

**`libs/protocol/src/commands.ts`** — TypeScript interfaces for all command types and their params.

**`libs/protocol/src/responses.ts`** — TypeScript interfaces for all response data shapes (`ProjectInfo`, `TrackInfo`, `TrackProperties`, `FxInfo`, `FxParameterInfo`, `TrackMeters`, `TrackSpectrum`).

---

### Build System

- **Nx 20** monorepo with `@nx/esbuild` for bundling the server app
- **esbuild** bundles everything into a single `dist/apps/reaper-mcp-server/main.js` (ESM format, Node 20 target)
- The `reaper/` directory is copied as assets into the dist output (so `setup` command can find the Lua/JSFX files)
- **vitest** configured for testing (config exists, tests not yet written)
- Path alias `@reaper-mcp/protocol` → `libs/protocol/src/index.ts`

---

### What's NOT Done Yet (Follow-up Work)

1. **Unit tests** — vitest config exists but no test files. Need mocked bridge responses to test tools without REAPER running.
2. **The GitHub repo itself** — I couldn't create `mthines/reaper-mcp` from this environment (no `gh` auth). The user has already extracted the files into a fresh repo manually.
3. **npm publish / npx support** — `package.json` has `bin` config but needs `"type": "module"` at root and a published package for `npx reaper-mcp` to work.
4. **Error handling edge cases** — The Lua JSON parser is minimal. For complex nested params, the `CF_Json_Parse` fallback (REAPER 7+) is needed.
5. **Transport actions** — play, stop, record, seek, etc. These are easy to add (e.g. `reaper.Main_OnCommand(1007, 0)` for play).
6. **Render/bounce** — Offline rendering via `reaper.Main_OnCommand()` with render action IDs.
7. **MIDI tools** — Insert notes, read MIDI items, quantize, etc.
8. **Multi-project support** — Currently assumes project index 0.
9. **Reconnection / hot-reload** — Bridge restart detection on the MCP server side.

---

### How to Continue Development

```bash
cd reaper-mcp
npm install
npx nx build reaper-mcp-server

# Run the server directly
node dist/apps/reaper-mcp-server/main.js

# Test with MCP inspector (web UI for invoking tools)
npx @modelcontextprotocol/inspector node dist/apps/reaper-mcp-server/main.js

# Add to Claude Code
# .mcp.json: { "mcpServers": { "reaper": { "command": "node", "args": ["/path/to/dist/apps/reaper-mcp-server/main.js"] } } }
```

To add new tools: create a file in `apps/reaper-mcp-server/src/tools/`, register it in `server.ts`, add the command type to `libs/protocol/src/commands.ts`, add the handler in `reaper/mcp_bridge.lua`.