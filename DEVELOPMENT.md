# Development

## Prerequisites

- Node.js >= 20
- pnpm (`corepack enable && corepack prepare`) — needed for development. End users
  don't install it: `scripts/install.sh` falls back to `corepack pnpm` or `npx pnpm`.
- REAPER with the Lua bridge running (see `reaper-mcp setup`)

## First-time setup

From a fresh clone, run the one-command installer (deps, build, link the
`reaper-mcp` CLI, install the bridge, symlink skills + knowledge, configure
Claude Code):

```bash
./scripts/install.sh
```

It's idempotent — re-run it after pulling. The rest of this doc covers the
edit-reload dev loop and the moving parts the installer wires up.

## Running the dev server

```bash
pnpm dev
```

This runs `tsx --watch` on the TypeScript source directly — no build step needed. The server auto-restarts when you save any file it depends on.

You can also run it via Nx directly:

```bash
pnpm nx dev reaper-mcp-server
```

## Using the `reaper-mcp` CLI from your local checkout

`scripts/install.sh` tries to link the CLI for you (`pnpm link --global` from
`dist/apps/reaper-mcp-server`, best effort — it needs pnpm's global bin dir set up).
To (re)link manually:

```bash
pnpm nx build reaper-mcp-server
cd dist/apps/reaper-mcp-server && pnpm link --global && cd -
reaper-mcp status
```

The link points at `dist/apps/reaper-mcp-server`, so any later
`pnpm nx build reaper-mcp-server` overwrites `main.js` in place and the
`reaper-mcp` command picks up your changes automatically — you only link once.

> The CLI is a bundled build, so changes to the one-shot commands (`setup`,
> `init`, `doctor`, `status`) require a rebuild. For the long-running MCP
> **server**, prefer `pnpm dev` (tsx watch) below, which needs no rebuild.
>
> Skills, agents + knowledge are symlinked (not built) via `scripts/sync-symlinks.sh`,
> so edits to `.claude/skills/`, `.claude/agents/` or `knowledge/` are live immediately.
>
> To unlink later: `cd dist/apps/reaper-mcp-server && pnpm unlink --global`.

## Pointing Claude Code to your local dev server

By default, `.mcp.json` points to the built output in `dist/`. During development, you want to run from source instead.

Update your `.mcp.json` (or `~/.claude.json` for global config) to use `npx tsx`:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/apps/reaper-mcp-server/src/main.ts",
        "serve"
      ]
    }
  }
}
```

Replace `/absolute/path/to` with the actual path to your repo checkout. For example:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "npx",
      "args": [
        "tsx",
        "/Users/you/code/reaper-mcp/apps/reaper-mcp-server/src/main.ts",
        "serve"
      ]
    }
  }
}
```

> **Note:** Using `npx tsx` ensures tsx is resolved from local devDependencies without requiring a global install. If you prefer, you can install tsx globally (`npm i -g tsx`) and use `"command": "tsx"` directly instead.

After changing `.mcp.json`, restart Claude Code (or the MCP client) to pick up the new config. Each restart of the MCP server (including watch-triggered restarts) will require the MCP client to reconnect — this is inherent to the stdio transport.

## Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) lets you test tools interactively without Claude Code:

```bash
npx @modelcontextprotocol/inspector npx tsx apps/reaper-mcp-server/src/main.ts serve
```

This opens a web UI where you can invoke any registered tool and see the JSON responses.

## Building for production

```bash
pnpm build                          # Build the server (esbuild bundle)
pnpm nx run-many --target=build     # Build everything
```

The production build uses esbuild to bundle everything into `dist/apps/reaper-mcp-server/main.js`.

## Running tests

```bash
pnpm test                           # All tests
pnpm nx test reaper-mcp-server      # Server tests only
pnpm nx test protocol               # Protocol library tests only
```

### Install flow test (records the README GIF)

```bash
pnpm test:install    # needs vhs (brew install vhs) and Claude Code
```

`scripts/test-install.sh` snapshots the working tree (uncommitted changes
included) and runs the README install command in a sandbox: an empty `HOME`, a
macOS-style REAPER folder, and no pnpm on PATH. `scripts/install-demo.tape`
types the command for real (git redirects the GitHub URL to the snapshot) and
fails unless the installer prints `Done!`. The script then checks that Claude
Code, opened in an unrelated folder, sees the `reaper` server, and that `doctor`
reports it registered. It rewrites `docs/assets/install-demo.gif`, so re-run it
whenever the installer's output changes. It does not cover loading the bridge in
REAPER.

