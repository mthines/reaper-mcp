# Testing with REAPER

This guide walks through setting up the REAPER MCP Server end-to-end: building the project, installing the bridge into REAPER, connecting an MCP client, and exercising every tool against a live REAPER session.

## Prerequisites

- **REAPER** installed (v6.0+ required, v7.0+ recommended for native JSON parsing)
- **Node.js** 20+
- **pnpm** installed globally
- A REAPER project with at least a few tracks and some audio (or use the empty project for basic testing)

## Step 1: Build the Project

```bash
cd reaper-mcp
pnpm install
pnpm nx build reaper-mcp-server
```

This produces `dist/apps/reaper-mcp-server/main.js` (the bundled server) and copies the `reaper/` assets (Lua bridge + JSFX) into the dist output.

## Step 2: Install Bridge Components into REAPER

Run the setup command to copy the Lua bridge script and JSFX analyzer to your REAPER resource folders:

```bash
node dist/apps/reaper-mcp-server/main.js setup
```

This installs:
- `mcp_bridge.lua` to `{REAPER_RESOURCE}/Scripts/`
- `mcp_analyzer.jsfx` to `{REAPER_RESOURCE}/Effects/`
- Creates `{REAPER_RESOURCE}/Scripts/mcp_bridge_data/` (the IPC directory)

On macOS the resource path is `~/Library/Application Support/REAPER`. You can override it:

```bash
REAPER_RESOURCE_PATH=/custom/path node dist/apps/reaper-mcp-server/main.js setup
```

## Step 3: Start the Lua Bridge in REAPER

1. Open REAPER
2. Open a project with some tracks (or create a few empty tracks)
3. Go to **Actions > Show action list**
4. Click **Load ReaScript...**
5. Navigate to `{REAPER_RESOURCE}/Scripts/mcp_bridge.lua` and select it
6. Click **Run** (or double-click the script in the action list)

You should see in the REAPER console (View > Show console):
```
MCP Bridge: Started
MCP Bridge: Bridge directory: /Users/you/Library/Application Support/REAPER/Scripts/mcp_bridge_data/
MCP Bridge: Polling every 30ms
```

The bridge runs persistently in the background via `reaper.defer()`. It will keep running until you close REAPER or explicitly stop the script.

### Verify the bridge is running

```bash
node dist/apps/reaper-mcp-server/main.js status
```

Should print: `Bridge status: CONNECTED`

## Step 4: Connect an MCP Client

You have three options for testing:

### Option A: MCP Inspector (recommended for manual testing)

The MCP Inspector is a web UI that lets you invoke tools interactively:

```bash
npx @modelcontextprotocol/inspector node dist/apps/reaper-mcp-server/main.js serve
```

This opens a browser tab where you can see all registered tools, fill in parameters, and see responses. This is the easiest way to test individual tools.

### Option B: Claude Code

Add to your project's `.mcp.json` (or `~/.claude/.mcp.json` for global):

```json
{
  "mcpServers": {
    "reaper": {
      "command": "node",
      "args": ["/absolute/path/to/reaper-mcp/dist/apps/reaper-mcp-server/main.js", "serve"]
    }
  }
}
```

Then start Claude Code. The REAPER tools will appear in the tool list. Try asking:
- "List all tracks in my REAPER project"
- "Add a ReaEQ to track 1"
- "Set track 0 volume to -6 dB"

### Option C: Direct stdio (for debugging)

