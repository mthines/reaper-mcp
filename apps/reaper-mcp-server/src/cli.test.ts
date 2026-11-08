import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LuaFactory } from 'wasmoon';
import { renderDoctor } from './doctor-report.js';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, hasUserMcpServer, userMcpServerIsStale, ensureWebInterface, ensureSnapshotActions, ensureBridgeAutostart, setupFilesPlan, autostartCheck, readExtState, findCloneRoot, isDevClone, updateConfigText, REAPER_ASSETS, RETIRED_ASSETS, KNOWLEDGE_DIRS } from './cli.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reaper-mcp-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('cli helpers', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('hasUserMcpServer', () => {
    it('is true when ~/.claude.json registers a reaper server', () => {
      const path = join(tmp, '.claude.json');
      writeFileSync(path, JSON.stringify({ mcpServers: { reaper: { command: 'node', args: ['main.js', 'serve'] } } }));
      expect(hasUserMcpServer(path)).toBe(true);
    });

    it('is false without a reaper server, a missing file, or invalid JSON', () => {
      const path = join(tmp, '.claude.json');
      writeFileSync(path, JSON.stringify({ mcpServers: { other: {} } }));
      expect(hasUserMcpServer(path)).toBe(false);
      expect(hasUserMcpServer(join(tmp, 'missing.json'))).toBe(false);
      writeFileSync(path, '{ not json');
      expect(hasUserMcpServer(path)).toBe(false);
    });
  });

  describe('userMcpServerIsStale', () => {
    const write = (server: unknown) => {
      const path = join(tmp, '.claude.json');
      writeFileSync(path, JSON.stringify({ mcpServers: { reaper: server } }));
      return path;
    };

    it('is true when the registered script no longer exists', () => {
      const path = write({ command: process.execPath, args: [join(tmp, 'gone', 'main.js'), 'serve'] });
      expect(userMcpServerIsStale(path)).toBe(true);
    });

    it('is false when the registered node and script both exist', () => {
      const main = join(tmp, 'main.js');
      writeFileSync(main, '');
      expect(userMcpServerIsStale(write({ command: process.execPath, args: [main, 'serve'] }))).toBe(false);
    });

    it('is false for a PATH command, no server, or an unreadable file', () => {
      expect(userMcpServerIsStale(write({ command: 'reaper-mcp', args: ['serve'] }))).toBe(false);
      expect(userMcpServerIsStale(write(undefined))).toBe(false);
      expect(userMcpServerIsStale(join(tmp, 'missing.json'))).toBe(false);
    });
  });

  describe('resolveAssetDir', () => {
    it('returns sibling path when it exists (npm layout)', () => {
      const baseDir = join(tmp, 'package');
      mkdirSync(join(baseDir, 'reaper'), { recursive: true });
      const result = resolveAssetDir(baseDir, 'reaper');
      expect(result).toBe(join(baseDir, 'reaper'));
    });

    it('falls back to parent path when sibling does not exist (dev layout)', () => {
      const baseDir = join(tmp, 'dist', 'apps', 'server');
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(join(tmp, 'dist', 'apps', 'reaper'), { recursive: true });
      const result = resolveAssetDir(baseDir, 'reaper');
      expect(result).toBe(join(tmp, 'dist', 'apps', 'reaper'));
    });

    it('walks up to find asset in ancestor directory (source layout)', () => {
      // Simulates running from apps/reaper-mcp-server/src/ where reaper/ is at repo root
      const baseDir = join(tmp, 'apps', 'server', 'src');
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(join(tmp, 'reaper'), { recursive: true });
      const result = resolveAssetDir(baseDir, 'reaper');
      expect(result).toBe(join(tmp, 'reaper'));
    });

    it('prefers sibling over parent when both exist', () => {
      const baseDir = join(tmp, 'inner');
      mkdirSync(join(baseDir, 'assets'), { recursive: true });
      mkdirSync(join(tmp, 'assets'), { recursive: true });
      const result = resolveAssetDir(baseDir, 'assets');
      expect(result).toBe(join(baseDir, 'assets'));
    });
  });

  describe('copyDirSync', () => {
    it('copies files recursively and returns count', () => {
      const src = join(tmp, 'src');
      const dest = join(tmp, 'dest');
      mkdirSync(join(src, 'sub'), { recursive: true });
      writeFileSync(join(src, 'a.txt'), 'hello');
      writeFileSync(join(src, 'sub', 'b.txt'), 'world');

      const count = copyDirSync(src, dest);

      expect(count).toBe(2);
      expect(readFileSync(join(dest, 'a.txt'), 'utf-8')).toBe('hello');
      expect(readFileSync(join(dest, 'sub', 'b.txt'), 'utf-8')).toBe('world');
    });

    it('returns 0 when source does not exist', () => {
      const count = copyDirSync(join(tmp, 'nonexistent'), join(tmp, 'dest'));
      expect(count).toBe(0);
    });

    it('handles empty directories', () => {
      const src = join(tmp, 'empty');
      mkdirSync(src);
      const count = copyDirSync(src, join(tmp, 'dest'));
      expect(count).toBe(0);
    });
  });

  describe('installFile', () => {
    it('copies file and returns true when source exists', () => {
      const src = join(tmp, 'source.txt');
      const dest = join(tmp, 'dest.txt');
      writeFileSync(src, 'content');

      expect(installFile(src, dest)).toBe(true);
      expect(readFileSync(dest, 'utf-8')).toBe('content');
    });

    it('returns false when source does not exist', () => {
      expect(installFile(join(tmp, 'missing.txt'), join(tmp, 'dest.txt'))).toBe(false);
    });
  });

  describe('createMcpJson', () => {
    it('creates .mcp.json that runs the server script with node by absolute path', () => {
      const path = join(tmp, '.mcp.json');
      const script = join(tmp, 'dist', 'main.js');

      expect(createMcpJson(path, script)).toBe(true);

      const content = JSON.parse(readFileSync(path, 'utf-8'));
      expect(content.mcpServers.reaper.command).toBe('node');
      expect(content.mcpServers.reaper.args).toEqual([script, 'serve']);
    });

    it('resolves a relative server script to an absolute path', () => {
      const path = join(tmp, '.mcp.json');

      createMcpJson(path, 'dist/main.js');

      const content = JSON.parse(readFileSync(path, 'utf-8'));
      expect(content.mcpServers.reaper.args).toEqual([resolve('dist/main.js'), 'serve']);
    });

    it('returns false when file already exists', () => {
      const path = join(tmp, '.mcp.json');
      writeFileSync(path, '{}');

      expect(createMcpJson(path, join(tmp, 'main.js'))).toBe(false);
    });
  });

  describe('constants', () => {
    it('setup installs every library the bridge loads', () => {
      const bridge = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');
      const loaded = [...bridge.matchAll(/dofile, script_dir \.\. "([^"]+)"/g)].map((m) => m[1]);
      expect(loaded).toContain('mcp_arrange_lib.lua');
      for (const lib of loaded) expect(REAPER_ASSETS as readonly string[]).toContain(lib);
    });

    it('REAPER_ASSETS includes all required files', () => {
      expect(REAPER_ASSETS).toContain('mcp_bridge.lua');
      expect(REAPER_ASSETS).toContain('mcp_analyzer.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_lufs_meter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_correlation_meter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_crest_factor.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_midi_emitter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_next.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_prev.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_quick_save.lua');
      expect(REAPER_ASSETS).toContain('mcp_plan_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_actions_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_tracks_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_project_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_items_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_envelopes_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_mixing_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_render_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_edit_views_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshots_ui_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_prefs_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_gain_trace.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_recording_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_midi_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_arrange_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_fxstate_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_extensions_lib.lua');
      expect(REAPER_ASSETS.length).toBe(27);
    });

    it('retires the gfx snapshot manager (replaced by the status page Snapshots tab)', () => {
      expect(REAPER_ASSETS).not.toContain('mcp_snapshot_manager.lua');
      expect(RETIRED_ASSETS).toContain('mcp_snapshot_manager.lua');
    });

    it('KNOWLEDGE_DIRS includes all expected subdirectories', () => {
      expect(KNOWLEDGE_DIRS).toContain('genres');
      expect(KNOWLEDGE_DIRS).toContain('plugins');
      expect(KNOWLEDGE_DIRS).toContain('workflows');
      expect(KNOWLEDGE_DIRS).toContain('reference');
    });
  });
});

