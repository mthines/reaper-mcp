import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireBuild, runBuiltSuites, machine } from './cli-sandbox.js';
import { TELEMETRY_NOTICE, renderTelemetryNotice } from './telemetry-consent.js';
import { createUi, stripAnsi } from './terminal-ui.js';

/**
 * `reaper-mcp setup` and `reaper-mcp telemetry` as a user runs them: the built package, an empty HOME and a REAPER folder
 * of its own. What they print is snapshotted (src/__snapshots__/cli-output.*.txt, paths and asset counts normalised).
 * Needs the build (`pnpm nx build reaper-mcp-server`); CI builds before it tests. Without a build the suite is skipped locally and fails in CI.
 */
describe.skipIf(!runBuiltSuites)('reaper-mcp setup and telemetry, run as a user would', () => {
  let sandbox: string;

  beforeAll(() => {
    requireBuild();
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'reaper-mcp-cli-')));
  });
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  it('installs the bridge into REAPER and says what is left to do', async () => {
    const m = machine(sandbox, 'setup', [], { reaperIni: true });
    const r = m.run('setup');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/cli-output.setup.txt');

    const scripts = join(m.reaper, 'Scripts');
    expect(existsSync(join(scripts, 'mcp_bridge.lua'))).toBe(true);
    expect(readFileSync(join(scripts, '__startup.lua'), 'utf-8')).toContain('mcp_bridge');
    expect(readFileSync(join(m.reaper, 'reaper.ini'), 'utf-8')).toContain('mcp_bridge.html');
  });

  it('says so when run again, and writes nothing twice', async () => {
    const m = machine(sandbox, 'setup-again', [], { reaperIni: true });
    m.run('setup');
    const second = m.run('setup');
    expect(second.code).toBe(0);
    await expect(second.out).toMatchFileSnapshot('./__snapshots__/cli-output.setup-again.txt');
  });

  it('keeps setup to one line per step, and lists every file with --verbose', () => {
    const quiet = machine(sandbox, 'setup-quiet', [], { reaperIni: true }).run('setup');
    expect(quiet.out.split('\n').length).toBeLessThan(50);
    expect(quiet.out).not.toMatch(/Installed: mcp_bridge\.lua/);

    const verbose = machine(sandbox, 'setup-verbose', [], { reaperIni: true }).run('setup', '--verbose');
    expect(verbose.out).toMatch(/Installed: mcp_bridge\.lua/);
    expect(verbose.out).toMatch(/Installed: reaper-mcp\/mcp_analyzer\.jsfx/);
  });

  it('points at the missing REAPER settings file instead of failing when REAPER never ran', async () => {
    const m = machine(sandbox, 'setup-fresh', []);
    const r = m.run('setup');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/cli-output.setup-fresh.txt');
  });

  it('reports the telemetry state in plain lines a script can read', async () => {
    const m = machine(sandbox, 'telemetry', []);
    const r = m.run('telemetry', 'status');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/cli-output.telemetry-status.txt');
  });

  it('refuses an unknown telemetry command and shows the usage', () => {
    const r = machine(sandbox, 'telemetry-usage', []).run('telemetry', 'sideways');
    expect(r.code).toBe(1);
    expect(r.out).toBe('Usage: reaper-mcp telemetry [status|on|off]\n');
  });
});

describe('the first-run telemetry notice', () => {
  it('says the same words with or without colour', () => {
    const coloured = renderTelemetryNotice(createUi({ level: 3, tty: false }));
    expect(coloured).not.toBe(TELEMETRY_NOTICE);
    expect(stripAnsi(coloured)).toBe(TELEMETRY_NOTICE);
  });

  it('still tells how to opt out and where the details are', () => {
    expect(TELEMETRY_NOTICE).toContain('reaper-mcp telemetry off');
    expect(TELEMETRY_NOTICE).toContain('DO_NOT_TRACK=1');
    expect(TELEMETRY_NOTICE).toMatch(/Details: https:\/\/\S+TELEMETRY\.md/);
  });
});

describe.skipIf(!runBuiltSuites)('reaper-mcp setup --yes, for scripts and agents', () => {
  let sandbox: string;
  beforeAll(() => {
    requireBuild();
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'reaper-mcp-chain-')));
  });
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  it('installs the bridge, connects the harness and runs doctor without asking anything', async () => {
    const m = machine(sandbox, 'yes', ['codex'], { reaperIni: true });
    const r = m.run('setup', '--yes');
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot('./__snapshots__/cli-output.setup-yes.txt');
    expect(existsSync(join(m.reaper, 'Scripts', 'mcp_bridge.lua'))).toBe(true);
    expect(existsSync(join(m.home, '.agents', 'skills', 'mixer', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(m.home, '.codex', 'config.toml'), 'utf-8')).toContain('mcp_servers.reaper');
  });

  it('without --yes and without a terminal, prints the next steps and stops', () => {
    const r = machine(sandbox, 'no-chain', ['codex'], { reaperIni: true }).run('setup');
    expect(r.out).toMatch(/Next steps:/);
    expect(r.out).not.toMatch(/REAPER MCP — Connect|Core\n|Lua bridge/);
  });
});
