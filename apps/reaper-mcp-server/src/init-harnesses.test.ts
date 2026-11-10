import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireBuild, runBuiltSuites, machine as makeMachine, type FakeHarness } from './cli-sandbox.js';

/**
 * `reaper-mcp init` as a user runs it: the built package, an empty HOME, and the harnesses a machine might have.
 * What it prints is snapshotted (src/__snapshots__/init-harnesses.*.txt, paths and counts normalised), so a change to
 * what the setup says or does shows up in review. The same flow runs against the real Claude Code, Codex CLI and
 * Gemini CLI, and is recorded as docs/assets/harnesses-demo.gif, by scripts/test-harnesses.sh.
 *
 * Needs the build (`pnpm nx build reaper-mcp-server`); CI builds before it tests. Without a build the suite is skipped locally and fails in CI.
 */

describe.skipIf(!runBuiltSuites)('reaper-mcp init, run as a user would', () => {
  let sandbox: string;

  beforeAll(() => {
    requireBuild();
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'reaper-mcp-init-')));
  });
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  const machine = (name: string, installed: FakeHarness[], opts: { cursor?: boolean } = {}) => makeMachine(sandbox, name, installed, opts);

  it('connects every harness it finds and installs the skills where each one reads them', async () => {
    const m = machine('everything', ['claude', 'codex', 'gemini'], { cursor: true });
    const first = m.run('init');
    expect(first.code).toBe(0);
    await expect(first.out).toMatchFileSnapshot('./__snapshots__/init-harnesses.everything.txt');

    for (const dir of ['.claude/skills', '.agents/skills']) expect(existsSync(join(m.home, dir, 'mixer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(m.home, '.claude', 'knowledge'))).toBe(true);
    // the skills read their knowledge from ~/.claude, so the shared folder never gets a second copy
    expect(existsSync(join(m.home, '.agents', 'knowledge'))).toBe(false);

    const doctor = m.run('doctor');
    expect(doctor.out).toMatch(/MCP config\s+Connected: Claude Code, Codex CLI, Gemini CLI, Cursor/);
  });

  it('says so when run again, and changes nothing', async () => {
    const m = machine('again', ['codex', 'gemini'], { cursor: true });
    m.run('init');
    const second = m.run('init');
    expect(second.code).toBe(0);
    await expect(second.out).toMatchFileSnapshot('./__snapshots__/init-harnesses.again.txt');
  });

  it('suggests how to install what is missing, and connects only what is there', async () => {
    const m = machine('only-codex', ['codex']);
    const r = m.run('init');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/init-harnesses.only-codex.txt');
    expect(existsSync(join(m.home, '.agents', 'skills', 'mixer', 'SKILL.md'))).toBe(true);
    // no Claude Code here: nothing is registered for it, but the skills still find the knowledge they read
    expect(existsSync(join(m.home, '.claude.json'))).toBe(false);
    expect(existsSync(join(m.home, '.claude', 'knowledge'))).toBe(true);
    expect(existsSync(join(m.home, '.claude', 'skills'))).toBe(false);
    expect(m.run('doctor').out).toMatch(/✓ Mix skills[\s\S]*✓ Knowledge base/);
  });

  it('tells a machine with no harness where to get one, and writes nothing', async () => {
    const m = machine('nothing', []);
    const r = m.run('init');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/init-harnesses.nothing.txt');
    expect(existsSync(join(m.home, '.claude'))).toBe(false);
    expect(existsSync(join(m.home, '.agents'))).toBe(false);
  });

  it('connects a harness picked by hand even when it is not installed, with the line to type', async () => {
    const m = machine('picked', ['claude']);
    const r = m.run('init', '--harness', 'codex');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/init-harnesses.picked.txt');
  });

  it('refuses an unknown harness and names the valid ones', () => {
    const m = machine('typo', ['codex']);
    const r = m.run('init', '--harness', 'vim');
    expect(r.code).toBe(1);
    expect(r.err).toBe('Unknown harness: vim. Use one or more of: claude, codex, gemini, cursor, or --all.\n');
    expect(r.out).toBe('');
  });
});

/** How many skills ship grows with the project, but nothing-versus-something is behaviour: a re-run must say `0 new` */
const nonZero = (n: string) => (n === '0' ? '0' : '<n>');
