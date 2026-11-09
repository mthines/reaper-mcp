import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTOSTART_MARKER, BRIDGE_UI_FILE, REAPER_ASSETS, RETIRED_ASSETS, copyDirSync, ensureBridgeAutostart, installFile } from './cli.js';
import { compareVersions } from './version.js';

/**
 * Next to mcp_bridge.lua in REAPER's Scripts/: the reaper-mcp release that last installed REAPER's files,
 * written by `reaper-mcp setup` and by repairBridgeInstall(). Missing on installs from before it existed.
 */
export const BRIDGE_VERSION_FILE = 'mcp_bridge_version.txt';

export interface BridgeInstallPaths {
  /** REAPER's Scripts/ folder */
  scriptsDir: string;
  /** REAPER's Effects/ folder (the JSFX go into its reaper-mcp/ subfolder) */
  effectsDir: string;
  /** REAPER's reaper_www_root/ (the bridge status page) */
  wwwDir: string;
  /** This build's reaper/ assets (REAPER_ASSETS) */
  assetsDir: string;
  /** This build's bridge-ui output (mcp_bridge.html and its PWA files) */
  wwwSrcDir: string;
}

export interface BridgeRepair {
  /**
   * Why nothing (more) was done: a clone, setup never ran, already this release, or `failed` — copying or
   * writing threw (an unwritable Scripts/ folder, say), so the release is not recorded and the next start retries
   */
  skipped?: 'clone' | 'not_installed' | 'current' | 'failed';
  /** With `failed`: the error's code (EACCES, EISDIR, …) or class name, never its message (it holds paths) */
  error?: string;
  /** The release that installed the files before; undefined for an install from before BRIDGE_VERSION_FILE */
  from?: string;
  /** mcp_bridge.lua or one of its libraries changed: REAPER runs the old bridge until the bridge restarts */
  bridgeChanged: boolean;
  /** The start-with-REAPER block was not in Scripts/__startup.lua and now is */
  autostartAdded: boolean;
}

/** The release recorded in BRIDGE_VERSION_FILE, or undefined. */
export function readBridgeVersion(scriptsDir: string): string | undefined {
  try {
    const v = readFileSync(join(scriptsDir, BRIDGE_VERSION_FILE), 'utf-8').trim();
    return /^\d+\.\d+\.\d+/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function writeBridgeVersion(scriptsDir: string, version: string): void {
  writeFileSync(join(scriptsDir, BRIDGE_VERSION_FILE), `${version}\n`, 'utf-8');
}

function sameContent(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/**
 * Copy this build's REAPER files over the installed ones, as `setup` does: the Lua scripts into Scripts/
 * (retired ones deleted), the JSFX into Effects/reaper-mcp/ and the status page into reaper_www_root/.
 * @returns whether any Lua file changed, i.e. whether the running bridge is now older than the installed one.
 */
export function installReaperFiles(paths: BridgeInstallPaths): boolean {
  let luaChanged = false;
  for (const asset of REAPER_ASSETS) {
    const src = join(paths.assetsDir, asset);
    if (!existsSync(src)) continue;
    const lua = asset.endsWith('.lua');
    const destDir = lua ? paths.scriptsDir : join(paths.effectsDir, 'reaper-mcp');
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, asset);
    if (lua && !sameContent(src, dest)) luaChanged = true;
    installFile(src, dest);
  }
  for (const asset of RETIRED_ASSETS) rmSync(join(paths.scriptsDir, asset), { force: true });
  if (existsSync(join(paths.wwwSrcDir, BRIDGE_UI_FILE))) copyDirSync(paths.wwwSrcDir, paths.wwwDir);
  return luaChanged;
}

/**
 * Bring REAPER's side of an npm install up to this release, once per release, the way `reaper-mcp setup`
 * does on an update: an npm update replaces the server but never touches REAPER's files, so without this
 * the bridge stays at the release that was set up (failing new commands as `bridge_outdated`) and installs
 * from before v0.74.0 never get the block that starts the bridge with REAPER.
 *
 * Does nothing in a git clone (its own `setup` and the status page's Update keep it current), when setup
 * never ran for this REAPER, or when BRIDGE_VERSION_FILE already names this release or a newer one (so a
 * second, older install never downgrades the bridge). Files ReaPack installed are left to ReaPack: a
 * ReaPack-only install gets the autostart block back on an update only when `setup` ran for it (its
 * release record exists), since ReaPack users opt in to autostart by running `setup`.
 */
export function repairBridgeInstall(paths: BridgeInstallPaths, version: string, opts: { inClone: boolean }): BridgeRepair {
  const none = { bridgeChanged: false, autostartAdded: false };
  if (opts.inClone) return { skipped: 'clone', ...none };
  const reapack = existsSync(join(paths.scriptsDir, 'reaper-mcp', 'MCP Bridge', 'mcp_bridge.lua'));
  const ours = existsSync(join(paths.scriptsDir, 'mcp_bridge.lua'));
  const from = readBridgeVersion(paths.scriptsDir);
  // A ReaPack user opts in to starting the bridge with REAPER by running `setup` (README, NPM_INSTALL),
  // which records its release: without that record a ReaPack-only install is not ours to touch
  if (!ours && !(reapack && from)) return { skipped: 'not_installed', ...none };
  if (from && compareVersions(from, version) >= 0) return { skipped: 'current', from, ...none };

  try {
    const bridgeChanged = reapack ? false : installReaperFiles(paths);
    const startupPath = join(paths.scriptsDir, '__startup.lua');
    const startup = existsSync(startupPath) ? readFileSync(startupPath, 'utf-8') : '';
    const { text, changed } = ensureBridgeAutostart(startup);
    if (changed) writeFileSync(startupPath, text, 'utf-8');
    writeBridgeVersion(paths.scriptsDir, version);
    return { from, bridgeChanged, autostartAdded: !startup.includes(AUTOSTART_MARKER) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { skipped: 'failed', from, error: code ?? (err instanceof Error ? err.name : 'Error'), ...none };
  }
}

/** What to tell the user about a repair, given whether the bridge answered at startup. */
export function repairNotices(repair: BridgeRepair, version: string, bridgeRunning: boolean): string[] {
  const notices: string[] = [];
  if (repair.bridgeChanged) {
    notices.push(bridgeRunning
      ? `reaper-mcp updated the REAPER bridge to ${version}, but REAPER is still running the old one: restart REAPER, ` +
        'or click Restart bridge in the bridge window, so it loads the new bridge.'
      : `reaper-mcp updated the REAPER bridge to ${version}; REAPER loads it the next time the bridge starts.`);
  }
  if (repair.autostartAdded) {
    notices.push('The REAPER bridge now starts with REAPER (reaper-mcp added it to REAPER\'s Scripts/__startup.lua; ' +
      'turn it off in the bridge window under Settings → Start with REAPER). ' +
      (bridgeRunning ? 'It takes effect the next time REAPER starts.' : 'Start or restart REAPER and the bridge starts with it.'));
  }
  return notices;
}
