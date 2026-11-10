#!/usr/bin/env bash
# End-to-end test of the `reaper-mcp` CLI (init, setup, telemetry), one recorded GIF per command.
#
#   scripts/test-harnesses.sh      # needs vhs (brew install vhs) and the claude, codex and gemini commands
#
# Builds the server from this working tree, copies the built package into a sandbox OUTSIDE any clone (so it runs
# the way an npm install does), and gives it an empty HOME with Claude Code, Codex CLI and Gemini CLI on PATH and a
# Cursor config folder. scripts/harnesses-demo.tape then types `reaper-mcp init` for real and fails unless every
# step prints what the README says. Afterwards this script asks each harness's own command what it sees, and checks
# the skills landed where each harness reads them.
# Writes docs/assets/{harnesses,setup,telemetry}-demo.gif. Touches nothing outside the sandbox. Telemetry is off.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for bin in vhs node pnpm claude codex gemini; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
done

echo "==> Building the server"
( cd "$REPO_ROOT" && NX_NO_CLOUD=true pnpm nx build reaper-mcp-server --skip-nx-cache >/dev/null )

# Physical path, no `//`: the installer shortens "$HOME/…" to "~/…" by string match.
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/reaper-mcp-harness-test.XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT
export DEMO_HOME="$SANDBOX/home"
export DEMO_PKG="$SANDBOX/npm/reaper-mcp"
export DEMO_PATH="$SANDBOX/bin:/usr/bin:/bin"
export DEMO_REAPER="$DEMO_HOME/REAPER"
export DEMO_NONET="$SANDBOX/no-network.cjs"
mkdir -p "$DEMO_HOME/Music" "$DEMO_HOME/.cursor" "$DEMO_REAPER" "$SANDBOX/bin" "$DEMO_PKG/bridge-ui"
printf '[REAPER]\n' > "$DEMO_REAPER/reaper.ini"
cp -R "$REPO_ROOT/dist/apps/reaper-mcp-server/." "$DEMO_PKG/"
# What `npm install -g` would fetch next to the package (the bundle keeps its dependencies external)
ln -s "$REPO_ROOT/apps/reaper-mcp-server/node_modules" "$DEMO_PKG/node_modules"
# The status page ships in the npm package but is built by Vite, not by this build: a stand-in is enough for setup to install it
printf '<!doctype html>\n' > "$DEMO_PKG/bridge-ui/mcp_bridge.html"; echo "{}" > "$DEMO_PKG/bridge-ui/mcp_bridge.webmanifest"

# The telemetry demo runs with telemetry ON to show the opt-out flow: nothing may leave the sandbox, so every https request fails here
printf 'const https = require("node:https");\nhttps.request = () => { throw new Error("no network in the demo"); };\n' > "$DEMO_NONET"
# A pgrep that finds nothing: the REAPER running on this machine must not make setup wait for it to quit.
printf '#!/bin/sh\nexit 1\n' > "$SANDBOX/bin/pgrep"; chmod +x "$SANDBOX/bin/pgrep"
# Only what a fresh machine with these three harnesses has.
for bin in node npm npx claude codex gemini; do ln -s "$(command -v "$bin")" "$SANDBOX/bin/$bin"; done

# setup and telemetry first: init installs into the same HOME and would not change them, but a clean REAPER folder is the story
# setup connects the harnesses itself, so it gets a machine of its own: init (next) then still has something to do
SETUP_HOME="$SANDBOX/home-setup"
mkdir -p "$SETUP_HOME/Music" "$SETUP_HOME/.cursor" "$SETUP_HOME/REAPER"
printf '[REAPER]\n' > "$SETUP_HOME/REAPER/reaper.ini"
echo "==> Recording setup (scripts/setup-demo.tape)"
( cd "$REPO_ROOT" && DEMO_HOME="$SETUP_HOME" DEMO_REAPER="$SETUP_HOME/REAPER" vhs scripts/setup-demo.tape )
for tape in telemetry harnesses; do
  echo "==> Recording $tape (scripts/$tape-demo.tape)"
  ( cd "$REPO_ROOT" && vhs "scripts/$tape-demo.tape" )
done

echo "==> Checking the result"
export HOME="$DEMO_HOME" PATH="$DEMO_PATH" REAPER_MCP_TELEMETRY=0
fail() { echo "✗ $*" >&2; exit 1; }
# Capture, then match: `cmd | grep -q` under pipefail fails when grep exits early.
from_elsewhere() { ( cd "$DEMO_HOME/Music" && "$@" 2>&1 || true ); }

out="$(from_elsewhere claude mcp list)"
grep -q "reaper:.*Connected" <<<"$out" || fail "Claude Code does not see a connected reaper server: $out"
echo "✓ Claude Code sees REAPER from an unrelated folder"

out="$(from_elsewhere codex mcp list)"
grep -qE "^reaper .*enabled" <<<"$out" || fail "Codex CLI does not list an enabled reaper server: $out"
echo "✓ Codex CLI lists REAPER"

# Gemini CLI turns MCP servers off in a folder you have not trusted (it asks once, interactively); trust this one
out="$(GEMINI_CLI_TRUST_WORKSPACE=true from_elsewhere gemini mcp list)"
grep -q "reaper:.*Connected" <<<"$out" || fail "Gemini CLI does not see a connected reaper server: $out"
echo "✓ Gemini CLI sees REAPER"

grep -q '"reaper"' "$DEMO_HOME/.cursor/mcp.json" || fail "Cursor's mcp.json has no reaper server"
echo "✓ Cursor's mcp.json holds REAPER"

for dir in .claude/skills .agents/skills; do
  [ -f "$DEMO_HOME/$dir/mixer/SKILL.md" ] || fail "the mixer skill is not in ~/$dir"
done
[ -d "$DEMO_HOME/.claude/knowledge" ] || fail "the knowledge base is not in ~/.claude/knowledge"
[ ! -e "$DEMO_HOME/.agents/knowledge" ] || fail "the knowledge base was copied into the shared ~/.agents"
echo "✓ Skills are in ~/.claude and ~/.agents, the knowledge only in ~/.claude"

out="$(from_elsewhere node "$DEMO_PKG/main.js" doctor)"
grep -q "MCP config.*Connected: .*Claude Code.*Codex CLI.*Gemini CLI.*Cursor" <<<"$out" ||
  fail "doctor does not report all four harnesses connected:"$'\n'"$out"
echo "✓ doctor reports all four connected"
[ -f "$SETUP_HOME/REAPER/Scripts/mcp_bridge.lua" ] || fail "setup did not install the bridge into the REAPER folder"
echo "✓ setup installed the bridge"
echo "✓ CLI demos work — docs/assets/{harnesses,setup,telemetry}-demo.gif updated"
