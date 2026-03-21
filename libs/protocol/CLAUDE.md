# Protocol Library

Shared TypeScript types for commands and responses between `reaper-mcp-server` and `reaper-mix-agent`.

## Commands

```bash
pnpm nx build protocol      # Build with tsc
pnpm nx test protocol       # Run tests
pnpm nx lint protocol       # Lint
```

## Structure

- **`commands.ts`** — `CommandType` union, per-command param interfaces, `BridgeCommand` type
- **`responses.ts`** — `BridgeResponse`, data interfaces for each response type
- **`index.ts`** — Re-exports everything from commands + responses

## Adding a New Command Type

1. Add the string literal to the `CommandType` union in `commands.ts`
2. Add a params interface (use `Record<string, never>` for commands with no params)
3. Add the mapping entry in `CommandParamsMap`
4. Add response data interface in `responses.ts` if the command returns structured data

## Conventions

- Command type strings use `snake_case` and must exactly match the Lua handler key in `mcp_bridge.lua`
- Param field names must match the JSON keys the Lua bridge expects
- Document units in comments (e.g., `/** Volume in dB */`)
- Batch operations accept a `notesJson` or similar string field containing a JSON array

## Sync Points

This library is the contract between 5 locations that must stay in sync:
1. `commands.ts` — command types and param interfaces
2. `responses.ts` — response data interfaces
3. `reaper/mcp_bridge.lua` — Lua handler functions
4. `apps/reaper-mcp-server/src/tools/*.ts` — tool registration and param schemas
5. `apps/reaper-mcp-server/src/cli.ts` — `MCP_TOOL_NAMES` array

## Consumers

- `@mthines/reaper-mcp-server` — imports types for tool registration and bridge communication
- `@mthines/reaper-mix-agent` — imports types for knowledge loading context
- Path alias: `@reaper-mcp/protocol` → `libs/protocol/src/index.ts`
