import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, fetchLatestVersion, updateCheckDisabled } from './update-check.js';

const DAY = 24 * 60 * 60 * 1000;
let dir: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'update-check-'));
  statePath = join(dir, 'update-check.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('checkForUpdate', () => {
  it('tells the user the newer release and the command that installs it', async () => {
    const update = await checkForUpdate({ current: '0.66.0', statePath, now: 0, fetchLatest: async () => '0.83.0' });

    expect(update?.latest).toBe('0.83.0');
    expect(update?.text).toContain('reaper-mcp 0.83.0 is out (this is 0.66.0)');
    expect(update?.text).toContain('npm install -g @mthines/reaper-mcp@latest');
  });

  it('stays quiet on the latest release', async () => {
    expect(await checkForUpdate({ current: '0.83.0', statePath, now: 0, fetchLatest: async () => '0.83.0' })).toBeUndefined();
  });

  it('asks npm at most once a day and answers from the saved result in between', async () => {
    const fetchLatest = vi.fn(async () => '0.83.0');

    await checkForUpdate({ current: '0.66.0', statePath, now: 0, fetchLatest });
    const sameDay = await checkForUpdate({ current: '0.66.0', statePath, now: DAY / 2, fetchLatest });
    await checkForUpdate({ current: '0.66.0', statePath, now: DAY + 1, fetchLatest });

    expect(sameDay?.latest).toBe('0.83.0');
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('tells the user at most once a day once the notice went out', async () => {
    const first = await checkForUpdate({ current: '0.66.0', statePath, now: 0, fetchLatest: async () => '0.83.0' });
    first?.markNotified();

    const again = await checkForUpdate({ current: '0.66.0', statePath, now: Date.now() + DAY / 2, fetchLatest: async () => '0.83.0' });
    const nextDay = await checkForUpdate({ current: '0.66.0', statePath, now: Date.now() + DAY + 1, fetchLatest: async () => '0.84.0' });

    expect(again).toBeUndefined();
    expect(nextDay?.latest).toBe('0.84.0');
  });

  it('says nothing when npm cannot be reached', async () => {
    expect(await checkForUpdate({ current: '0.66.0', statePath, now: 0, fetchLatest: async () => undefined })).toBeUndefined();
  });
});

describe('fetchLatestVersion', () => {
  it('reads the version of npm\'s latest tag', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: '@mthines/reaper-mcp', version: '0.83.0' })));
    expect(await fetchLatestVersion(fetchImpl as unknown as typeof fetch)).toBe('0.83.0');
  });

  it('gives up quietly on an error response or a network failure', async () => {
    expect(await fetchLatestVersion((async () => new Response('', { status: 503 })) as unknown as typeof fetch)).toBeUndefined();
    expect(await fetchLatestVersion((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)).toBeUndefined();
  });
});

describe('updateCheckDisabled', () => {
  it('is off with REAPER_MCP_UPDATE_CHECK=0, NO_UPDATE_NOTIFIER or in CI, on otherwise', () => {
    expect(updateCheckDisabled({ REAPER_MCP_UPDATE_CHECK: '0' })).toBe(true);
    expect(updateCheckDisabled({ REAPER_MCP_UPDATE_CHECK: 'off' })).toBe(true);
    expect(updateCheckDisabled({ NO_UPDATE_NOTIFIER: '1' })).toBe(true);
    expect(updateCheckDisabled({ CI: 'true' })).toBe(true);
    expect(updateCheckDisabled({})).toBe(false);
  });
});
