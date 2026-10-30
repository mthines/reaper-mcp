import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, hasUserMcpServer, ensureWebInterface, findCloneRoot, isDevClone, updateConfigText, REAPER_ASSETS, KNOWLEDGE_DIRS } from './cli.js';

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
    it('REAPER_ASSETS includes all required files', () => {
      expect(REAPER_ASSETS).toContain('mcp_bridge.lua');
      expect(REAPER_ASSETS).toContain('mcp_analyzer.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_lufs_meter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_correlation_meter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_crest_factor.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_midi_emitter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_manager.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_next.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_prev.lua');
      expect(REAPER_ASSETS).toContain('mcp_snapshot_quick_save.lua');
      expect(REAPER_ASSETS).toContain('mcp_plan_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_actions_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_tracks_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_project_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_items_lib.lua');
      expect(REAPER_ASSETS).toContain('mcp_edit_views_lib.lua');
      expect(REAPER_ASSETS.length).toBe(17);
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

  // Clone-only model: the CLI resolves skills/knowledge from the repo source tree
  // (resolveAssetDir walks up), so dist only carries the bridge + sidecar assets.
  it.skipIf(!distExists)('dist contains all REAPER assets', () => {
    for (const asset of REAPER_ASSETS) {
      expect(existsSync(join(distDir, 'reaper', asset)), `missing reaper/${asset}`).toBe(true);
    }
  });

  it.skipIf(!distExists)('dist does NOT bundle the copy-path assets (clone-only)', () => {
    expect(existsSync(join(distDir, 'knowledge'))).toBe(false);
    expect(existsSync(join(distDir, 'claude-skills'))).toBe(false);
    expect(existsSync(join(distDir, 'claude-rules'))).toBe(false);
  });

  it('mixer skill + memory protocol resolve from the repo source tree', () => {
    expect(existsSync(join(workspaceRoot, '.claude', 'skills', 'mixer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'knowledge', 'reference', 'memory-protocol.md'))).toBe(true);
  });

  it.skipIf(!distExists)('main.js does not contain node_modules paths', () => {
    const mainJs = readFileSync(join(distDir, 'main.js'), 'utf-8');
    expect(mainJs).not.toContain('node_modules');
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
