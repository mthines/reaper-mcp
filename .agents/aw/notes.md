# reaper-mcp — notes for the verification suite

## What "running" means
- Three parts: the MCP server (stdio, `dist/apps/reaper-mcp-server/main.js serve`), the Lua bridge inside REAPER
  (file IPC in `~/Library/Application Support/REAPER/Scripts/mcp_bridge_data/`), and the bridge page.
- The page: `pnpm dev:bridge` → http://localhost:8098/mcp_bridge.html (live, needs REAPER) or `…?demo` (fake bridge).
  Never load REAPER's own :8099 page or curl it: every hang-up leaks a REAPER web socket (~100 kills the web server).
- Drive tools through a small Node MCP client (`@modelcontextprotocol/sdk` Client + StdioClientTransport) spawned
  against the checkout's built `main.js`. Stop it by its PID. Never `pkill -f "main.js serve"`: it kills the
  session's own reaper MCP server.

## Live REAPER (allowed by the maintainer)
- Installing a PR build into the real REAPER resource folder is allowed:
  `pnpm nx build reaper-mcp-server --skip-nx-cache && node dist/apps/reaper-mcp-server/main.js setup`.
  When the run ends, reinstall from the main checkout the same way and restart the bridge.
- Start/restart the bridge: `open -a REAPER "$HOME/Library/Application Support/REAPER/Scripts/mcp_bridge.lua"`;
  ready when `mcp_bridge_data/heartbeat.json` mtime is < 5 s old. Editing Lua needs rebuild → setup → re-run script.
- Use a scratch project (new project tab); never edit or save the user's open project. A modal dialog in REAPER
  freezes the bridge.
- Optional sidecar parts a PR adds may be installed (`node dist/apps/reaper-mcp-server/main.js setup-sidecar --with-…`).

## Tests and commits
- `pnpm nx run-many -t typecheck,lint,test,build`; sidecar: `~/.reaper-mcp/sidecar-venv/bin/python -m pytest apps/reaper-mcp-server/sidecar/tests`.
- Bridge page in a real browser: `pnpm nx build bridge-ui && node apps/bridge-ui/e2e/drawer-widths.mjs`.
- Close any test REAPER before the full vitest run: live-bridge suites auto-enable and flake under load.
- Commits: short imperative subject, area prefix (`bridge-ui: …`, `fix(…): …`). Stage only your hunks; other sessions
  edit these worktrees concurrently.

## Telemetry
- Dash0 **dev**, dataset `reaper-mcp`. Use `sql` (not `getLogRecords` filters) for logs; bridge page events only via
  `getWebEvents` (service `reaper-mcp-bridge-ui`, `event.name` starts with `bridge_ui.`). `?demo` sends no telemetry.
