# Telemetry

reaper-mcp is built by one developer — me, in my spare time. Pseudonymous usage telemetry is the only way I can see which tools people use, which ones fail, and where things are slow, so it's **on by default**. You can turn it off any time, and setup asks you before anything is sent.

## Opting out

Any one of these turns it off:

```bash
reaper-mcp telemetry off       # saved in ~/.reaper-mcp/config.json
REAPER_MCP_TELEMETRY=0         # environment variable
DO_NOT_TRACK=1                 # the common convention, honored too
```

`reaper-mcp telemetry status` (or `reaper-mcp doctor`) shows the current state and why. `reaper-mcp telemetry on` turns it back on. Restart Claude Code (or run `/mcp`) so the running server picks up the change.

## What is sent

For each tool call:

- the tool name and the bridge command it ran (e.g. `set_fx_parameter`)
- whether it succeeded, and if not, the **kind** of error (`timeout`, `tool_error`, …)
- how long it took
- for key and chord detection: whether it read MIDI, rendered audio or a file, which engine it used, how many chords it found and how sure it was of the key (never the key or the chords)
- reaper-mcp version, OS type and version, Node.js version
- a random install id (`~/.reaper-mcp/install-id`), so one person's calls can be grouped without knowing who they are

Plus periodic health numbers for the REAPER bridge, such as whether it's running and how fast its loop runs.

## What is never sent

- your projects, track names, plugin names or settings
- tool parameters (values, positions, names you type)
- error messages or stack traces, which can contain any of the above
- file paths, your user name, host name or machine id
- audio, MIDI or anything rendered

Nothing is collected while telemetry is off. If you set your own `OTEL_*` exporter variables, telemetry goes only to your destination, in full, and nothing goes to the developer.

## The bridge page

The bridge status page (`mcp_bridge.html`, opened from REAPER) sends its own pseudonymous usage statistics so I can see which parts of it people use: which views you open (Calls, Tools, Sessions, Plugins), which buttons and settings you use (Teach, Contribute, Publish, filters, the timeline range…), whether the bridge goes offline while the page is open, page load speed, and the kind of error when the page's own code fails (e.g. `TypeError`, never the message). Each event carries a random id kept in that browser, the reaper-mcp version, and whether the page runs as the bridge window, an installed app or a browser tab. The full list is in [`apps/bridge-ui/tracking-plan.yaml`](apps/bridge-ui/tracking-plan.yaml).

It never sends plugin, track, project or agent session names, what you type in the search box, your LoreKit tokens, the page's address (host or LAN IP) or the bridge's polling.

Turn it off under **Settings → Privacy → Share usage statistics** on the page. It is also off when your browser sends Global Privacy Control or Do Not Track, and in the `?demo` preview. The page keeps its own setting, so `reaper-mcp telemetry off` doesn't switch it off. The code is in [`apps/bridge-ui/src/lib/analytics.ts`](apps/bridge-ui/src/lib/analytics.ts).

## Where it goes

The data goes to an observability backend ([Dash0](https://www.dash0.com)) over OTLP, into a dataset only the developer can read. The ingest token built into the CLI can only write to that dataset, not read from it. The code that decides all of this is in [`apps/reaper-mcp-server/src/telemetry-consent.ts`](apps/reaper-mcp-server/src/telemetry-consent.ts).
