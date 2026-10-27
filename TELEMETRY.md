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

## Where it goes

The data goes to an observability backend ([Dash0](https://www.dash0.com)) over OTLP, into a dataset only the developer can read. The ingest token built into the CLI can only write to that dataset, not read from it. The code that decides all of this is in [`apps/reaper-mcp-server/src/telemetry-consent.ts`](apps/reaper-mcp-server/src/telemetry-consent.ts).
