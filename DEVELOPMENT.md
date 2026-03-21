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
      "args": ["tsx", "/absolute/path/to/apps/reaper-mcp-server/src/main.ts", "serve"]
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
      "args": ["tsx", "/Users/you/code/reaper-mcp/apps/reaper-mcp-server/src/main.ts", "serve"]
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
