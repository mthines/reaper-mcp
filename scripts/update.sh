#!/usr/bin/env bash
# Update a reaper-mcp clone and reinstall it:
#
#   ./scripts/update.sh            # latest version: fast-forward from the remote, then install.sh
#   ./scripts/update.sh --rebuild  # developers: build this working tree as it is and install it into REAPER
#
# The default refuses (and changes nothing) when there are uncommitted changes or the branch
# has diverged, so local work is never overwritten. --rebuild never touches git. The bridge
# status page runs this for its "Update" and "Rebuild & reload" buttons; the bridge restarts
# itself once a new script is installed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--rebuild" ]; then
  command -v node >/dev/null 2>&1 || fail "Node.js is not on PATH. Run reaper-mcp setup from a terminal once, then try again."
  if command -v pnpm >/dev/null 2>&1; then PNPM=(pnpm); else PNPM=(corepack pnpm); fi
  printf '==> Installing dependencies\n'
  "${PNPM[@]}" install --frozen-lockfile --prefer-offline
  # --skip-nx-cache: the cache misses edits to asset folders (reaper/, knowledge/), which are what you change here
  printf '==> Building %s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'working tree')"
  "${PNPM[@]}" nx build reaper-mcp-server --skip-nx-cache
  printf '==> Installing into REAPER\n'
  node dist/apps/reaper-mcp-server/main.js setup
  printf '✓ Rebuilt from your working tree\n'
  exit 0
fi

command -v git >/dev/null 2>&1 || fail "git is not installed."
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  fail "Your clone has uncommitted changes, so it wasn't updated. Commit or discard them in $REPO_ROOT, then try again."

before="$(git rev-parse --short HEAD)"
printf '==> Downloading the latest version\n'
git pull --ff-only --quiet || fail "Couldn't fast-forward $(git rev-parse --abbrev-ref HEAD) (offline, or the branch has diverged). Update it by hand in $REPO_ROOT."
after="$(git rev-parse --short HEAD)"
[ "$before" = "$after" ] && printf '    Already on the latest commit (%s)\n' "$after" || printf '    %s → %s\n' "$before" "$after"

bash ./scripts/install.sh
