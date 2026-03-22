import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveAssetDir, copyDirSync, installFile, createMcpJson, REAPER_ASSETS, KNOWLEDGE_DIRS } from './cli.js';

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
    it('creates .mcp.json with correct config', () => {
      const path = join(tmp, '.mcp.json');

      expect(createMcpJson(path)).toBe(true);

      const content = JSON.parse(readFileSync(path, 'utf-8'));
      expect(content.mcpServers.reaper.command).toBe('npx');
      expect(content.mcpServers.reaper.args).toEqual(['@mthines/reaper-mcp', 'serve']);
    });

    it('returns false when file already exists', () => {
      const path = join(tmp, '.mcp.json');
      writeFileSync(path, '{}');

      expect(createMcpJson(path)).toBe(false);
    });
  });

  describe('constants', () => {
    it('REAPER_ASSETS includes all required files', () => {
      expect(REAPER_ASSETS).toContain('mcp_bridge.lua');
      expect(REAPER_ASSETS).toContain('mcp_analyzer.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_lufs_meter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_correlation_meter.jsfx');
      expect(REAPER_ASSETS).toContain('mcp_crest_factor.jsfx');
      expect(REAPER_ASSETS.length).toBe(5);
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

  it.skipIf(!distExists)('dist contains package.json with files whitelist', () => {
    const pkg = JSON.parse(readFileSync(join(distDir, 'package.json'), 'utf-8'));
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain('main.js');
    expect(pkg.files).toContain('reaper/**');
    expect(pkg.files).toContain('knowledge/**');
    expect(pkg.files).toContain('claude-agents/**');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).toContain('LICENSE');
  });

  it.skipIf(!distExists)('dist contains all REAPER assets', () => {
    for (const asset of REAPER_ASSETS) {
      expect(existsSync(join(distDir, 'reaper', asset)), `missing reaper/${asset}`).toBe(true);
    }
  });

  it.skipIf(!distExists)('dist contains knowledge directories', () => {
    for (const dir of KNOWLEDGE_DIRS) {
      expect(existsSync(join(distDir, 'knowledge', dir)), `missing knowledge/${dir}`).toBe(true);
    }
  });

  it.skipIf(!distExists)('dist contains README.md', () => {
    expect(existsSync(join(distDir, 'README.md'))).toBe(true);
  });

  it.skipIf(!distExists)('dist contains LICENSE', () => {
    expect(existsSync(join(distDir, 'LICENSE'))).toBe(true);
  });

  it.skipIf(!distExists)('dist contains claude-rules', () => {
    expect(existsSync(join(distDir, 'claude-rules'))).toBe(true);
  });

  it.skipIf(!distExists)('dist contains claude-skills', () => {
    expect(existsSync(join(distDir, 'claude-skills'))).toBe(true);
  });

  it.skipIf(!distExists)('dist contains claude-agents', () => {
    expect(existsSync(join(distDir, 'claude-agents'))).toBe(true);
  });

  it.skipIf(!distExists)('dist contains mixer agent', () => {
    expect(existsSync(join(distDir, 'claude-agents', 'mixer.md'))).toBe(true);
  });

  it.skipIf(!distExists)('main.js does not contain node_modules paths', () => {
    const mainJs = readFileSync(join(distDir, 'main.js'), 'utf-8');
    expect(mainJs).not.toContain('node_modules');
  });
});