describe('package integrity', () => {
  // Vitest cwd is apps/reaper-mcp-server, so go up to workspace root
  const workspaceRoot = join(process.cwd(), '..', '..');
  const distDir = join(workspaceRoot, 'dist', 'apps', 'reaper-mcp-server');

  // These tests verify the built dist package has everything needed for npm
  // They only run when dist exists (i.e., after a build)
  const distExists = existsSync(distDir);

  it.skipIf(!distExists)('dist contains main.js with shebang', () => {
    const mainJs = readFileSync(join(distDir, 'main.js'), 'utf-8');
    expect(mainJs.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it.skipIf(!distExists)('dist contains package.json with bin field', () => {
    const pkg = JSON.parse(readFileSync(join(distDir, 'package.json'), 'utf-8'));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin['reaper-mcp']).toBe('./main.js');
  });

  it.skipIf(!distExists)('dist contains package.json with dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(distDir, 'package.json'), 'utf-8'));
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeDefined();
    expect(pkg.dependencies['zod']).toBeDefined();
  });

  // The npm package carries the bridge, sidecar and the skills install-skills copies into ~/.claude.
  it.skipIf(!distExists)('dist contains all REAPER assets', () => {
    for (const asset of REAPER_ASSETS) {
      expect(existsSync(join(distDir, 'reaper', asset)), `missing reaper/${asset}`).toBe(true);
    }
  });

  it.skipIf(!distExists)('dist carries the skills, agents and knowledge that install-skills copies', () => {
    expect(existsSync(join(distDir, 'claude', 'skills', 'learn-plugin', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(distDir, 'claude', 'agents', 'plugin-researcher.md'))).toBe(true);
    expect(existsSync(join(distDir, 'claude', 'knowledge', 'reference', 'lorekit-setup.md'))).toBe(true);
  });

  it.skipIf(!distExists)('dist leaves the repo-only knowledge files out of the package', () => {
    expect(existsSync(join(distDir, 'claude', 'knowledge', 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(distDir, 'claude', 'knowledge', 'contributions'))).toBe(false);
  });

  it('mixer skill + memory protocol resolve from the repo source tree', () => {
    expect(existsSync(join(workspaceRoot, '.claude', 'skills', 'mixer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'knowledge', 'reference', 'memory-protocol.md'))).toBe(true);
  });

  it.skipIf(!distExists)('main.js does not contain node_modules paths', () => {
    const mainJs = readFileSync(join(distDir, 'main.js'), 'utf-8');
    // A path segment, not the word: the extension installer names node_modules in the folders it skips when copying
    expect(mainJs).not.toMatch(/[\\/]node_modules[\\/]/);
  });
});

describe('ensureWebInterface', () => {
  it('adds an HTTP surface and csurf_cnt when none exist', () => {
    const ini = '[REAPER]\nfoo=1\n\n[audioconfig]\nbar=2\n';
    const out = ensureWebInterface(ini, 8099);
    expect(out.changed).toBe(true);
    expect(out.ini).toBe(
      "[REAPER]\nfoo=1\ncsurf_cnt=1\ncsurf_0=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''\n\n[audioconfig]\nbar=2\n",
    );
  });

  it('appends after existing surfaces and bumps the count', () => {
    const ini = '[REAPER]\ncsurf_cnt=1\ncsurf_0=OSC "x" 3 8000\n';
    const out = ensureWebInterface(ini, 8099);
    expect(out.ini).toContain('csurf_cnt=2\n');
    expect(out.ini).toContain("csurf_1=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''");
  });

  it('keeps an existing web interface and reports its port', () => {
    const ini = "[REAPER]\ncsurf_cnt=1\ncsurf_0=HTTP 0 8080 '' 'index.html' 0 ''\n";
    expect(ensureWebInterface(ini, 8099)).toEqual({ ini, port: 8080, changed: false });
  });

  it('re-enables a web interface left past csurf_cnt, which REAPER ignores', () => {
    const ini = "[REAPER]\ncsurf_0=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''\ncsurf_cnt=0\ncsurfrate=15\n";
    const out = ensureWebInterface(ini, 8099);
    expect(out.changed).toBe(true);
    expect(out.ini).toBe("[REAPER]\ncsurf_0=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''\ncsurf_cnt=1\ncsurfrate=15\n");
  });

  it('replaces a stale entry at the next index instead of duplicating it', () => {
    const ini = "[REAPER]\ncsurf_cnt=1\ncsurf_0=OSC \"x\" 3 8000\ncsurf_1=HTTP 0 8080 '' 'index.html' 0 ''\n";
    const out = ensureWebInterface(ini, 8099);
    expect(out.ini).toBe("[REAPER]\ncsurf_cnt=2\ncsurf_0=OSC \"x\" 3 8000\ncsurf_1=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''\n");
  });

  it('preserves CRLF line endings', () => {
    const out = ensureWebInterface('[REAPER]\r\nfoo=1\r\n', 8099);
    expect(out.ini).not.toMatch(/[^\r]\n/);
  });
});

describe('findCloneRoot', () => {
  const root = join(tmpdir(), `clone-${randomUUID()}`);
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finds the clone from its build output', () => {
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'update.sh'), '');
    const dist = join(root, 'dist', 'apps', 'reaper-mcp-server');
    mkdirSync(dist, { recursive: true });
    expect(findCloneRoot(dist)).toBe(resolve(root));
  });

  it('is null outside a git clone', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'update.sh'), '');
    expect(findCloneRoot(join(root, 'scripts'))).toBeNull();
  });
});