### Stress / performance tests (requires REAPER)

The bridge stress tests exercise the full round-trip through the live Lua bridge — file write, Lua defer loop pickup, ReaScript execution, response write, and client poll. They measure latency, throughput, concurrency, and degradation under sustained load.

**Prerequisites:** REAPER must be running with `mcp_bridge.lua` active. The tests auto-skip when the bridge is not detected.

```bash
# Run stress tests (also runs as part of pnpm test when REAPER is available)
pnpm test:stress

# Run profiling tests (phase-level latency breakdown per command)
pnpm test:profile
```

The stress test suite covers:

| Test | What it measures | Threshold |
|------|-----------------|-----------|
| **Baseline** | Single command round-trip latency | < 150ms |
| **Sequential 50** | Rapid-fire sequential throughput | p95 < 100ms |
| **Concurrent 20/50** | Parallel command handling under burst load | < 500ms / < 2s |
| **Mixed commands** | Latency consistency across different command types | p95 < 100ms |
| **Sustained 100** | Degradation detection over 100 sequential commands | p95 < 100ms, no degradation |
| **Large payload** | `list_tracks` response size handling | < 200ms |
| **Interleaved** | File contention with concurrent mixed command types | < 500ms |
| **Cleanup** | No orphaned command/response files after the run | 0 files |

The profiling test (`test:profile`) breaks down each command into phases (span setup, dir ensure, file write, poll wait, read/parse, cleanup, metrics) to identify bottlenecks. Output includes per-phase averages and a raw file I/O baseline.

## Linting

```bash
pnpm lint                           # Lint everything
pnpm nx lint reaper-mcp-server      # Lint server only
```

## Installing bridge files into REAPER

After making changes to files in `reaper/` (Lua bridge, JSFX analyzers), reinstall them:

```bash
pnpm build && node dist/apps/reaper-mcp-server/main.js setup
```

Or if running from source with tsx:

```bash
npx tsx apps/reaper-mcp-server/src/main.ts setup
```

Then reload the Lua bridge in REAPER:

1. **Stop** the running bridge script: Actions > Running Scripts > stop `mcp_bridge.lua`
2. **Reload** the updated script: Actions > Load ReaScript > select `mcp_bridge.lua` > Run

### When is a bridge update needed?

The MCP server (TypeScript) and the Lua bridge (REAPER) are **two separate components**. When you add new MCP tools:

- **TypeScript changes** (new tool definitions in `apps/reaper-mcp-server/src/tools/`) are picked up automatically if running from source with tsx, or after rebuilding with `pnpm build`.
- **Lua bridge changes** (new handlers in `reaper/mcp_bridge.lua`) require reinstalling and reloading the bridge in REAPER using the steps above.

If the MCP server exposes a tool but the Lua bridge doesn't have a matching handler, commands will timeout. The MCP server connection itself will still work (e.g., `get_project_info` may succeed) but the new tools will fail. This is the most common cause of "tools not working after an update."
Then reload `mcp_bridge.lua` in REAPER (Actions > Run ReaScript).

## OpenTelemetry / Observability

