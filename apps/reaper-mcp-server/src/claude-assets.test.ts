import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { installClaudeAssets } from './claude-assets.js';

function put(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

describe('installing the mix skills from the npm package', () => {
  let tmp: string;
  let pkg: string;
  let claude: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `reaper-mcp-claude-${randomUUID()}`);
    pkg = join(tmp, 'pkg', 'claude');
    claude = join(tmp, 'home', '.claude');
    put(join(pkg, 'skills', 'mixer', 'SKILL.md'), 'mixer v1');
    put(join(pkg, 'skills', 'learn-plugin', 'SKILL.md'), 'learn v1');
    put(join(pkg, 'agents', 'plugin-researcher.md'), 'researcher v1');
    put(join(pkg, 'knowledge', 'genres', 'metal.md'), 'metal v1');
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('puts the skills, agents and knowledge where Claude Code finds them', () => {
    const r = installClaudeAssets(pkg, claude);
    expect(readFileSync(join(claude, 'skills', 'learn-plugin', 'SKILL.md'), 'utf-8')).toBe('learn v1');
    expect(readFileSync(join(claude, 'agents', 'plugin-researcher.md'), 'utf-8')).toBe('researcher v1');
    expect(readFileSync(join(claude, 'knowledge', 'genres', 'metal.md'), 'utf-8')).toBe('metal v1');
    expect(r.installed).toHaveLength(4);
  });

  it('is a no-op the second time', () => {
    installClaudeAssets(pkg, claude);
    const r = installClaudeAssets(pkg, claude);
    expect(r.installed).toEqual([]);
    expect(r.updated).toEqual([]);
    expect(r.unchanged).toBe(4);
  });

  it('brings in the newer version of files the user has not touched', () => {
    installClaudeAssets(pkg, claude);
    put(join(pkg, 'skills', 'mixer', 'SKILL.md'), 'mixer v2');
    const r = installClaudeAssets(pkg, claude);
    expect(readFileSync(join(claude, 'skills', 'mixer', 'SKILL.md'), 'utf-8')).toBe('mixer v2');
    expect(r.updated).toHaveLength(1);
  });

  it('keeps a file the user edited and says so', () => {
    installClaudeAssets(pkg, claude);
    put(join(claude, 'knowledge', 'genres', 'metal.md'), 'my own metal notes');
    put(join(pkg, 'knowledge', 'genres', 'metal.md'), 'metal v2');
    const r = installClaudeAssets(pkg, claude);
    expect(readFileSync(join(claude, 'knowledge', 'genres', 'metal.md'), 'utf-8')).toBe('my own metal notes');
    expect(r.skipped).toEqual([{ path: join('knowledge', 'genres', 'metal.md'), reason: 'edited' }]);
  });

  it('never overwrites a skill of the same name the user wrote themselves', () => {
    put(join(claude, 'skills', 'mixer', 'SKILL.md'), 'their mixer');
    const r = installClaudeAssets(pkg, claude);
    expect(readFileSync(join(claude, 'skills', 'mixer', 'SKILL.md'), 'utf-8')).toBe('their mixer');
    expect(r.skipped.map((s) => s.reason)).toContain('not-ours');
  });

  it('leaves files the user added to knowledge alone', () => {
    installClaudeAssets(pkg, claude);
    put(join(claude, 'knowledge', 'plugins', 'my-plugin.md'), 'learned');
    installClaudeAssets(pkg, claude);
    expect(readFileSync(join(claude, 'knowledge', 'plugins', 'my-plugin.md'), 'utf-8')).toBe('learned');
  });

  it('does nothing inside a folder a clone has symlinked', () => {
    const repoKnowledge = join(tmp, 'clone', 'knowledge');
    put(join(repoKnowledge, 'genres', 'metal.md'), 'clone metal');
    mkdirSync(claude, { recursive: true });
    symlinkSync(repoKnowledge, join(claude, 'knowledge'));
    const r = installClaudeAssets(pkg, claude);
    expect(readFileSync(join(repoKnowledge, 'genres', 'metal.md'), 'utf-8')).toBe('clone metal');
    expect(r.skipped).toEqual([{ path: join(claude, 'knowledge'), reason: 'symlink' }]);
  });

  it('writes nothing on a dry run', () => {
    const r = installClaudeAssets(pkg, claude, { dryRun: true });
    expect(r.installed).toHaveLength(4);
    expect(existsSync(claude)).toBe(false);
  });
});
