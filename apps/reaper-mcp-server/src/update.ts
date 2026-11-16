import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { compareVersions } from './version.js';
import { NPM_PACKAGE, defaultUpdateMarkerPath, fetchLatestVersion, writeUpdateMarker } from './update-check.js';
import { quoteForCmd } from './harnesses.js';

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
  /** The latest GitHub release, the cross-check on npm's list; undefined when GitHub could not be reached */
  released?: () => Promise<string | undefined>;
  /** The version now on disk where `cli` lives, read after the download; undefined when it can't be read */
  installed?: () => string | undefined;
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
  /** Note that this command installed `version`, so the first server start of it can say how it got there (usage telemetry) */
  recordUpdate?: (version: string) => void;
}

/** Exit code: 0 updated (or already current), 1 the download failed or npm was unreachable, 2 it downloaded but setup failed, 3 already current under `bridge`. */
export async function runUpdate(deps: UpdateDeps): Promise<number> {
  const { current, log } = deps;
  log('==> Checking for a new version');
  const latest = await deps.latest();
  const released = await deps.released?.();
  // npm only lists what this computer's route to it lets through. A security tool or proxy that hides new versions
  // looks exactly like "nothing newer", so the release GitHub names is the check on npm's list.
  // Only when npm has nothing to install: if it offers something newer than this install, install that first and report the gap after
  const npmHasNewer = latest !== undefined && compareVersions(latest, current) > 0;
  if (latest !== undefined && released && compareVersions(released, current) > 0 && !npmHasNewer && !deps.force) {
    log(`✗ v${released} is released, but npm only offers v${latest} from this computer, so it cannot be installed.`);
    log('    The release may still be reaching npm (try again in a few minutes), or a security tool or proxy between this computer and npm is hiding new versions (Aikido Device Protection does).');
    log(`    To check: npm install -g ${NPM_PACKAGE}@${released}`);
    return 1;
  }
  if (!latest) {
    log('✗ Could not find a version npm can install. Either npm is unreachable (check your internet connection), or the newest release is not published there yet. Try again later.');
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
  const onDisk = deps.installed?.();
  if (onDisk !== undefined && compareVersions(onDisk, latest) !== 0) {
    log(`✗ npm finished, but v${onDisk} is still the installed version, not v${latest}. Nothing was changed in REAPER.`);
    log(`    Run this in a terminal to see what npm says: npm install -g ${NPM_PACKAGE}@${latest}`);
    return 1;
  }
  // The new release is on disk now, whatever setup does next: its first start reports how it was installed
  deps.recordUpdate?.(latest);
  log('==> Installing into REAPER');
  if ((await deps.run(deps.node, [deps.cli, 'setup', '--yes'])) !== 0) {
    log('✗ The new version downloaded, but installing it into REAPER failed. Run this in a terminal to see why:');
    log('    reaper-mcp setup');
    return 2;
  }
  log(`✓ Updated to v${latest}`);
  if (released && compareVersions(released, latest) > 0) {
    log(`    v${released} is released too, but npm does not offer it from this computer yet (it may still be reaching npm, or a security tool is hiding it). Run the update again later.`);
  }
  return 0;
}

/** The latest GitHub release's version, undefined when GitHub can't be reached in time (rate limit, offline). */
export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch, timeoutMs = 3000): Promise<string | undefined> {
  try {
    const res = await fetchImpl('https://api.github.com/repos/mthines/reaper-mcp/releases/latest', {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return undefined;
    const tag = ((await res.json()) as { tag_name?: unknown }).tag_name;
    const version = typeof tag === 'string' ? tag.replace(/^v/, '') : '';
    return /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
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
        // npm is a .cmd shim on Windows, which Node refuses to spawn without a shell; a shell joins the arguments, so quote each
        const win = process.platform === 'win32';
        const child = spawn(win ? quoteForCmd(command) : command, win ? args.map(quoteForCmd) : args, {
          shell: win,
          stdio: ['ignore', 'inherit', 'inherit'],
          // The node that runs this first on PATH: npm's own shebang and the child reaper-mcp find it
          env: { ...process.env, PATH: `${nodeDir}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}` },
        });
        child.on('error', () => resolve(1));
        child.on('close', (code) => resolve(code ?? 1));
      }),
    released: () => fetchLatestRelease(fetch, 10_000),
    installed: () => {
      try {
        const version = (JSON.parse(readFileSync(join(dirname(cli), 'package.json'), 'utf-8')) as { version?: unknown }).version;
        return typeof version === 'string' ? version : undefined;
      } catch {
        return undefined;
      }
    },
    npm: existsSync(npmBeside) ? npmBeside : 'npm',
    node: process.execPath,
    cli,
    log: (line) => console.log(line),
    force,
    bridge,
    recordUpdate: (version) => writeUpdateMarker(defaultUpdateMarkerPath(), { via: bridge ? 'bridge_page' : 'cli', to: version }),
  };
}