describe('updateConfigText', () => {
  it('writes key=value lines the bridge reads', () => {
    expect(updateConfigText('/Users/me/reaper-mcp', '/opt/homebrew/bin/node', true)).toBe(
      'repo=/Users/me/reaper-mcp\nnode=/opt/homebrew/bin/node\ndev=1\n',
    );
  });
});

describe('isDevClone', () => {
  const release = { dirty: false, branch: 'main', ahead: 0 };
  it('is a release install only when clean, on main and in sync with upstream', () => {
    expect(isDevClone(release)).toBe(false);
    expect(isDevClone({ ...release, dirty: true })).toBe(true);
    expect(isDevClone({ ...release, branch: 'feat/x' })).toBe(true);
    expect(isDevClone({ ...release, ahead: 2 })).toBe(true);
    expect(isDevClone({ ...release, ahead: null })).toBe(true);
  });
});

describe('ensureSnapshotActions', () => {
  const kb = 'ACT 0 0 "abc" "Custom: Foo" 40001\nSCR 260 0 RScb8f "Custom: mcp_bridge.lua" mcp_bridge.lua\nKEY 1 65 40001 0\n';

  it('lists the quick save, next and previous scripts as main-section actions', () => {
    const out = ensureSnapshotActions(kb);
    expect(out.added).toEqual(['mcp_snapshot_quick_save.lua', 'mcp_snapshot_next.lua', 'mcp_snapshot_prev.lua']);
    expect(out.kb.startsWith(kb)).toBe(true);
    expect(out.kb).toMatch(/^SCR 4 0 RS[0-9a-f]{40} "Custom: mcp_snapshot_next\.lua" mcp_snapshot_next\.lua$/m);
  });

  it('keeps a script that is already listed, and is idempotent', () => {
    const once = ensureSnapshotActions(kb).kb;
    expect(ensureSnapshotActions(once)).toEqual({ kb: once, added: [] });
    const withNext = kb + 'SCR 4 0 RSdead "Custom: mcp_snapshot_next.lua" mcp_snapshot_next.lua\n';
    expect(ensureSnapshotActions(withNext).added).toEqual(['mcp_snapshot_quick_save.lua', 'mcp_snapshot_prev.lua']);
  });

  it('creates the file for a REAPER that has no custom actions yet', () => {
    expect(ensureSnapshotActions('').kb.split('\n').filter(Boolean)).toHaveLength(3);
  });
});

