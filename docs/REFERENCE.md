# reaper-mcp reference

The technical details behind the [README](../README.md): installation internals,
architecture, memory, CLI, configuration and development. The full tool list is in
[TOOLS.md](TOOLS.md).

## Architecture

```
Claude Code ←stdio→ MCP Server (TypeScript) ←JSON files→ Lua Bridge (REAPER)
                                                              │
                                              ReaScript API ←─┘
                                              gmem[] shared memory ←── JSFX Analyzers
```

REAPER's scripting environment is sandboxed — no sockets, no HTTP. The Lua bridge runs inside REAPER via `reaper.defer()` at ~30ms intervals, polling a shared directory for JSON command/response files. Round-trip latency: ~50-150ms.

The bridge also publishes its own status (connection, defer-loop timing, the last 50 commands with handler time and errors) to REAPER's in-memory ExtState. A small React page, served by REAPER's built-in web interface, reads it — see [Bridge status window](#bridge-status-window).

## Installation

### Prerequisites

- [REAPER](https://www.reaper.fm/) v6.0+ (v7.0+ recommended)
- [Node.js](https://nodejs.org/) 20+ (pnpm is optional — see below)
- [Claude Code](https://claude.com/claude-code)
- [SWS Extensions](https://www.sws-extension.org/) (recommended — enables plugin discovery and enhanced features)

### One command

Clone the repo and run the installer — the repo is the source of truth:

```bash
git clone https://github.com/mthines/reaper-mcp.git && cd reaper-mcp
./scripts/install.sh
```

`scripts/install.sh` prints one ✓ line per step and writes the full output to
`tmp/install.log`; `./scripts/install.sh --verbose` streams it instead. A failing
step shows the end of the log. It runs these steps (each is also runnable on its own):

1. `pnpm install && pnpm nx build reaper-mcp-server` — deps + build. pnpm is
   used if installed, else `corepack pnpm` (bundled with Node 20–24), else a
   one-off `npx pnpm@<packageManager version>`; no global install needed.
2. `reaper-mcp setup` — installs the Lua bridge, snapshot scripts and JSFX into
   REAPER, installs the bridge status page, and turns on REAPER's web interface
   for it.
3. `scripts/sync-symlinks.sh` — symlinks the skills + knowledge into `~/.claude`:
   - `~/.claude/skills/<name>` → `<repo>/.claude/skills/<name>` (skill dir with `SKILL.md`)
   - `~/.claude/knowledge` → `<repo>/knowledge` (genres, workflows, reference)
4. `reaper-mcp init` — writes the REAPER tool allow-list to `~/.claude/settings.json`
   and a `.mcp.json` in the clone that runs
   `node <clone>/dist/apps/reaper-mcp-server/main.js serve` (copy-free).
5. `claude mcp add --scope user reaper -- node <clone>/dist/apps/reaper-mcp-server/main.js serve`
   — registers the server for your user, by absolute path, so Claude Code sees
   REAPER from any folder without `reaper-mcp` on PATH. An existing user-scope
   `reaper` server is left alone. Skipped (with a note) when Claude Code isn't installed.
6. `pnpm link --global` (from `dist/apps/reaper-mcp-server`) — best effort: puts
   `reaper-mcp` on your PATH when pnpm has a global bin dir. Nothing depends on it;
   `npm run doctor` in the clone does the same as `reaper-mcp doctor`.

`sync-symlinks.sh` is idempotent and **refuses to overwrite a real file or
directory** (run it with `--dry-run` to preview). Because `~/.claude/knowledge`
*is* your repo, edits to genres, workflows and reference sheets land in the
working tree. Plugin knowledge and lessons live in LoreKit (see
[How the mix skills work](#how-the-mix-skills-work)).

The repo's `.claude/rules/` (architecture, development, lua-bridge, testing) are
**not** symlinked globally — they're for developing reaper-mcp, and load
automatically when you work inside the repo.

**What `setup` installs** into your REAPER resource folder:
- `mcp_bridge.lua` — persistent Lua bridge script, plus the Lua libraries it loads (`mcp_*_lib.lua`)
- `mcp_snapshot_next.lua`, `mcp_snapshot_prev.lua`, `mcp_snapshot_quick_save.lua` — A/B action scripts
- `reaper_www_root/mcp_bridge.html` — the bridge status page
- `mcp_analyzer.jsfx` — FFT spectrum analyzer
- `mcp_lufs_meter.jsfx` — ITU-R BS.1770 LUFS meter
- `mcp_correlation_meter.jsfx` — stereo correlation analyzer
- `mcp_crest_factor.jsfx` — dynamics/crest factor meter
- `mcp_midi_emitter.jsfx` — live MIDI output for `send_midi_*`

It also enables REAPER's web browser interface on port 8099 (set
`REAPER_WEB_PORT` to change it) by adding a control surface to `reaper.ini`. An
existing web interface is kept as it is. REAPER rewrites `reaper.ini` when it
quits, so setup only edits it while REAPER is closed and asks you to quit REAPER
if it is running.

### Start the Lua Bridge in REAPER

After setup, load the bridge in REAPER:

1. Open REAPER
2. **Actions > Show action list > Load ReaScript**
3. Select `mcp_bridge.lua` from your REAPER Scripts folder
4. Click **Run** — the bridge runs persistently in the background

The bridge opens its status window (see below). Without the web interface it
prints a one-line note to REAPER's console instead.

### Bridge status window

On start the bridge opens `http://localhost:8099/mcp_bridge.html` as a small
app window (Chrome, Edge, Brave or Chromium, else your default browser). It
skips this when the page is already open, so restarting the bridge never stacks
windows. The page shows:

- live / stale / offline state and the bridge's defer-loop timing
- a latency strip of recent commands
- a searchable command log with an errors filter, expandable rows, pause and copy

Rendering happens in the browser, off REAPER's main thread; the bridge only
writes a small JSON status to memory, at most 5 times a second. Add `?demo` to
the URL to preview the page with fake data. To stop the window opening, set
`OPEN_UI_ON_START = false` at the top of `mcp_bridge.lua`.

### Verify

```bash
npm run doctor        # from the clone; or `reaper-mcp doctor` if it's on your PATH
```

Checks that the bridge is connected, knowledge is installed, and Claude Code has
the server (user-scope registration or a `.mcp.json` in the current folder).

## How the mix skills work

### Memory — the skills get better over time

The mix skills keep two layers of memory:

- **Reference knowledge** (`knowledge/`, versioned in git) — genre conventions,
  step-by-step workflows, and reference material (frequencies, metering, …).
- **Plugin knowledge + lessons** (LoreKit, scope `project::reaper-mcp`, via its
  `memory.*` MCP tools) — one record per plugin: what it is, its parameters,
  recommended settings, and learned notes (verified parameter maps, settings that
  worked, gotchas — *with context*). Asked to use a plugin they don't know, the
  skills **research the web, inspect it live, and write its record first**, then
  use it. Teach one up front with `/learn-plugin`. Alongside them, **process
  lessons**: when a change is reverted or measures worse, the skill records a
  lesson. Lessons expire after 90 days unless they recur; one that
  recurs 3× is promoted into the mixer skill's hard rules, so recurring mistakes
  self-heal. Without LoreKit connected the skills still work — they just don't
  learn.

Recall or tidy memory anytime with `/mix-memory`. Full contract:
`knowledge/reference/memory-protocol.md`.

### What happens under the hood

Each skill:

- **Loads a mix-engineer system prompt** into your session when triggered
- **Uses pre-approved REAPER tools** — `reaper-mcp init` allow-lists all of them, so
  there are no permission prompts mid-mix
- **Loads knowledge on demand** — pulls frequency, LUFS, compression, and plugin
  data from the knowledge base (plus personal memory) only when a task needs it

The workflow is always:

1. **Recall memory** + **save a snapshot** (so you can always A/B or undo)
2. **Analyze** — read meters, spectrum, LUFS, correlation, crest factor
3. **Reason** — apply genre rules, frequency knowledge, and plugin expertise
4. **Act** — add FX, set parameters, adjust levels using the best available plugins
5. **Verify** — re-read meters to confirm the change had the intended effect
6. **Capture & report** — record durable learnings; explain what changed and why

### A/B Comparison

Every change is bracketed by snapshots:

1. The skill saves a "Before" snapshot automatically
2. Makes all changes
3. Saves an "After" snapshot
4. You can restore either with `snapshot_restore` to A/B compare, or switch them on the bridge status page's Snapshots tab

## Plugin knowledge

Plugin knowledge lives in LoreKit (scope `project::reaper-mcp`), one record per
plugin, and grows as the skills bootstrap plugins they meet. The maintainer's
store currently holds:

| Plugin                                               | Category                | Preference |
| ---------------------------------------------------- | ----------------------- | ---------- |
| ReaEQ, ReaComp, ReaDelay, ReaVerb, ReaGate, ReaLimit | Stock                   | 30-50      |
| FabFilter Pro-Q 3, Pro-C 2, Pro-L 2                  | Premium EQ/Comp/Limiter | 85-92      |
| Line 6 Helix Native                                  | Amp Sim                 | 82         |
| JS: 1175 Compressor                                  | Character Comp          | 50         |

The skills automatically discover your installed plugins and use the best available option for each task. If you have Pro-Q 3, they use that. If not, they fall back to ReaEQ.

### Adding Your Own Plugins

Use the `/learn-plugin` skill in Claude Code:

```
You: /learn-plugin
Claude: What plugin would you like me to learn about?
You: JST Gain Reduction Deluxe — it's a VCA compressor from Joey Sturgis Tones
Claude: [asks about parameters, presets, usage]
Claude: Saved JST Gain Reduction Deluxe to LoreKit as plugins::joey-sturgis-tones/gain-reduction-deluxe
```

Plugin records live in LoreKit (scope `project::reaper-mcp`); the record shape is in `knowledge/reference/memory-protocol.md`.

## Autonomous Mode (Allow All Tools)

By default Claude Code asks permission for each MCP tool call. `reaper-mcp init` (run by `scripts/install.sh`) configures `~/.claude/settings.json` to allow all REAPER tools. If you need to set this up manually, add to your project's `.claude/settings.json` (or `~/.claude/settings.json` for global):

```json
{
  "permissions": {
    "allow": ["mcp__reaper"]
  }
}
```

`mcp__reaper` allows every tool of the `reaper` server; to allow single tools, list them as `mcp__reaper__{tool_name}`. Once added, Claude Code runs them without prompting.

## CLI Commands

`scripts/install.sh` runs the full setup; these are the underlying commands. Without
`reaper-mcp` on your PATH, run them as `node dist/apps/reaper-mcp-server/main.js <command>`
from the clone (`npm run doctor` / `npm run setup` are shortcuts):

| Command | Description |
|---------|-------------|
| `reaper-mcp` / `reaper-mcp serve` | Start the MCP server in stdio mode (what Claude Code runs) |
| `reaper-mcp setup` | Install the Lua bridge, snapshot scripts, JSFX and status page into REAPER; enable the web interface |
| `reaper-mcp setup-sidecar` | Install the optional Python sidecar (perceptual analysis) |
| `reaper-mcp init` | Configure Claude Code — tool allow-list + `.mcp.json` (copy-free) |
| `reaper-mcp doctor` | Verify everything is configured correctly |
| `reaper-mcp status` | Check bridge connection |
| `scripts/sync-symlinks.sh` | Symlink the mix skills + knowledge into `~/.claude` |

## Claude Code Integration

`scripts/install.sh` registers the server for your user, so Claude Code has the
REAPER tools in every folder:

```bash
claude mcp add --scope user reaper -- node /path/to/reaper-mcp/dist/apps/reaper-mcp-server/main.js serve
```

`reaper-mcp init` also writes a `.mcp.json` in the clone. It runs the built
`main.js` by absolute path, so it does not need `reaper-mcp` on your PATH:

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

Claude Code reads a `.mcp.json` only in the folder it is opened in.

### Running from source (development)

For an edit-reload loop without rebuilding, run the server from the TypeScript
source with tsx and point `.mcp.json` at it:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "npx",
      "args": ["tsx", "/path/to/reaper-mcp/apps/reaper-mcp-server/src/main.ts", "serve"]
    }
  }
}
```

See [DEVELOPMENT.md](../DEVELOPMENT.md) for the full dev workflow.

## Environment Variables

| Variable               | Description                        | Default              |
| ---------------------- | ---------------------------------- | -------------------- |
| `REAPER_RESOURCE_PATH` | Override REAPER resource directory | Auto-detected per OS |
| `REAPER_WEB_PORT`      | Port `setup` gives REAPER's web interface (status window) | `8099` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for traces, metrics and logs | unset (no export) |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | Set to `otlp` to export that signal | `none` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the OTLP endpoint, e.g. `Authorization=Bearer <token>` | unset |
| `OTEL_SERVICE_NAME` | Service name on exported telemetry | `reaper-mcp-server` |

Platform defaults:

- **macOS**: `~/Library/Application Support/REAPER`
- **Windows**: `%APPDATA%/REAPER`
- **Linux**: `~/.config/REAPER`

### Telemetry

With the `OTEL_*` variables set, the server exports OpenTelemetry data:

- a span per tool call and per bridge command (the file-IPC round trip)
- metrics for command duration, handler time, pickup delay and timeouts
- structured logs (also written to stderr), including the bridge's own
  lifecycle events and handler errors, timestamped when the bridge recorded them

Put the variables in the `env` block of your `.mcp.json` entry. Keep the token
out of version control.

## Project Structure

```
reaper-mcp/
├── apps/
│   ├── reaper-mcp-server/        # MCP server (147 tools, esbuild bundle)
│   └── bridge-ui/                # Bridge status page (React → one self-contained HTML file)
├── libs/protocol/                # Shared TypeScript types
├── .claude/skills/               # Mix skills (/mixer, /critique, /mastering, /learn-plugin, /mix-memory)
├── knowledge/                    # AI mix engineer knowledge base (symlinked into ~/.claude/knowledge)
│   ├── genres/                   # Genre mixing conventions
│   ├── workflows/                # Step-by-step mixing workflows
│   └── reference/                # Frequency, compression, metering, memory-protocol, … cheat sheets
├── scripts/sync-symlinks.sh      # Symlink skills + knowledge into ~/.claude (primary install)
├── reaper/                       # Files installed into REAPER
│   ├── mcp_bridge.lua            # Persistent Lua bridge
│   ├── mcp_*_lib.lua             # Lua libraries the bridge loads (plan, actions, tracks, project, items, envelopes, snapshots, edit views)
│   ├── mcp_snapshot_*.lua        # Snapshot action scripts (next/prev/quick-save + shared lib)
│   ├── mcp_analyzer.jsfx         # FFT spectrum analyzer
│   ├── mcp_lufs_meter.jsfx       # LUFS meter (BS.1770)
│   ├── mcp_correlation_meter.jsfx # Stereo correlation meter
│   ├── mcp_crest_factor.jsfx     # Crest factor meter
│   └── mcp_midi_emitter.jsfx     # Live MIDI output
├── docs/TESTING.md               # End-to-end testing guide
└── nx.json                       # Nx workspace config
```

## Updating the Lua Bridge

The MCP server (TypeScript) and the Lua bridge (REAPER) are two separate components. After updating to a new version — or after adding new tools during development — you need to reinstall the bridge files and reload the script in REAPER:

```bash
# Reinstall bridge files into REAPER
reaper-mcp setup
```

Then in REAPER:

1. **Stop** the running bridge: Actions > Running Scripts > stop `mcp_bridge.lua`
2. **Reload** the updated script: Actions > Load ReaScript > select `mcp_bridge.lua` > Run

If existing tools (like `get_project_info`) work but new tools fail or timeout, this is almost always because the Lua bridge needs to be updated and reloaded.

## Development

```bash
pnpm install
pnpm nx run-many --target=build      # Build all
pnpm nx run-many --target=lint       # Lint all
pnpm nx run-many --target=test       # Test all (470+ tests)
pnpm nx run-many --target=build,lint,test  # Everything
```

See [DEVELOPMENT.md](../DEVELOPMENT.md) for the full dev workflow including running from source, MCP Inspector, and bridge update details.

