# Reaper MCP Server

Main MCP server application — receives tool calls via stdio, dispatches commands to REAPER via file-based IPC.

## Commands

```bash
pnpm nx build reaper-mcp-server     # Build ESM bundle with esbuild
pnpm nx test reaper-mcp-server      # Run tests (vitest)
pnpm nx lint reaper-mcp-server      # Lint
pnpm nx typecheck reaper-mcp-server
```

## Architecture

- **`main.ts`** — CLI entry point: `serve` | `setup` | `status`
- **`server.ts`** — Creates `McpServer`, registers all tool modules
- **`bridge.ts`** — File-based IPC: writes `command_{uuid}.json`, polls for `response_{uuid}.json`
- **`cli.ts`** — Setup logic, `MCP_TOOL_NAMES` array, `ensureClaudeSettings()`
- **`telemetry.ts`** — OpenTelemetry initialization (must be imported before other modules)
- **`tools/`** — One file per tool domain, each exports a `register*Tools(server)` function

## Adding a New Tool

1. Add command type + params to `libs/protocol/src/commands.ts`
2. Add response interface to `libs/protocol/src/responses.ts` (if needed)
3. Create/extend a file in `tools/`, register with `server.tool()`
4. Add tool name to `MCP_TOOL_NAMES` in `cli.ts`
5. Add Lua handler in `reaper/mcp_bridge.lua`

## Key Patterns

- **IMPORTANT**: Use `z.coerce.number()` not `z.number()` for numeric params — MCP clients may send strings
- Use `zod/v4` (not `zod`) for schema validation
- All tools follow the same pattern: validate params → `sendCommand()` → format response or error
- `MCP_TOOL_NAMES` in `cli.ts` drives auto-allow in `.claude/settings.json` via `ensureClaudeSettings()`
- Tests mock `sendCommand()` to verify tool registration, param passing, and error handling

## Gotchas

- OTel must be imported before other modules to enable auto-instrumentation monkey-patching
- The server logs to stderr only (stdout is reserved for MCP stdio transport)
- Build output is a single ESM bundle — `reaper/` and `knowledge/` are copied as build assets
- Bridge round-trip latency is ~50-150ms; tools should not retry on timeout without backoff
