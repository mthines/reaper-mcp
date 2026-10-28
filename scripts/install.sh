#!/usr/bin/env bash
# One-command setup for a reaper-mcp clone. Run from anywhere inside your clone:
#
#   ./scripts/install.sh
#
# Needs only Node.js 20+ (and Claude Code). pnpm is used if installed; otherwise
# the copy that ships with Node (corepack) or a one-off `npx pnpm` — nothing to
# install globally.
#
# Steps: install deps → build → install the REAPER bridge → symlink the mix
# skills + knowledge into ~/.claude → configure Claude Code (tool allow-list,
# user-scope MCP server, .mcp.json) → link the `reaper-mcp` CLI (best effort).
# The only manual step left is loading mcp_bridge.lua in REAPER (a GUI action).
#
# Idempotent: safe to re-run after pulling updates. Prints one line per step;
# the full output goes to tmp/install.log (or stream it with --verbose).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
MAIN_JS="$REPO_ROOT/dist/apps/reaper-mcp-server/main.js"
CLI=("node" "$MAIN_JS")
VERBOSE=""; [ "${1:-}" = "--verbose" ] && VERBOSE=1
mkdir -p tmp
LOG="$REPO_ROOT/tmp/install.log"
: > "$LOG"

note() { printf '    %s\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# run "<label>" cmd...: one ✓/✗ line; output to the log (streamed with --verbose).
run() {
  local label="$1"; shift
  printf '\n==> %s\n' "$label" >> "$LOG"
  if [ -n "$VERBOSE" ]; then
    printf '\033[1m==> %s\033[0m\n' "$label"
    "$@" 2>&1 | tee -a "$LOG" || fail "$label failed. Full log: $LOG"
  else
    printf '  …  %s' "$label"
    if "$@" >> "$LOG" 2>&1; then
      printf '\r  \033[32m✓\033[0m  %s\n' "$label"
    else
      printf '\r  \033[31m✗\033[0m  %s\n\n' "$label"
      tail -n 25 "$LOG" >&2
      fail "$label failed. Full log: $LOG  (re-run with --verbose to watch it)"
    fi
  fi
}

printf '\n\033[1m🎚️  reaper-mcp installer\033[0m\n\n'

# --- Prerequisites -----------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get version 20 or newer from https://nodejs.org and run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $(node -v) is too old. Install version 20 or newer from https://nodejs.org and run this again."

# pnpm: installed → corepack (bundled with Node 20–24) → one-off npx download.
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1 &&
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --version >> "$LOG" 2>&1; then
  # Only when corepack can actually run pnpm (it can fail offline or on a broken install).
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  PNPM=(corepack pnpm)
else
  PNPM=(npx --yes "pnpm@$PNPM_VERSION")
fi

# --- Build -------------------------------------------------------------------
run "Downloading dependencies (takes a minute the first time)" "${PNPM[@]}" install
run "Building the server" "${PNPM[@]}" nx build reaper-mcp-server

# --- REAPER + Claude Code ----------------------------------------------------
run "Installing the bridge into REAPER" "${CLI[@]}" setup
# setup can't finish one part while REAPER is open (or before its first launch); say so.
grep -q 'Skipped: REAPER is running' "$LOG" && note "REAPER was open, so the status window isn't switched on yet. Quit REAPER and run this again to add it."
grep -q 'reaper.ini not found' "$LOG" && note "Start REAPER once, quit it, then run this again to switch on the status window."
run "Adding the mix skills to Claude Code" "$REPO_ROOT/scripts/sync-symlinks.sh"
# Telemetry notice + Keep on? [Y/n], straight to the terminal: run() would hide the prompt in the log.
"${CLI[@]}" telemetry setup
run "Pre-approving the REAPER tools in Claude Code" "${CLI[@]}" init

if command -v claude >/dev/null 2>&1; then
  if out="$(claude mcp add --scope user reaper -- node "$MAIN_JS" serve 2>&1)"; then
    printf '  \033[32m✓\033[0m  Connecting Claude Code to REAPER (works from any folder)\n'
  elif grep -qi "already exists" <<<"$out"; then
    printf '  \033[32m✓\033[0m  Claude Code already knows REAPER\n'
    # Capture first: with pipefail, grep -q closing the pipe early can fail the check.
    current="$(claude mcp get reaper 2>/dev/null || true)"
    grep -qF "$MAIN_JS" <<<"$current" ||
      note "It points at another copy. To use this one: claude mcp remove --scope user reaper && ./scripts/install.sh"
  else
    printf '  \033[33m!\033[0m  Could not connect Claude Code to REAPER: %s\n' "$out"
    note "Opening Claude Code inside this folder still works."
  fi
else
  printf '  \033[33m!\033[0m  Claude Code is not installed yet\n'
  note "Get it from https://claude.com/claude-code, then run this again."
fi

# Optional: a `reaper-mcp` command on PATH (doctor/status). Nothing depends on it.
( cd dist/apps/reaper-mcp-server && "${PNPM[@]}" link --global ) >> "$LOG" 2>&1 || true

BRIDGE="$(sed -n 's/^ *3\. Select: //p' "$LOG" | tail -n 1)"
TILDE="~"; BRIDGE="${BRIDGE/#"$HOME"/$TILDE}"
cat <<EOF

✅ Done! One step left: in REAPER, open
   Actions → Show action list → Load ReaScript…
   pick mcp_bridge.lua and click Run.
   ${BRIDGE:+($BRIDGE)}

Then open Claude Code in any folder and mix:
   /mixer Please gain stage my tracks

Something off? Run  npm run doctor  in this folder.
EOF
