#!/usr/bin/env bash
# End-to-end test of the README install flow, recorded as the README's GIF.
#
#   scripts/test-install.sh        # needs vhs (brew install vhs) and Claude Code
#
# Builds a sandbox — empty HOME, a macOS-style REAPER folder, NO pnpm on PATH —
# from this working tree (uncommitted changes included), then runs
# scripts/install-demo.tape, which types the README command verbatim (git
# redirects the GitHub URL to the snapshot) and fails unless the installer
# prints "Done!". Afterwards it checks that Claude Code, opened in an unrelated
# folder, sees the REAPER server, and that doctor reports it registered.
# Writes docs/assets/install-demo.gif. Touches nothing outside the sandbox.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for bin in vhs node git claude; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
done

# Physical path, no `//`: the installer shortens "$HOME/…" to "~/…" by string match.
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/reaper-mcp-install-test.XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT
export DEMO_HOME="$SANDBOX/home"
export DEMO_REAPER="$DEMO_HOME/Library/Application Support/REAPER"
export DEMO_PATH="$SANDBOX/bin:/usr/bin:/bin"
mkdir -p "$DEMO_HOME/Music" "$DEMO_REAPER" "$SANDBOX/bin"
printf '[REAPER]\n' > "$DEMO_REAPER/reaper.ini"

echo "==> Snapshotting the working tree"
rsync -a --exclude node_modules --exclude dist --exclude .nx --exclude tmp --exclude .git \
  "$REPO_ROOT/" "$SANDBOX/origin/"
( cd "$SANDBOX/origin" && git init -q && git add -A &&
  git -c commit.gpgsign=false -c user.name=test -c user.email=test@local commit -qm snapshot )
git config -f "$DEMO_HOME/.gitconfig" url."file://$SANDBOX/origin".insteadOf \
  https://github.com/mthines/reaper-mcp.git

# Only what a fresh machine has: node/npm/npx (+ corepack when Node ships it), git, claude.
for bin in node npm npx git claude; do ln -s "$(command -v "$bin")" "$SANDBOX/bin/$bin"; done
corepack_bin="$(dirname "$(command -v node)")/corepack"
[ -x "$corepack_bin" ] && ln -s "$corepack_bin" "$SANDBOX/bin/corepack"

echo "==> Warming the download cache (keeps the recording short)"
( export HOME="$DEMO_HOME" PATH="$DEMO_PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  git clone -q "file://$SANDBOX/origin" "$SANDBOX/warm" && cd "$SANDBOX/warm" &&
  if command -v corepack >/dev/null; then corepack pnpm install; else
    npx --yes "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1]')" install; fi
) >/dev/null 2>&1

echo "==> Recording the install (scripts/install-demo.tape)"
( cd "$REPO_ROOT" && vhs scripts/install-demo.tape )

echo "==> Checking the result"
export HOME="$DEMO_HOME" PATH="$DEMO_PATH"
fail() { echo "✗ $*" >&2; exit 1; }
# Capture, then match: `cmd | grep -q` under pipefail fails when grep exits early.
mcp_list="$(cd "$DEMO_HOME/Music" && claude mcp list 2>&1 || true)"
grep -q "reaper:.*Connected" <<<"$mcp_list" ||
  fail "Claude Code does not see a connected reaper server from another folder"
echo "✓ Claude Code sees REAPER from an unrelated folder"
doctor="$(cd "$DEMO_HOME/Music/reaper-mcp" && npm run --silent doctor 2>&1 || true)"
grep -q "MCP config:.*Registered for your user" <<<"$doctor" ||
  fail "doctor does not report the user registration:"$'\n'"$doctor"
echo "✓ doctor reports the server registered"
echo "✓ Install flow works — docs/assets/install-demo.gif updated"
