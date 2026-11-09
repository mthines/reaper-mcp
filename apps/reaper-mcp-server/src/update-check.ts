import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { compareVersions } from './version.js';

/**
 * Whether a newer release is on npm, for an npm install. `init` registers the server by absolute path to
 * the global install and nothing ever updates it, so people stay on the release they installed: fixes and
 * new tools never reach them. The status page's update pill only exists from v0.81.0 and only shows while
 * the page is open, so the server asks npm itself, at most once a day, and tells the user through the agent
 * (notices.ts) at most once a day.
 */

export const NPM_PACKAGE = '@mthines/reaper-mcp';
const LATEST_URL = 'https://registry.npmjs.org/@mthines%2Freaper-mcp/latest';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
  /** When npm was last asked (ms since epoch), whether or not it answered */
  checkedAt?: number;
  /** The latest release npm named then */
  latest?: string;
  /** When the user was last told about a newer release */
  notifiedAt?: number;
}

export function defaultUpdateStatePath(): string {
  return join(homedir(), '.reaper-mcp', 'update-check.json');
}

/** Off with REAPER_MCP_UPDATE_CHECK=0 (or false/off/no), NO_UPDATE_NOTIFIER (the common convention) or in CI. */
export function updateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = (env['REAPER_MCP_UPDATE_CHECK'] ?? '').trim().toLowerCase();
  return ['0', 'false', 'off', 'no'].includes(setting) || Boolean(env['NO_UPDATE_NOTIFIER']) || Boolean(env['CI']);
}

/** The version npm's `latest` tag points at; undefined when npm can't be reached in time. */
export async function fetchLatestVersion(fetchImpl: typeof fetch = fetch, timeoutMs = 3000): Promise<string | undefined> {
  try {
    const res = await fetchImpl(LATEST_URL, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' && /^\d+\.\d+\.\d+/.test(body.version) ? body.version : undefined;
  } catch {
    return undefined;
  }
}

export function updateNotice(current: string, latest: string): string {
  return `reaper-mcp ${latest} is out (this is ${current}). To update, run in a terminal: npm install -g ${NPM_PACKAGE}@latest, ` +
    'then restart Claude Code (or run /mcp). The next start updates the REAPER side too.';
}

function readState(path: string): UpdateCheckState {
  try {
    const s = JSON.parse(readFileSync(path, 'utf-8')) as UpdateCheckState;
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeState(path: string, state: UpdateCheckState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state) + '\n', 'utf-8');
  } catch {
    // A read-only home only means asking npm again next time
  }
}

export interface UpdateAvailable {
  latest: string;
  /** What to tell the user */
  text: string;
  /** Record that the user was told, so the next day's sessions stay quiet until then */
  markNotified: () => void;
}

/**
 * A newer release than `current`, or undefined: when there is none, when the user was told within the last
 * day, or when npm can't be reached. npm is asked only when the last answer is a day old (the answer is
 * kept in `statePath`, ~/.reaper-mcp/update-check.json), so most starts read a file and make no request.
 */
export async function checkForUpdate(opts: {
  current: string;
  statePath?: string;
  now?: number;
  fetchLatest?: () => Promise<string | undefined>;
}): Promise<UpdateAvailable | undefined> {
  const statePath = opts.statePath ?? defaultUpdateStatePath();
  const now = opts.now ?? Date.now();
  const state = readState(statePath);
  if (state.notifiedAt !== undefined && now - state.notifiedAt < DAY_MS) return undefined;

  let latest = state.latest;
  if (state.checkedAt === undefined || now - state.checkedAt >= DAY_MS) {
    latest = (await (opts.fetchLatest ?? fetchLatestVersion)()) ?? latest;
    writeState(statePath, { ...state, checkedAt: now, ...(latest ? { latest } : {}) });
  }
  if (!latest || compareVersions(latest, opts.current) <= 0) return undefined;
  return {
    latest,
    text: updateNotice(opts.current, latest),
    markNotified: () => writeState(statePath, { ...readState(statePath), notifiedAt: Date.now() }),
  };
}