describe('ensureBridgeAutostart', () => {
  it('writes the block into a REAPER that has no startup script yet', () => {
    const { text, changed } = ensureBridgeAutostart('');
    expect(changed).toBe(true);
    expect(text).toContain('-- reaper-mcp: start the bridge with REAPER (begin)');
    expect(text.endsWith('-- reaper-mcp: start the bridge with REAPER (end)\n')).toBe(true);
  });

  it('keeps the user\'s own startup code, after the block', () => {
    const own = 'reaper.Main_OnCommand(40001, 0)\n';
    const { text } = ensureBridgeAutostart(own);
    expect(text.endsWith(own)).toBe(true);
    expect(text.indexOf('(begin)')).toBeLessThan(text.indexOf('40001'));
  });

  it('changes nothing the second time', () => {
    const once = ensureBridgeAutostart('-- mine\n').text;
    expect(ensureBridgeAutostart(once)).toEqual({ text: once, changed: false });
  });

  it('replaces an older block in place, leaving the code around it', () => {
    const old = '-- before\n-- reaper-mcp: start the bridge with REAPER (begin)\nold_code()\n-- reaper-mcp: start the bridge with REAPER (end)\n-- after\n';
    const { text, changed } = ensureBridgeAutostart(old);
    expect(changed).toBe(true);
    expect(text).not.toContain('old_code');
    expect(text.startsWith('-- before\n-- reaper-mcp: start the bridge with REAPER (begin)\n')).toBe(true);
    expect(text.endsWith('(end)\n-- after\n')).toBe(true);
  });

  it('keeps Windows line endings', () => {
    const { text } = ensureBridgeAutostart('-- mine\r\nreturn\r\n');
    expect(text.split('\r\n').length).toBeGreaterThan(5);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('the autostart block, run by REAPER at launch (wasmoon)', () => {
  /** Run a startup script setup wrote, ahead of the user's own (ending in a top-level return), against a fake REAPER. */
  async function launchReaper({ setting = '', bridgeInstalled = true, installedAt = ['/reaper/Scripts/mcp_bridge.lua'] } = {}) {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.global.set('SETTING', setting);
      lua.global.set('INSTALLED', bridgeInstalled);
      lua.global.set('INSTALLED_AT', installedAt.join('|'));
      await lua.doString(`
        reaper = {
          GetResourcePath = function() return "/reaper" end,
          GetExtState = function(section, key)
            if section == "MCPBridge" and key == "cfg_autostart" then return SETTING end
            return ""
          end,
          file_exists = function(path) return INSTALLED and ("|" .. INSTALLED_AT .. "|"):find("|" .. path .. "|", 1, true) ~= nil end,
          AddRemoveReaScript = function(add, section, path, commit) registered = path; return 41234 end,
          Main_OnCommand = function(id) ran = id end,
        }
      `);
      await lua.doString(ensureBridgeAutostart('own_startup_ran = true\nreturn\n').text);
      return {
        ran: lua.global.get('ran') as number | null,
        registered: lua.global.get('registered') as string | null,
        ownStartupRan: lua.global.get('own_startup_ran') as boolean | null,
      };
    } finally {
      lua.global.close();
    }
  }

  it('starts mcp_bridge.lua as its own action, then runs the user\'s startup code', async () => {
    expect(await launchReaper()).toEqual({ ran: 41234, registered: '/reaper/Scripts/mcp_bridge.lua', ownStartupRan: true });
  });

  it('starts the copy ReaPack installed when setup has not put one in Scripts/', async () => {
    const reapack = '/reaper/Scripts/reaper-mcp/MCP Bridge/mcp_bridge.lua';
    expect(await launchReaper({ installedAt: [reapack] })).toEqual({ ran: 41234, registered: reapack, ownStartupRan: true });
  });

  it('prefers ReaPack\'s copy when both exist, since ReaPack keeps that one current', async () => {
    const reapack = '/reaper/Scripts/reaper-mcp/MCP Bridge/mcp_bridge.lua';
    const both = await launchReaper({ installedAt: ['/reaper/Scripts/mcp_bridge.lua', reapack] });
    expect(both.registered).toBe(reapack);
  });

  it('leaves the bridge stopped once Start with REAPER is turned off in the bridge window', async () => {
    expect(await launchReaper({ setting: '0' })).toMatchObject({ ran: null, ownStartupRan: true });
  });

  it('does nothing when the bridge script is not installed', async () => {
    expect(await launchReaper({ bridgeInstalled: false })).toMatchObject({ ran: null, registered: null, ownStartupRan: true });
  });
});

describe('setupFilesPlan', () => {
  it('copies the files as usual without ReaPack', () => {
    expect(setupFilesPlan(false, false)).toBe('install');
    expect(setupFilesPlan(false, true)).toBe('install');
  });

  it('leaves the files to ReaPack for an npm install', () => {
    expect(setupFilesPlan(true, false)).toBe('leave');
  });

  it('still installs from a developer clone, with a warning that ReaPack\'s copy wins', () => {
    expect(setupFilesPlan(true, true)).toBe('install-with-warning');
  });
});

describe('readExtState', () => {
  const ini = '[SomeScript]\r\ncfg_autostart=1\r\n[MCPBridge]\r\ncfg_readonly=1\r\ncfg_autostart=0\r\n[Other]\r\nx=y\r\n';

  it('reads a key from its own section only', () => {
    expect(readExtState(ini, 'MCPBridge', 'cfg_autostart')).toBe('0');
    expect(readExtState(ini, 'SomeScript', 'cfg_autostart')).toBe('1');
    expect(readExtState(ini, 'MCPBridge', 'cfg_dev')).toBeUndefined();
    expect(readExtState('', 'MCPBridge', 'cfg_autostart')).toBeUndefined();
  });
});

describe('doctor: Start with REAPER', () => {
  const startup = ensureBridgeAutostart('-- the user\'s own startup code\n').text;
  const turnedOff = '[MCPBridge]\ncfg_open_on_start=1\ncfg_autostart=0\n';

  it('is on when REAPER\'s startup script holds the block and the setting was never turned off', () => {
    expect(autostartCheck(startup, null, false)).toMatchObject({ status: 'ok', detail: expect.stringMatching(/^On/) });
    expect(autostartCheck(startup, '[MCPBridge]\ncfg_autostart=1\n', false).status).toBe('ok');
  });

  it('reports the bridge window\'s setting turned off, with how to turn it back on', () => {
    expect(autostartCheck(startup, turnedOff, false)).toMatchObject({
      status: 'info',
      detail: expect.stringMatching(/^Off in the bridge window/),
      fix: 'turn it back on in the bridge window: Settings → Start with REAPER',
    });
  });

  it('ignores the same key saved by another script', () => {
    expect(autostartCheck(startup, '[SomeScript]\ncfg_autostart=0\n', false).status).toBe('ok');
  });

  it('warns, with setup as the fix, when the startup script is missing or lacks the block', () => {
    for (const missing of [null, '-- someone else\'s startup script\n']) {
      expect(autostartCheck(missing, turnedOff, false)).toMatchObject({ status: 'warn', fix: 'reaper-mcp setup' });
    }
  });

  it('says the setting is as REAPER last saved it while REAPER runs', () => {
    expect(autostartCheck(startup, turnedOff, true).detail).toContain('(as REAPER last saved it)');
    expect(autostartCheck(startup, turnedOff, false).detail).not.toContain('last saved');
  });

  it('never makes the doctor report a problem: the bridge still works when started by hand', () => {
    const out = renderDoctor([{ title: 'Core', checks: [autostartCheck(null, null, false)] }]);
    expect(out).toContain('! Start with REAPER  Not in REAPER\'s Scripts/__startup.lua');
    expect(out).toContain('→ reaper-mcp setup');
    expect(out).toContain('All good.');
  });
});