The server ships with [OpenTelemetry](https://opentelemetry.io/) instrumentation that sends traces, metrics, and logs to any OTLP-compatible backend (Dash0, Honeycomb, Grafana, etc.).

### What is instrumented

Names follow the OTel semantic conventions; project-specific names live under `reaper.*` (the `mcp.*`
namespace belongs to the official MCP conventions). Durations are in seconds.

**Traces** — one trace per tool call:

| Span | Kind | Key attributes |
|------|------|----------------|
| `tools/call {tool}` | SERVER | `mcp.method.name`, `gen_ai.tool.name`, `gen_ai.operation.name=execute_tool`, `jsonrpc.request.id`, `error.type` (`tool_error` when the result has `isError`) |
| `reaper.Bridge/{command}` | CLIENT | `rpc.system=reaper_bridge`, `rpc.method`, `peer.service=reaper`, `reaper.bridge.command.id`, `reaper.bridge.handler_ms` / `pickup_ms`, `error.type` |
| `sidecar/analyze` | CLIENT | `rpc.system=jsonrpc`, `rpc.method`, `error.type` |
| `reaper-mcp startup`, `poll bridge diagnostics` | INTERNAL | root spans for headless work |

**Metrics** — error rate is each histogram's count filtered on `error.type`:

| Metric | Unit | Attributes |
|--------|------|------------|
| `mcp.server.operation.duration` | s | `mcp.method.name`, `gen_ai.tool.name`, `error.type` |
| `reaper.bridge.command.duration` | s | `rpc.method`, `error.type` (`timeout`, `handler_crash`, `unknown_command`, `command_failed`) |
| `reaper.bridge.handler.duration` | s | `rpc.method`, `error.type` — time inside the Lua handler |
| `reaper.bridge.pickup.duration` | s | — time until the defer loop picked the command up |
| `reaper.sidecar.request.duration` | s | `rpc.method`, `error.type` |
| `reaper.bridge.up` | 1 | gauge: 1 while REAPER's heartbeat is fresh, 0 when the bridge is down |
| `reaper.bridge.defer.interval`, `reaper.bridge.scan.duration` | s | `reaper.statistic` (p50/p95, avg/max) |

**Logs** — trace-correlated OTLP log records (also mirrored as JSON lines on stderr), with event names:

| Event | Severity | When |
|-------|----------|------|
| `reaper.bridge.bridge_start` / `bridge_stop` | INFO / WARN | Lua bridge lifecycle, read from `bridge_events.jsonl` with Lua's own timestamp |
| `reaper.bridge.handler_error` / `handler_unknown` | ERROR | Lua handler crashed / unknown command |
| `reaper.bridge.command.failed` | WARN or ERROR | handler returned an error (WARN) or crashed (ERROR) |
| `reaper.bridge.command.timeout` | ERROR | no response from REAPER |
| `reaper.sidecar.timeout` / `exit` / `spawn_error` / `restart` | ERROR/WARN | Python sidecar lifecycle |
| `reaper.server.crash` | ERROR | uncaught exception / unhandled rejection (`exception.*` attributes) |

`reaper.bridge.*` lifecycle events (`bridge_start`, `bridge_stop`, `handler_*`) come from the one shared bridge, so
whichever server instance drains `bridge_events.jsonl` first reports each event exactly once — under its own
resource (`service.instance.id`, `deployment.environment.name`). Count them per host, not per server instance.

### Regression signals worth alerting on

- `reaper.bridge.up == 0` for 2 min — REAPER closed or the bridge script stopped.
- Rate of `reaper.bridge.command.duration{error.type="timeout"}` > 0 — commands not reaching REAPER.
- p95 of `reaper.bridge.command.duration` > 0.5 s — the defer loop is starved (heavy project, blocking render).
- `mcp.server.operation.duration{error.type!=""}` / total > 5 % per `gen_ai.tool.name` — a tool regressed.
- Any `reaper.bridge.handler_error` or `reaper.server.crash` log — a bug, not a user error.

These are ready to apply as check rules in [`observability/check-rules.yaml`](observability/check-rules.yaml).

Every resource carries `enduser.pseudo.id`, a random id created once in `~/.reaper-mcp/install-id`. It tells
users (installs) apart without identifying anyone; delete the file to get a new one.

### Routing through an OpenTelemetry Collector (optional)

Exporting straight to Dash0 needs no Collector: the server already redacts at the source — the home directory
(which contains your OS username) becomes `~` in log bodies, log attributes, and span status messages, and the
resource carries only `process.pid` / `process.runtime.*` instead of the SDK's path-bearing `process.*`
attributes. If you route through a Collector anyway, this transform is defence in depth for other paths
(`/Users/<name>`, `/home/<name>`, `C:\\Users\\<name>`) and for other SDKs' `process.command_args`.
Validated with `otelcol-contrib validate` (v0.120.0) and against live server output.

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  # Mask home directories (they carry the OS username) in free-text error
  # messages and log bodies emitted by reaper-mcp-server.
  transform/redact-home-paths:
    error_mode: ignore
    metric_statements:
      - delete_key(resource.attributes, "process.command_args")
      - replace_pattern(resource.attributes["process.executable.path"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where resource.attributes["process.executable.path"] != nil
      - replace_pattern(resource.attributes["process.command"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where resource.attributes["process.command"] != nil
    trace_statements:
      - delete_key(resource.attributes, "process.command_args")
      - replace_pattern(resource.attributes["process.executable.path"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where resource.attributes["process.executable.path"] != nil
      - replace_pattern(resource.attributes["process.command"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where resource.attributes["process.command"] != nil
      - replace_pattern(span.status.message, "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where span.status.message != nil
    log_statements:
      - delete_key(resource.attributes, "process.command_args")
      - replace_pattern(resource.attributes["process.executable.path"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where resource.attributes["process.executable.path"] != nil
      - replace_pattern(resource.attributes["process.command"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where resource.attributes["process.command"] != nil
      - replace_pattern(log.body.string, "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where log.body.string != nil
      - replace_pattern(log.attributes["exception.message"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where log.attributes["exception.message"] != nil
      - replace_pattern(log.attributes["exception.stacktrace"], "(/Users|/home|C:\\\\Users)/[^/\\\\\\s]+", "$$1/<user>") where log.attributes["exception.stacktrace"] != nil
  batch: {}

exporters:
  otlphttp/dash0:
    endpoint: https://ingress.eu1.dash0.com   # your Dash0 region
    headers:
      Authorization: Bearer ${env:DASH0_AUTH_TOKEN}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [transform/redact-home-paths, batch]
      exporters: [otlphttp/dash0]
    metrics:
      receivers: [otlp]
      processors: [transform/redact-home-paths, batch]
      exporters: [otlphttp/dash0]
    logs:
      receivers: [otlp]
      processors: [transform/redact-home-paths, batch]
      exporters: [otlphttp/dash0]
```

### Quick start — console output (no credentials needed)

```bash
pnpm build
node --import @opentelemetry/auto-instrumentations-node/register \
  dist/apps/reaper-mcp-server/main.js serve
```

Or via the convenience script in `package.json`:

```bash
# From repo root after building:
node dist/apps/reaper-mcp-server/main.js serve  # plain (no OTel export)

# With console exporter (prints traces/metrics to stderr):
OTEL_SERVICE_NAME=reaper-mcp-server \
OTEL_TRACES_EXPORTER=console \
OTEL_METRICS_EXPORTER=console \
  node --import @opentelemetry/auto-instrumentations-node/register \
  dist/apps/reaper-mcp-server/main.js serve
```

### Sending to Dash0 (or another OTLP backend)

Add the `OTEL_*` environment variables to your `.mcp.json` `env` block. Get your auth token at [Settings > Auth Tokens](https://app.dash0.com/settings/auth-tokens) (Ingesting permission):

```json
{
  "mcpServers": {
    "reaper": {
      "command": "node",
      "args": ["dist/apps/reaper-mcp-server/main.js", "serve"],
      "env": {
        "OTEL_SERVICE_NAME": "reaper-mcp-server",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "https://ingress.eu1.dash0.com",
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
        "OTEL_TRACES_EXPORTER": "otlp",
        "OTEL_METRICS_EXPORTER": "otlp",
        "OTEL_LOGS_EXPORTER": "otlp",
        "OTEL_RESOURCE_ATTRIBUTES": "service.namespace=reaper-mcp,deployment.environment.name=development",
        "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <AUTH_TOKEN>"
      }
    }
  }
}
```

This works from any MCP client (Claude Code, Claude Desktop, Cursor, etc.) — the `env` block is passed to the spawned server process.

### Configuration reference

All OTel configuration is via environment variables — no code changes needed to switch exporters or backends.

| Variable                      | Default             | Description                         |
| ----------------------------- | ------------------- | ----------------------------------- |
| `OTEL_SERVICE_NAME`           | `reaper-mcp-server` | Service name shown in your backend  |
| `OTEL_TRACES_EXPORTER`        | `none`              | `otlp`, `console`, or `none`        |
| `OTEL_METRICS_EXPORTER`       | `none`              | `otlp`, `console`, or `none`        |
| `OTEL_LOGS_EXPORTER`          | `none`              | `otlp`, `console`, or `none`        |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —                   | Your OTLP collector/backend URL     |
| `OTEL_EXPORTER_OTLP_HEADERS`  | —                   | `Authorization=Bearer <token>`      |
| `OTEL_RESOURCE_ATTRIBUTES`    | —                   | Extra resource attributes (k=v,k=v) |
| `DEPLOYMENT_ENVIRONMENT`      | `development`       | Sets `deployment.environment.name`  |
