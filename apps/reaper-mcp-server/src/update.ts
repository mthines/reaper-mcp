import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { compareVersions } from './version.js';
import { NPM_PACKAGE, fetchLatestVersion } from './update-check.js';

/**
 * `reaper-mcp update`: bring an npm install up to the latest release without a terminal session of the user's own.
 * The bridge page's Update button runs exactly this (the bridge starts it detached and shows its output), so every
 * line printed here is read by a person who may never have opened a terminal: plain words, no jargon.
 *
 * Two steps, the same two a person would type: `npm install -g @mthines/reaper-mcp@latest`, then `reaper-mcp setup --yes`
 * in a fresh process (the new files, not the ones this process loaded). A clone updates through scripts/update.sh instead.
 */

export interface UpdateDeps {
  /** The version running now */
  current: string;
  /** The latest version npm names, undefined when npm could not be reached */
  latest: () => Promise<string | undefined>;
  /** Run a command, streaming its output to ours; resolves to its exit code */
  run: (command: string, args: string[]) => Promise<number>;
  /** npm, next to the node that runs this (a bare PATH must not matter) */
  npm: string;
  /** This node binary and the CLI entry the new install replaces in place */
  node: string;
  cli: string;
  log: (line: string) => void;
  /** Update even when npm names nothing newer */
  force?: boolean;
  /** Run by the bridge: "nothing newer" exits 3, so the page can tell it from an install */
  bridge?: boolean;
}

/** Exit code: 0 updated (or already current), 1 the download failed or npm was unreachable, 2 it downloaded but setup failed, 3 already current under `bridge`. */
export async function runUpdate(deps: UpdateDeps): Promise<number> {
  const { current, log } = deps;
  log('==> Checking for a new version');
  const latest = await deps.latest();
  if (!latest) {
    log('✗ Could not reach npm to look for a new version. Check your internet connection and try again.');
    return 1;
  }
  if (!deps.force && compareVersions(latest, current) <= 0) {
    log(`✓ Already on the latest version (v${current})`);
    return deps.bridge ? 3 : 0;
  }
  log(`    v${current} → v${latest}`);
  log('==> Downloading the new version');
  if ((await deps.run(deps.npm, ['install', '-g', `${NPM_PACKAGE}@${latest}`])) !== 0) {
    log('✗ The download did not finish. If npm asked for permission, run this once in a terminal:');
    log(`    npm install -g ${NPM_PACKAGE}@latest`);
    return 1;
  }
  log('==> Installing into REAPER');
  if ((await deps.run(deps.node, [deps.cli, 'setup', '--yes'])) !== 0) {
    log('✗ The new version downloaded, but installing it into REAPER failed. Run this in a terminal to see why:');
    log('    reaper-mcp setup');
    return 2;
  }
  log(`✓ Updated to v${latest}`);
  return 0;
}

/** The real dependencies: npm beside this node, output passed through line by line. */
export function realUpdateDeps(current: string, cli: string, force = false, bridge = false): UpdateDeps {
  const nodeDir = dirname(process.execPath);
  const npmBeside = join(nodeDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return {
    current,
    latest: () => fetchLatestVersion(fetch, 10_000),
    run: (command, args) =>
      new Promise((resolve) => {
        const child = spawn(command, args, {
          stdio: ['ignore', 'inherit', 'inherit'],
          // The node that runs this first on PATH: npm's own shebang and the child reaper-mcp find it
          env: { ...process.env, PATH: `${nodeDir}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}` },
        });
        child.on('error', () => resolve(1));
        child.on('close', (code) => resolve(code ?? 1));
      }),
    npm: existsSync(npmBeside) ? npmBeside : 'npm',
    node: process.execPath,
    cli,
    log: (line) => console.log(line),
    force,
    bridge,
  };
}