You can pipe JSON-RPC messages directly:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/apps/reaper-mcp-server/main.js serve
```

## Step 5: Test Each Tool

Below are the 15 tools grouped by category, with expected behavior and what to look for in REAPER.

### Project Info

| Tool | What to test | Expected result |
|------|-------------|-----------------|
| `get_project_info` | Call with no params | Returns project name, path, track count, tempo, time sig, sample rate, play state, cursor position |

### Track Management

| Tool | What to test | Expected result |
|------|-------------|-----------------|
| `list_tracks` | Call with no params | Returns array of all tracks with name, volume (dB), pan, mute, solo, FX count, folder depth |
| `get_track_properties` | `trackIndex: 0` | Same as list_tracks but for one track, plus full `fxList` array with FX names, enabled state, presets |
| `set_track_property` | `trackIndex: 0, property: "volume", value: -12` | Track 0 fader moves to -12 dB in REAPER mixer. Returns confirmation text |
| `set_track_property` | `trackIndex: 0, property: "mute", value: 1` | Track 0 mute button lights up. Set `value: 0` to unmute |
| `set_track_property` | `trackIndex: 0, property: "pan", value: -0.5` | Track 0 pans left. Range is -1.0 (full left) to 1.0 (full right) |
| `set_track_property` | `trackIndex: 0, property: "solo", value: 1` | Track 0 solo button lights up |

**What to watch for**: After each `set_track_property`, visually confirm the change in REAPER's mixer view. The fader/knob/button should update immediately.

### FX Management

| Tool | What to test | Expected result |
|------|-------------|-----------------|
| `add_fx` | `trackIndex: 0, fxName: "ReaEQ"` | ReaEQ appears in track 0's FX chain. Returns `fxIndex` and resolved `fxName` |
| `add_fx` | `trackIndex: 0, fxName: "ReaComp"` | ReaComp added after ReaEQ. Check FX chain shows both |
| `get_fx_parameters` | `trackIndex: 0, fxIndex: 0` | Lists all ReaEQ params with names, current values, formatted values (e.g. "1000.0 Hz"), min/max |
| `set_fx_parameter` | `trackIndex: 0, fxIndex: 0, paramIndex: 0, value: 0.75` | The corresponding parameter knob moves in the ReaEQ UI. Value is normalized 0.0-1.0 |
| `remove_fx` | `trackIndex: 0, fxIndex: 1` | ReaComp removed from chain, ReaEQ remains |

**What to watch for**: Open the FX chain window for the track (click the FX button in the mixer). You should see FX appear/disappear and parameter knobs move in real-time.

**FX name matching**: The `fxName` parameter supports partial matching. These all work:
- `"ReaEQ"` matches `"VST: ReaEQ (Cockos)"`
- `"Pro-Q"` matches `"VST3: FabFilter Pro-Q 3"`
- `"JS: Schwa"` matches JS effects by Schwa

### Metering

| Tool | What to test | Expected result |
|------|-------------|-----------------|
| `read_track_meters` | `trackIndex: 0` (while audio is playing) | Returns `peakL`, `peakR`, `rmsL`, `rmsR` in dB. Values update each call |
| `read_track_meters` | `trackIndex: 0` (while stopped) | Returns very low dB values (e.g. -150) since no audio is flowing |

**What to watch for**: Start playback first (`play` tool or spacebar in REAPER), then read meters. The dB values should roughly match what you see on the track meters in REAPER's mixer.

### Spectrum Analysis

| Tool | What to test | Expected result |
|------|-------------|-----------------|
| `read_track_spectrum` | `trackIndex: 0` (while audio playing) | Auto-inserts `mcp_analyzer` JSFX on the track. Returns FFT bin data: `fftSize`, `binCount`, `frequencyResolution`, `peakDb`, `rmsDb`, and `bins` array |
| `read_track_spectrum` | `trackIndex: 0, fftSize: 8192` | Same but with higher resolution (more bins, lower Hz per bin) |
| `read_track_spectrum` | While stopped | Returns error: "Spectrum analyzer not producing data yet" |

**What to watch for**: After calling `read_track_spectrum`, check the FX chain -- you should see "mcp_analyzer" was automatically inserted. The bins array contains magnitude in dB per frequency bin from 0 Hz to Nyquist. With 4096 FFT at 44100 Hz sample rate, each bin is ~10.77 Hz wide.

To clean up after testing, use `remove_fx` to remove the analyzer.

### Transport Controls

| Tool | What to test | Expected result |
|------|-------------|-----------------|
| `play` | Call with no params | REAPER starts playback. Play button lights up |
| `stop` | Call with no params | REAPER stops playback. Play button goes off |
| `record` | Arm a track first, then call | REAPER starts recording. Record button lights up. **Caution**: this creates audio files |
| `get_transport_state` | Call while playing | Returns `playing: true`, `cursorPosition`, `playPosition` (advancing), `tempo`, time sig |
| `get_transport_state` | Call while stopped | Returns `playing: false`, `recording: false`, `paused: false` |
| `set_cursor_position` | `position: 30.5` | Edit cursor jumps to 30.5 seconds. Visible in REAPER's timeline/ruler |
| `set_cursor_position` | `position: 0` | Cursor returns to project start |

**What to watch for**: The REAPER transport bar reflects each action immediately. The cursor position in the timeline ruler should match what you set.

## End-to-End Workflow: "Balance the Busses"

This is the killer use case from the project spec. Try this sequence:

1. **Set up a project** with at least 3 tracks containing audio on different bus groups
2. **Start playback**: `play`
3. **List all tracks**: `list_tracks` -- identify your bus tracks by name
4. **Read meters on each bus**: `read_track_meters` with each bus track index
5. **Add a limiter**: `add_fx` with `fxName: "ReaComp"` (or any limiter) on each bus
6. **Get limiter params**: `get_fx_parameters` to find the threshold parameter index
7. **Adjust threshold**: `set_fx_parameter` to set the threshold on each bus
8. **Re-read meters**: `read_track_meters` to see if levels are more balanced
9. **Iterate**: Adjust parameters until meters across busses are even
10. **Optional spectrum check**: `read_track_spectrum` to see frequency balance

This is exactly what an AI agent does when you ask Claude Code: "Add a limiter to all instrument busses and make sure the meters are even."

## Troubleshooting

### "Bridge status: NOT DETECTED"

The Lua bridge isn't running or the heartbeat is stale (>5 seconds old).

- Check that `mcp_bridge.lua` is loaded in REAPER (Actions > Running scripts)
- Check the REAPER console for error messages
- Verify the bridge directory exists: `ls ~/Library/Application\ Support/REAPER/Scripts/mcp_bridge_data/`
- Check for a fresh `heartbeat.json` in that directory

### "Timeout: no response from REAPER Lua bridge"

The command was sent but the bridge didn't respond within 10 seconds.

- Is REAPER still running?
- Is the bridge script still active? (It can be stopped by closing REAPER or via the action list)
- Check for `command_*.json` files piling up in the bridge directory -- if they're not being consumed, the bridge isn't polling
- Check the REAPER console for Lua errors

### "FX not found: SomeName"

The FX name didn't match any installed plugin.

- Open REAPER's FX browser to see the exact names
- The name matching is partial, but it needs to be unique enough to resolve
- Try more specific names: `"VST: ReaEQ"` instead of just `"EQ"`
- JS effects need the `"JS: "` prefix

### "MCP Spectrum Analyzer JSFX not found"

The `mcp_analyzer.jsfx` wasn't installed into REAPER's Effects folder.

- Run `node dist/apps/reaper-mcp-server/main.js setup` again
- Or manually copy `reaper/mcp_analyzer.jsfx` to `{REAPER_RESOURCE}/Effects/`
- Restart REAPER after copying (it scans effects on startup)

### "Spectrum analyzer not producing data yet"

The JSFX was inserted but audio isn't flowing through it.

- Make sure playback is running (`play` tool or spacebar)
- The track must have audio routed through it
- The analyzer needs ~100ms after insertion to start producing data -- try again

## Running Unit Tests

The project also has 41 unit tests that don't require REAPER:

```bash
pnpm nx run-many --target=test
```

These mock the bridge layer and test all tool logic, parameter validation, and error handling.
