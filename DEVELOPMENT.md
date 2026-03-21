# Development

## Prerequisites

- Node.js >= 20
- pnpm (`corepack enable && corepack prepare`)
- REAPER with the Lua bridge running (see `reaper-mcp setup`)

## Running the dev server

```bash
pnpm dev
```

This runs `tsx --watch` on the TypeScript source directly — no build step needed. The server auto-restarts when you save any file it depends on.

You can also run it via Nx directly:

```bash
pnpm nx dev reaper-mcp-server
```

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

- **Bridge commands** (`sendCommand`): each call produces a CLIENT span named `mcp.bridge {commandType}` capturing the full file-IPC round-trip.
- **Metrics**:
  - `mcp.bridge.command.duration` (histogram, ms) — round-trip duration per command type
  - `mcp.bridge.command.count` (counter) — calls by command type and success/failure
  - `mcp.bridge.timeout.count` (counter) — commands that timed out waiting for REAPER
- **Auto-instrumentation**: Node.js built-in modules (http, fs, dns, etc.) via `@opentelemetry/auto-instrumentations-node`.

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

1. Copy `.env.otel` in the repo root and fill in your endpoint and auth token:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingress.us1.dash0.com
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <YOUR_AUTH_TOKEN>
```

2. Run with the env file:

```bash
pnpm build
node --env-file=.env.otel dist/apps/reaper-mcp-server/main.js serve
```

> **Note:** `.env.otel` is listed in `.gitignore` — do not commit it with real credentials.

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
