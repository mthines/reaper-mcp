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

## When you opt in or out

Your answer at setup, and `reaper-mcp telemetry on` / `off` when it changes your choice, sends **one** event, so I can count how many people opt in and how many opt out. Without it, everyone who opts out would be invisible, and I'd have no idea how many people use reaper-mcp at all.

That event carries only:

- on or off
- where you chose: the setup question, setup without a terminal (the notice was shown and the default kept), or the `telemetry` command
- reaper-mcp version, OS type and version

It carries **no install id** and nothing else from your machine, so it can't be linked to any usage telemetry you sent before or after. It is sent once per change: running `telemetry off` twice sends one. After an opt-out, nothing else is sent.

It is not sent when `DO_NOT_TRACK=1` or `REAPER_MCP_TELEMETRY=0` is set, or when you use your own `OTEL_*` exporters. Set one of those before `reaper-mcp telemetry off` (or before setup) if you'd rather opt out without being counted.

## What is sent

For each tool call:

- the tool name and the bridge command it ran (e.g. `set_fx_parameter`)
- whether it succeeded, and if not, the **kind** of error (`timeout`, `tool_error`, …)
- if it failed because a setup step is missing, which one: the audio sidecar isn't installed, the bridge isn't running, or REAPER runs an older bridge (one of those words, never the message)
- how long it took
- for key and chord detection: whether it read MIDI, rendered audio or a file, which engine it used, how many chords it found and how sure it was of the key (never the key or the chords)
- for plugin research runs (`/learn-plugin`, or `/mixer` or `/mastering` looking up a plugin they don't know): how the run ended (new record, refined, plugin not installed, failed to load, LoreKit not connected), which skill started it and how many plugins it researched at once, how long it took, the plugin's category (`compressor`, `eq`, …) and style (`transparent`, `vintage`, …) and its format (VST3, AU, CLAP, JS, …, and whether it's an instrument), its number of parameters as a range (`16-63`), how many were tested, how many sources were cited and questions left open, and whether the scratch track was cleaned up. Anything outside these fixed lists is sent as `other`. Never the plugin's name, and never details that point to one plugin in combination, such as its exact parameter count or whether it has a built-in record
- for plugins made with `/make-plugin`: whether each write was accepted or why it was refused (a fixed list: `written`, `refused_lint`, `refused_breaking`, `refused_exists`, `refused_name`, `refused_presets`, `refused_accent`, `failed`), whether it replaced an earlier version, and the plugin's **size and shape** as capped counts and ranges: how many controls it has, how many are in the core view and how many under Advanced, the file size as a range (`8-16k`), the version number, how many lint problems and warnings there were and how many suggested presets were written (never their names or values), and whether its accent colour is automatic, a named colour or a custom one (`auto`, `named`, `custom`; never the colour itself). When a run ends: how it ended (`shipped`, `compile_failed`, `checks_failed`, `abandoned`), how many rounds it took, how many checks passed and failed, which of the three shipped examples it started from (or `none`) and how long it took. Never the plugin's name, what you asked for, its code or any control's label. The plugins themselves contain no telemetry
- reaper-mcp version, OS type and version, Node.js version
- a random install id (`~/.reaper-mcp/install-id`), so one person's calls can be grouped without knowing who they are

Once per server start, whether an MCP client (your agent) connected to it — just that it did, not which client. A server started with no agent attached, by a script or a package scanner, is not counted as someone using reaper-mcp.

Plus periodic health numbers for the REAPER bridge, such as whether it's running and how fast its loop runs, and whether the bridge answered at startup and, if not, which setup step is missing: REAPER not found, bridge not installed, never started, or stopped (one of those words, never a path). The same word is attached to any tool call refused because the bridge wasn't running. At startup, also: whether REAPER itself is running when the bridge doesn't answer (to tell a closed REAPER from a stopped bridge), how long ago the bridge last answered as a coarse range (under a minute, an hour, a day, a week, or longer), whether the bridge is set to start with REAPER, whether the audio sidecar is installed, and whether that start updated REAPER's reaper-mcp files, added the start-with-REAPER block, or failed to update them (yes or no each).

## What is never sent

- your projects, track names, plugin names or settings
- tool parameters (values, positions, names you type), apart from the fixed values and counts a plugin research run or a `/make-plugin` run reports (above)
- error messages or stack traces, which can contain any of the above
- file paths, your user name, host name or machine id
- audio, MIDI or anything rendered

Nothing is collected while telemetry is off, apart from the single event at the moment you turn it off (above). If you set your own `OTEL_*` exporter variables, telemetry goes only to your destination, in full, and nothing goes to the developer.

## The bridge page

The bridge status page (`mcp_bridge.html`, opened from REAPER) sends its own pseudonymous usage statistics so I can see which parts of it people use: which views you open (Calls, Tools, Sessions, Plugins), which buttons and settings you use (Teach, Contribute, Publish, filters, the timeline range…), whether the bridge goes offline while the page is open, page load speed, and the kind of error when the page's own code fails (e.g. `TypeError`, never the message). Each event carries a random id kept in that browser, the reaper-mcp version, and whether the page runs as the bridge window, an installed app or a browser tab. The full list is in [`apps/bridge-ui/tracking-plan.yaml`](apps/bridge-ui/tracking-plan.yaml).

It never sends plugin, track, project or agent session names, what you type in the search box, your LoreKit tokens, the page's address (host or LAN IP) or the bridge's polling.

Turn it off under **Settings → Privacy → Share usage statistics** on the page. It is also off when your browser sends Global Privacy Control or Do Not Track, and in the `?demo` preview. The page keeps its own setting, so `reaper-mcp telemetry off` doesn't switch it off. The code is in [`apps/bridge-ui/src/lib/analytics.ts`](apps/bridge-ui/src/lib/analytics.ts).

## Update check

Separately from telemetry, and whether telemetry is on or off, an npm install asks the npm registry at most once a day which version of `@mthines/reaper-mcp` is the latest, so your agent can tell you when a newer release is out (at most once a day). It is a plain request for the package's public version number and sends nothing about you; the answer is kept in `~/.reaper-mcp/update-check.json`. Turn it off with `REAPER_MCP_UPDATE_CHECK=0` or `NO_UPDATE_NOTIFIER=1`. A git clone never asks.

## Where it goes

The data goes to an observability backend ([Dash0](https://www.dash0.com)) over OTLP, into a dataset only the developer can read. The ingest token built into the CLI can only write to that dataset, not read from it. The code that decides all of this is in [`apps/reaper-mcp-server/src/telemetry-consent.ts`](apps/reaper-mcp-server/src/telemetry-consent.ts).
