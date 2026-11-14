import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test helper (not a test): runs the BUILT package the way an npm user does, outside any clone, in an empty HOME with a
// REAPER resource folder of its own. Needs `pnpm nx build reaper-mcp-server`; CI builds before it tests, and the suites
// that use this skip without a build (and fail in CI).

const here = dirname(fileURLToPath(import.meta.url));
const builtPackage = join(here, '..', '..', '..', 'dist', 'apps', 'reaper-mcp-server');
const serverDeps = join(here, '..', 'node_modules');

export const built = existsSync(join(builtPackage, 'main.js')) && existsSync(join(builtPackage, 'claude', 'skills')) && existsSync(serverDeps);

/** Run the suites that need the build? Locally they are skipped without one; in CI a missing build is a failure, never a silent pass. */
export const runBuiltSuites = built || Boolean(process.env['CI']);

export function requireBuild(): void {
  if (!built) throw new Error('The built package is missing: run `pnpm nx build reaper-mcp-server` first (CI builds before it tests).');
}

/**
 * Stands in for a harness's own command (the real ones need an account and a network). Like them, `mcp add` writes
 * the harness's config file and `mcp remove` takes the entry out again.
 */
const FAKE_HARNESS = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const [group, action, ...rest] = process.argv.slice(2);
if (group !== 'mcp') process.exit(0);
const home = process.env.HOME;
const file = { claude: path.join(home, '.claude.json'), gemini: path.join(home, '.gemini', 'settings.json'), codex: path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml') }[name];
fs.mkdirSync(path.dirname(file), { recursive: true });
if (action === 'remove') { fs.rmSync(file, { force: true }); process.exit(0); }
if (action !== 'add') process.exit(0);
// claude: --scope user reaper -- <node> <main> serve · codex: reaper -- <node> <main> serve · gemini: --scope user reaper <node> <main> serve
const words = rest.filter((w, i) => w !== '--' && !(w === '--scope' || rest[i - 1] === '--scope'));
const [, command, ...args] = words;
if (name === 'codex') fs.writeFileSync(file, '[mcp_servers.reaper]\\ncommand = ' + JSON.stringify(command) + '\\nargs = ' + JSON.stringify(args) + '\\n');
else fs.writeFileSync(file, JSON.stringify({ mcpServers: { reaper: { command, args } } }, null, 2));
`;

export interface Machine {
  home: string;
  /** The REAPER resource folder the package installs into */
  reaper: string;
  run(...args: string[]): { code: number | null; out: string; err: string };
}

export type FakeHarness = 'claude' | 'codex' | 'gemini';

/**
 * A fresh machine under `sandbox/<name>`: an empty HOME, the `installed` harness commands on PATH, Cursor's config
 * folder when asked, and a REAPER resource folder (with a reaper.ini when asked, as after REAPER's first start).
 * PATH holds only those commands and node, so `pgrep` is missing and REAPER never counts as running.
 */
export function machine(sandbox: string, name: string, installed: FakeHarness[] = [], opts: { cursor?: boolean; reaperIni?: boolean } = {}): Machine {
  const root = join(sandbox, name);
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const pkg = join(root, 'npm', 'reaper-mcp');
  const reaper = join(home, 'REAPER');
  mkdirSync(join(home, 'Music'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(reaper, { recursive: true });
  cpSync(builtPackage, pkg, { recursive: true });
  symlinkSync(serverDeps, join(pkg, 'node_modules'));
  // The status page the real package ships (a page and a PWA manifest are enough for setup to install it)
  mkdirSync(join(pkg, 'bridge-ui'), { recursive: true }); // the real build already ships this folder in CI
  writeFileSync(join(pkg, 'bridge-ui', 'mcp_bridge.html'), '<!doctype html>\n');
  writeFileSync(join(pkg, 'bridge-ui', 'mcp_bridge.webmanifest'), '{}\n');
  if (opts.cursor) mkdirSync(join(home, '.cursor'));
  if (opts.reaperIni) writeFileSync(join(reaper, 'reaper.ini'), '[REAPER]\n');
  for (const h of installed) {
    writeFileSync(join(bin, h), FAKE_HARNESS);
    chmodSync(join(bin, h), 0o755);
  }
  // node alone, never its folder: a global npm install puts other CLIs there (a real `claude` would count as installed)
  symlinkSync(process.execPath, join(bin, 'node'));
  const env = { HOME: home, REAPER_RESOURCE_PATH: reaper, REAPER_MCP_TELEMETRY: '0', PATH: bin };
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [join(pkg, 'main.js'), ...args], { cwd: join(home, 'Music'), env, encoding: 'utf-8', timeout: 90_000 });
    return { code: r.status, out: normalise(r.stdout, { home, pkg, root }), err: normalise(r.stderr, { home, pkg, root }) };
  };
  return { home, reaper, run };
}

/** How many skills or assets ship grows with the project, but nothing-versus-something is behaviour: a re-run must say `0 new` */
const nonZero = (n: string) => (n === '0' ? '0' : '<n>');

/** Paths and counts that differ by machine or grow with the project, so a snapshot changes only when the behaviour does */
export function normalise(text: string, p: { home: string; pkg: string; root: string }): string {
  return (
    text
      .split(p.pkg).join('<package>')
      .split(p.home).join('<home>')
      .split(p.root).join('<sandbox>')
      .split(process.execPath).join('<node>')
      .replace(/\(\d+ REAPER tools allow-listed\)/g, '(<n> REAPER tools allow-listed)')
      .replace(/(\d+) (scripts|JSFX files|example plugins) installed/g, '<n> $2 installed')
      .replace(/: (\d+) new, (\d+) updated, (\d+) already current\./g, (_m, a, b, c) => `: ${nonZero(a)} new, ${nonZero(b)} updated, ${nonZero(c)} already current.`)
  );
}
