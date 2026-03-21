---
description: Rules for working with the Lua bridge and JSFX files in the reaper/ directory
paths: ["reaper/**"]
---

# Lua Bridge & JSFX Rules

## Lua Bridge (`mcp_bridge.lua`)

- The bridge runs as a persistent `reaper.defer()` loop inside REAPER -- it polls every ~30ms
- It writes a `heartbeat.json` file every 1 second so the MCP server can detect if it's alive
- JSON parsing: uses `CF_Json_Parse` (REAPER 7+) if available, falls back to Lua pattern matching
- JSON encoding: custom implementation that handles strings, numbers, booleans, arrays, and nested objects
- All ReaScript API calls are in handler functions inside the `handlers` table
- The bridge must be resilient to malformed input -- always wrap file reads in pcall

### Adding a Lua Handler

```lua
handlers["new_command_type"] = function(params)
  -- params is a Lua table from JSON parsing
  -- Use ReaScript API calls here
  local result = reaper.SomeApiFunction(params.someValue)
  -- Return a Lua table that will be JSON-encoded as response.data
  return { field = result }
end
```

### Important ReaScript API Notes

- Track indices are 0-based in the MCP protocol but ReaScript uses `GetTrack(proj, idx)` which is also 0-based
- Volume values: ReaScript uses linear scale internally, the bridge converts to/from dB
- FX names support partial matching via `TrackFX_AddByName()`
- `Track_GetPeakInfo()` returns linear values -- convert to dB with `20 * math.log(value, 10)`

## JSFX Analyzer (`mcp_analyzer.jsfx`)

- Runs in REAPER's audio processing thread (not the scripting thread)
- Communicates with Lua via `gmem[]` shared memory (namespace: `MCPAnalyzer`)
- gmem layout: `gmem[0]=bin_count, gmem[1]=peak_dB, gmem[2]=rms_dB, gmem[3..]=bins`
- Must pass audio through unmodified (transparent insert)
- FFT size is configurable via slider (512-8192, default 4096)
- Window functions: Rectangular, Hann (default), Hamming, Blackman-Harris
- Output smoothing is configurable (default 0.8)

## Testing Without REAPER

- The MCP server can be tested by mocking `sendCommand()` in bridge.ts
- For integration tests, create a mock bridge that reads command files and writes canned response files
- The Lua bridge cannot be unit tested outside of REAPER -- test it manually
