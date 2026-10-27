import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstallId } from './telemetry.js';

describe('readInstallId', () => {
  it('creates an id on first run and returns the same one after', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'reaper-mcp-')), 'nested');

    const first = readInstallId(dir);

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(dir, 'install-id'), 'utf-8').trim()).toBe(first);
    expect(readInstallId(dir)).toBe(first);
  });

  it('returns undefined instead of throwing when the dir is unwritable', () => {
    expect(readInstallId('/dev/null/not-a-dir')).toBeUndefined();
  });
});
