#!/usr/bin/env bash
# One-command setup for a reaper-mcp clone. Run from anywhere inside your clone:
#
#   ./scripts/install.sh
#
# Steps: install deps → build → link the `reaper-mcp` CLI → install the REAPER
# bridge → symlink the mix skills + knowledge into ~/.claude → configure Claude
# Code (tool allow-list + .mcp.json). The only manual step left is loading
# mcp_bridge.lua in REAPER (a GUI action).
#
# Idempotent: safe to re-run after pulling updates.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
CLI="node $REPO_ROOT/dist/apps/reaper-mcp-server/main.js"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

step "Installing dependencies (pnpm install)"
pnpm install

step "Building the MCP server"
pnpm nx build reaper-mcp-server

step "Linking the reaper-mcp CLI to this clone"
( cd dist/apps/reaper-mcp-server && pnpm link --global )

step "Installing the REAPER bridge (Lua + JSFX)"
$CLI setup

step "Symlinking the mix skills + knowledge into ~/.claude"
"$REPO_ROOT/scripts/sync-symlinks.sh"

step "Configuring Claude Code (tool allow-list + .mcp.json)"
$CLI init

cat <<'EOF'

Setup complete. One manual step left — load the bridge in REAPER:
  Actions > Show action list > Load ReaScript > select mcp_bridge.lua > Run
  (you should see "MCP Bridge: Started" in REAPER's console)

If `reaper-mcp` isn't found in new shells, add pnpm's global bin to your PATH
(it's where `pnpm link --global` installs): https://pnpm.io/installation#using-a-shorter-alias

Then open Claude Code and mix:
  /mixer "Please gain stage my tracks"   ·   /critique "Roast my mix"
EOF
