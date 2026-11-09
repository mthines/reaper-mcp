import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRIDGE_VERSION_FILE, readBridgeVersion, repairBridgeInstall, repairNotices, type BridgeInstallPaths } from './bridge-repair.js';
import { AUTOSTART_MARKER } from './cli.js';

let root: string;
let paths: BridgeInstallPaths;

/** A build with this release's bridge, and a REAPER folder `reaper-mcp setup` ran for earlier. */
function fixture(installedBridge: string | null): void {
  root = mkdtempSync(join(tmpdir(), 'bridge-repair-'));
  paths = {
    scriptsDir: join(root, 'REAPER', 'Scripts'),
    effectsDir: join(root, 'REAPER', 'Effects'),
    wwwDir: join(root, 'REAPER', 'reaper_www_root'),
    assetsDir: join(root, 'build', 'reaper'),
    wwwSrcDir: join(root, 'build', 'bridge-ui'),
  };
  mkdirSync(paths.assetsDir, { recursive: true });
  mkdirSync(paths.wwwSrcDir, { recursive: true });
  mkdirSync(paths.scriptsDir, { recursive: true });
  writeFileSync(join(paths.assetsDir, 'mcp_bridge.lua'), '-- bridge v2');
  writeFileSync(join(paths.assetsDir, 'mcp_analyzer.jsfx'), 'desc: analyzer v2');
  writeFileSync(join(paths.wwwSrcDir, 'mcp_bridge.html'), '<html>v2</html>');
  if (installedBridge !== null) writeFileSync(join(paths.scriptsDir, 'mcp_bridge.lua'), installedBridge);
}

const read = (...p: string[]) => readFileSync(join(...p), 'utf-8');

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('repairBridgeInstall', () => {
  it('updates an older install to this release, adds the autostart block and records the release', () => {
    fixture('-- bridge v1');

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(repair).toEqual({ from: undefined, bridgeChanged: true, autostartAdded: true });
    expect(read(paths.scriptsDir, 'mcp_bridge.lua')).toBe('-- bridge v2');
    expect(read(paths.effectsDir, 'reaper-mcp', 'mcp_analyzer.jsfx')).toBe('desc: analyzer v2');
    expect(read(paths.wwwDir, 'mcp_bridge.html')).toBe('<html>v2</html>');
    expect(read(paths.scriptsDir, '__startup.lua')).toContain(AUTOSTART_MARKER);
    expect(readBridgeVersion(paths.scriptsDir)).toBe('0.83.0');
  });

  it('keeps what else is in the user\'s startup script', () => {
    fixture('-- bridge v1');
    writeFileSync(join(paths.scriptsDir, '__startup.lua'), 'reaper.ShowConsoleMsg("mine")\n');

    repairBridgeInstall(paths, '0.83.0', { inClone: false });

    const startup = read(paths.scriptsDir, '__startup.lua');
    expect(startup).toContain(AUTOSTART_MARKER);
    expect(startup).toContain('reaper.ShowConsoleMsg("mine")');
  });

  it('reports no bridge change when the installed bridge is already this release\'s', () => {
    fixture('-- bridge v2');

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(repair.bridgeChanged).toBe(false);
    expect(repair.autostartAdded).toBe(true);
  });

  it('runs once per release: a second start changes nothing, even after the user removed the block', () => {
    fixture('-- bridge v1');
    repairBridgeInstall(paths, '0.83.0', { inClone: false });
    writeFileSync(join(paths.scriptsDir, '__startup.lua'), '');

    const again = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(again).toEqual({ skipped: 'current', from: '0.83.0', bridgeChanged: false, autostartAdded: false });
    expect(read(paths.scriptsDir, '__startup.lua')).toBe('');
  });

  it('never downgrades a bridge a newer release installed', () => {
    fixture('-- bridge v3');
    writeFileSync(join(paths.scriptsDir, BRIDGE_VERSION_FILE), '0.90.0\n');

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(repair.skipped).toBe('current');
    expect(read(paths.scriptsDir, 'mcp_bridge.lua')).toBe('-- bridge v3');
  });

  it('leaves a REAPER that setup never ran for alone', () => {
    fixture(null);

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(repair.skipped).toBe('not_installed');
    expect(existsSync(join(paths.scriptsDir, '__startup.lua'))).toBe(false);
    expect(existsSync(join(paths.scriptsDir, BRIDGE_VERSION_FILE))).toBe(false);
  });

  it('leaves a git clone to its own setup', () => {
    fixture('-- bridge v1');

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: true });

    expect(repair.skipped).toBe('clone');
    expect(read(paths.scriptsDir, 'mcp_bridge.lua')).toBe('-- bridge v1');
  });

  it('leaves a ReaPack-only install that setup never ran for alone: its users opt in to autostart by running setup', () => {
    fixture(null);
    const reapackDir = join(paths.scriptsDir, 'reaper-mcp', 'MCP Bridge');
    mkdirSync(reapackDir, { recursive: true });
    writeFileSync(join(reapackDir, 'mcp_bridge.lua'), '-- reapack bridge');

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(repair.skipped).toBe('not_installed');
    expect(existsSync(join(paths.scriptsDir, '__startup.lua'))).toBe(false);
    expect(existsSync(join(paths.scriptsDir, BRIDGE_VERSION_FILE))).toBe(false);
  });

  it('on an update, gives a ReaPack install setup ran for its autostart block back and leaves its files to ReaPack', () => {
    fixture(null);
    const reapackDir = join(paths.scriptsDir, 'reaper-mcp', 'MCP Bridge');
    mkdirSync(reapackDir, { recursive: true });
    writeFileSync(join(reapackDir, 'mcp_bridge.lua'), '-- reapack bridge');
    writeFileSync(join(paths.scriptsDir, BRIDGE_VERSION_FILE), '0.80.0\n');

    const repair = repairBridgeInstall(paths, '0.83.0', { inClone: false });

    expect(repair).toEqual({ from: '0.80.0', bridgeChanged: false, autostartAdded: true });
    expect(existsSync(join(paths.scriptsDir, 'mcp_bridge.lua'))).toBe(false);
    expect(read(reapackDir, 'mcp_bridge.lua')).toBe('-- reapack bridge');
  });
});

describe('repairNotices', () => {
  it('asks for a restart when REAPER runs the old bridge', () => {
    const [notice] = repairNotices({ bridgeChanged: true, autostartAdded: false }, '0.83.0', true);
    expect(notice).toMatch(/updated the REAPER bridge to 0\.83\.0.*restart REAPER/);
  });

  it('tells the user to start REAPER when the bridge now starts with it and is not running', () => {
    const notices = repairNotices({ bridgeChanged: false, autostartAdded: true }, '0.83.0', false);
    expect(notices).toEqual([expect.stringMatching(/starts with REAPER.*Start or restart REAPER/)]);
  });

  it('says nothing when nothing changed', () => {
    expect(repairNotices({ skipped: 'current', bridgeChanged: false, autostartAdded: false }, '0.83.0', true)).toEqual([]);
  });
});
