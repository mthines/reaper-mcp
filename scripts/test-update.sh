#!/usr/bin/env bash
# Sandboxed end-to-end test of `reaper-mcp update` against the REAL npm registry.
#
#   pnpm nx build reaper-mcp-server bridge-ui   # once, so dist/ is current
#   scripts/test-update.sh                      # needs node, npm and a network
#   KEEP=1 scripts/test-update.sh               # keep the sandbox and print its path
#
# Packs this working tree as an npm package under the fake version 99.0.0, installs it into a
# throwaway npm prefix, and runs the commands the bridge page's Update button runs:
#
#   1. setup --yes              writes mcp_update.conf (mode=npm, node, cli) into the sandbox REAPER
#   2. update --bridge          99.0.0 is newer than npm's latest → "already current", exit 3
#   3. update --force --bridge  downloads npm's latest, replaces the install, runs `setup --yes`
#
# HOME, the npm prefix and cache, and REAPER_RESOURCE_PATH all point into the sandbox, so
# nothing outside it is touched: not your real REAPER, ~/.claude, or the global npm packages.
# The last step installs whatever npm's `latest` really is, so it also proves npm can resolve it
# (the ETARGET case from a tag that names a release the registry does not list).
#
# What it does not cover: the page's button and toast (storybook tests and the mocked-bridge
# browser probes cover those) and the bridge restarting inside a running REAPER. See docs/UPDATING.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/dist/apps/reaper-mcp-server"
UI_DIR="$REPO_ROOT/dist/apps/bridge-ui"
FAKE_VERSION="99.0.0"

for bin in node npm tar; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
done
[ -f "$PKG_DIR/main.js" ] && [ -f "$UI_DIR/mcp_bridge.html" ] || {
  echo "Build first: pnpm nx run-many --target=build" >&2; exit 1; }

PASS=0; FAIL=0
check() { # check "<what>" <condition exit code>
  if [ "$2" -eq 0 ]; then echo "  ✓ $1"; PASS=$((PASS + 1)); else echo "  ✗ $1"; FAIL=$((FAIL + 1)); fi
}

SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/reaper-mcp-update-test.XXXXXX")" && pwd -P)"
if [ "${KEEP:-0}" = 1 ]; then echo "sandbox: $SANDBOX"; else trap 'rm -rf "$SANDBOX"' EXIT; fi

export HOME="$SANDBOX/home"
export REAPER_RESOURCE_PATH="$SANDBOX/reaper"
export npm_config_prefix="$SANDBOX/prefix"
export npm_config_cache="$SANDBOX/npmcache"
export REAPER_MCP_TELEMETRY=0 DO_NOT_TRACK=1 REAPER_MCP_UPDATE_CHECK=0 NO_COLOR=1
mkdir -p "$HOME" "$REAPER_RESOURCE_PATH" "$npm_config_prefix"
CLI="$npm_config_prefix/lib/node_modules/@mthines/reaper-mcp/main.js"
CONF="$REAPER_RESOURCE_PATH/Scripts/mcp_update.conf"

echo "==> Registry"
LATEST="$(npm view @mthines/reaper-mcp dist-tags.latest 2>/dev/null || true)"
[ -n "$LATEST" ] || { echo "cannot reach the npm registry; this test needs the network" >&2; exit 1; }
echo "  npm latest: $LATEST"

echo "==> Pack this tree as $FAKE_VERSION (a copy: dist/ is left alone)"
STAGE="$SANDBOX/stage"
cp -R "$PKG_DIR" "$STAGE"
rm -rf "$STAGE/node_modules"
cp -R "$UI_DIR" "$STAGE/bridge-ui"
node -e '
  const fs = require("fs"); const p = process.argv[1] + "/package.json";
  const j = JSON.parse(fs.readFileSync(p, "utf8")); j.version = process.argv[2];
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");' "$STAGE" "$FAKE_VERSION"
( cd "$STAGE" && npm pack --silent --pack-destination "$SANDBOX" >/dev/null )
npm install -g --silent --no-audit --no-fund "$SANDBOX/mthines-reaper-mcp-$FAKE_VERSION.tgz"
installed() { node -p 'require(process.argv[1]).version' "$(dirname "$CLI")/package.json"; }
check "the packed build installs as v$FAKE_VERSION" "$([ "$(installed)" = "$FAKE_VERSION" ]; echo $?)"

echo "==> 1. setup --yes"
node "$CLI" setup --yes >"$SANDBOX/setup.log" 2>&1 || true
check "the bridge is installed into the sandbox REAPER" "$([ -f "$REAPER_RESOURCE_PATH/Scripts/mcp_bridge.lua" ]; echo $?)"
check "mcp_update.conf says mode=npm" "$(grep -qx 'mode=npm' "$CONF" 2>/dev/null; echo $?)"
check "mcp_update.conf names this node and CLI" "$(grep -qx "cli=$CLI" "$CONF" 2>/dev/null && grep -q '^node=' "$CONF"; echo $?)"
check "mcp_update.conf is not developer mode" "$(grep -qx 'dev=0' "$CONF" 2>/dev/null; echo $?)"

echo "==> 2. update --bridge when nothing is newer"
set +e; node "$CLI" update --bridge >"$SANDBOX/update-current.log" 2>&1; CODE=$?; set -e
check "exits 3 (the page shows 'Already up to date', not an install)" "$([ "$CODE" -eq 3 ]; echo $?)"
check "installed version unchanged" "$([ "$(installed)" = "$FAKE_VERSION" ]; echo $?)"

echo "==> 3. update --force --bridge installs npm's latest for real"
set +e; node "$CLI" update --force --bridge >"$SANDBOX/update-force.log" 2>&1; CODE=$?; set -e
check "exits 0" "$([ "$CODE" -eq 0 ]; echo $?)"
check "log ends with 'Updated to v…'" "$(grep -q '✓ Updated to v' "$SANDBOX/update-force.log"; echo $?)"
NOW="$(installed 2>/dev/null || echo missing)"
echo "  installed now: v$NOW"
check "the install was replaced by a published release, not left at $FAKE_VERSION" "$([ "$NOW" != "$FAKE_VERSION" ] && [ "$NOW" != missing ]; echo $?)"
check "the REAPER side was set up again (bridge present)" "$([ -f "$REAPER_RESOURCE_PATH/Scripts/mcp_bridge.lua" ]; echo $?)"

echo
if [ "$FAIL" -eq 0 ]; then echo "update test: $PASS checks passed"; else
  echo "update test: $FAIL failed, $PASS passed. Logs in $SANDBOX (rerun with KEEP=1)"; KEEP=1; trap - EXIT
  for f in setup update-current update-force; do echo "--- $f.log"; tail -15 "$SANDBOX/$f.log" 2>/dev/null; done
  exit 1
fi
