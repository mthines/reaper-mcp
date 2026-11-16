import { readFileSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { findCloneRoot } from './cli.js';
import { NPM_PACKAGE, cachedUpdateAvailable, defaultUpdateMarkerPath, defaultUpdateStatePath, takeUpdateMarker, updateCheckDisabled, type UpdateVia } from './update-check.js';

/**
 * How this copy of reaper-mcp was installed and whether it keeps up with releases, as closed values for the
 * startup span (usage telemetry keeps them: ALLOWED_SPAN_ATTRIBUTES). `service.version` says which release
 * people run, but not why someone stays on an old one: a global install that nobody updates, an npx config
 * pinned to a version, or an update that was offered and never taken. Never a path or the spec itself.
 */

/** Where the running code lives: npx's cache, a global npm install, a git clone, or anything else (project-local, pnpm, bun). */
export type InstallMethod = 'npx' | 'npm_global' | 'clone' | 'other';

/** What an npx install asked for: a fixed version, a range, `@latest`, no version, or another dist-tag (`@beta`). `none` for every other method. */
export type InstallPin = 'exact' | 'range' | 'latest' | 'unversioned' | 'tag' | 'none';

export interface InstallContext {
  /** The folder of the running code, symlinks resolved (the package root in an npm install) */
  dir: string;
  isClone: boolean;
  env: NodeJS.ProcessEnv;
  /** process.execPath */
  execPath: string;
  platform: NodeJS.Platform;
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

/** The npx cache folder (`…/_npx/<hash>`) the code runs from, or undefined when it does not run from one. */
export function npxRoot(dir: string, platform: NodeJS.Platform): string | undefined {
  const p = pathApi(platform);
  const parts = dir.split(p.sep);
  const i = parts.lastIndexOf('_npx');
  return i >= 0 && i + 1 < parts.length ? parts.slice(0, i + 2).join(p.sep) : undefined;
}

/**
 * A global npm install: `<prefix>/lib/node_modules/@mthines/reaper-mcp` on macOS and Linux (any prefix:
 * Homebrew, nvm, Volta, a custom one), `<prefix>\node_modules\@mthines\reaper-mcp` on Windows, where the
 * prefix is `%APPDATA%\npm` or the folder of node itself (nvm-windows, the zip install).
 */
function isGlobalNpm(ctx: InstallContext): boolean {
  const p = pathApi(ctx.platform);
  const pkgTail = p.join('node_modules', ...NPM_PACKAGE.split('/'));
  if (ctx.platform !== 'win32') return ctx.dir.endsWith(p.sep + p.join('lib', pkgTail));
  const dir = ctx.dir.toLowerCase();
  const prefixes = [p.dirname(ctx.execPath), ctx.env['APPDATA'] ? p.join(ctx.env['APPDATA'], 'npm') : undefined];
  return prefixes.some((prefix) => prefix !== undefined && dir === p.join(prefix, pkgTail).toLowerCase());
}

export function installMethod(ctx: InstallContext): InstallMethod {
  if (ctx.isClone) return 'clone';
  if (npxRoot(ctx.dir, ctx.platform)) return 'npx';
  if (isGlobalNpm(ctx)) return 'npm_global';
  // npx found a copy somewhere else (a project's node_modules) and started that
  return ctx.env['npm_command'] === 'exec' ? 'npx' : 'other';
}

/** The class of what was asked for after the package name: `''`, `@latest`, `@0.85.0`, `@^0.85`, `@beta`. */
export function classifySpec(spec: string): Exclude<InstallPin, 'none'> | undefined {
  if (!spec.startsWith(NPM_PACKAGE)) return undefined;
  const rest = spec.slice(NPM_PACKAGE.length);
  if (rest === '') return 'unversioned';
  if (!rest.startsWith('@')) return undefined;
  const version = rest.slice(1).trim();
  if (version === '') return 'unversioned';
  if (version === 'latest') return 'latest';
  if (/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) return 'exact';
  if (/^[\^~<>=*xX\d]/.test(version) || version.includes('||') || / - /.test(version)) return 'range';
  return 'tag';
}

/**
 * What an npx install asked for. npx writes the specs as typed into `_npx.packages` of its cache folder's
 * package.json (npm 7+); the environment carries the spec only for `npx --package=…` (`npm_config_package`),
 * never for the plain `npx @mthines/reaper-mcp@0.85.0 serve` an MCP config uses. Undefined when npx's
 * folder can't be read, so a guess is never sent.
 */
export function installPin(ctx: InstallContext, method: InstallMethod, readFile: (path: string) => string = (path) => readFileSync(path, 'utf-8')): InstallPin | undefined {
  if (method !== 'npx') return 'none';
  const specs: string[] = [];
  const root = npxRoot(ctx.dir, ctx.platform);
  if (root) {
    try {
      const pkg = JSON.parse(readFile(pathApi(ctx.platform).join(root, 'package.json'))) as { _npx?: { packages?: unknown } };
      const packages = pkg._npx?.packages;
      if (Array.isArray(packages)) specs.push(...packages.filter((s): s is string => typeof s === 'string'));
    } catch {
      // Unreadable: fall through to the environment
    }
  }
  if (ctx.env['npm_config_package']) specs.push(...ctx.env['npm_config_package'].split(/[\n,]/));
  for (const spec of specs) {
    const pin = classifySpec(spec.trim());
    if (pin) return pin;
  }
  return undefined;
}

export interface InstallInfo {
  method: InstallMethod;
  pin?: InstallPin;
  /** Whether npm's latest release (as last asked, update-check.json) is newer than this one; undefined when not known */
  updateAvailable?: boolean;
  /** How this release was installed, on the first start after `reaper-mcp update` */
  via?: UpdateVia;
}

/** The startup span's install attributes; each is left out when it is not known. */
export function installAttributes(info: InstallInfo): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = { 'reaper.install.method': info.method };
  if (info.pin !== undefined) attrs['reaper.install.pin'] = info.pin;
  if (info.updateAvailable !== undefined) attrs['reaper.update.available'] = info.updateAvailable;
  if (info.via !== undefined) attrs['reaper.update.via'] = info.via;
  return attrs;
}

/**
 * This process's install info, for `serve`. Never throws. Takes the update marker (`reaper-mcp update` leaves
 * it), so only the first start of the new release reports how it got there. The update check never runs in a
 * clone or when it is turned off, so `updateAvailable` is left out there.
 */
export function readInstallInfo(
  codeDir: string,
  current: string,
  env: NodeJS.ProcessEnv = process.env,
  paths: { statePath: string; markerPath: string } = { statePath: defaultUpdateStatePath(), markerPath: defaultUpdateMarkerPath() },
): InstallInfo {
  let dir = codeDir;
  try {
    dir = realpathSync(codeDir);
  } catch {
    // Keep the unresolved path
  }
  const ctx: InstallContext = { dir, isClone: findCloneRoot(dir) !== null, env, execPath: process.execPath, platform: process.platform };
  const method = installMethod(ctx);
  let pin: InstallPin | undefined;
  try {
    pin = installPin(ctx, method);
  } catch {
    pin = undefined;
  }
  const checks = !ctx.isClone && !updateCheckDisabled(env);
  return {
    method,
    pin,
    updateAvailable: checks ? cachedUpdateAvailable(current, paths.statePath) : undefined,
    via: takeUpdateMarker(paths.markerPath, current),
  };
}
