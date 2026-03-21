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

Update your `.mcp.json` (or `~/.claude.json` for global config) to use `tsx`:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "tsx",
      "args": ["/absolute/path/to/apps/reaper-mcp-server/src/main.ts", "serve"]
    }
  }
}
```

Replace `/absolute/path/to` with the actual path to your repo checkout. For example:

```json
{
  "mcpServers": {
    "reaper": {
      "command": "tsx",
      "args": ["/Users/you/code/reaper-mcp/apps/reaper-mcp-server/src/main.ts", "serve"]
    }
  }
}
```

> **Note:** `tsx` must be in your PATH. If installed only as a devDependency, use `npx tsx` as the command instead, or install it globally with `npm i -g tsx`.

After changing `.mcp.json`, restart Claude Code (or the MCP client) to pick up the new config. Each restart of the MCP server (including watch-triggered restarts) will require the MCP client to reconnect — this is inherent to the stdio transport.

## Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) lets you test tools interactively without Claude Code:

```bash
npx @modelcontextprotocol/inspector tsx apps/reaper-mcp-server/src/main.ts serve
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

Then reload `mcp_bridge.lua` in REAPER (Actions > Run ReaScript).
