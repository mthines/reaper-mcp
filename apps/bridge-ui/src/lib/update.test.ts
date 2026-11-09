import { describe, expect, it } from 'vitest';
import { compareVersions, controlUrl, updateLog, updateOffer } from './update.js';

describe('compareVersions', () => {
  it('orders numerically, not as strings', () => {
    expect(compareVersions('0.38.0', '0.9.1')).toBe(1);
    expect(compareVersions('v0.35.0', '0.38.0')).toBe(-1);
    expect(compareVersions('0.38.0', 'v0.38.0')).toBe(0);
    expect(compareVersions('0.9.1-beta.12.1', '0.9.1')).toBe(0);
  });
});

describe('controlUrl', () => {
  it('writes the action and token to the request ExtState', () => {
    expect(controlUrl('update', 'ab12')).toBe('/_/SET/EXTSTATE/MCPBridge/request/update-ab12');
  });
});

describe('updateLog', () => {
  it('treats an empty Lua table as no lines', () => {
    expect(updateLog({ state: 'running', startedAt: 0, log: {} })).toEqual([]);
    expect(updateLog({ state: 'running', startedAt: 0, log: ['a'] })).toEqual(['a']);
  });
});

describe('updateOffer', () => {
  const release = { version: '1.3.0', url: 'https://github.com/mthines/reaper-mcp/releases/tag/v1.3.0' };
  const plain = { dev: false, skipped: null };

  it('offers a newer release', () => {
    expect(updateOffer(release, '1.2.0', plain)).toBe(release);
  });

  it('offers nothing when the install is current or newer', () => {
    expect(updateOffer(release, '1.3.0', plain)).toBeNull();
    expect(updateOffer(release, '1.4.0-beta.1', plain)).toBeNull();
  });

  it('offers nothing to a developer install', () => {
    expect(updateOffer(release, '1.2.0', { dev: true, skipped: null })).toBeNull();
  });

  it('offers nothing while an update runs or after one failed, and offers it again once one finished', () => {
    expect(updateOffer(release, '1.2.0', { ...plain, update: { state: 'running', kind: 'update', startedAt: 0, log: [] } })).toBeNull();
    expect(updateOffer(release, '1.2.0', { ...plain, update: { state: 'failed', kind: 'update', startedAt: 0, log: [] } })).toBeNull();
    expect(updateOffer(release, '1.2.0', { ...plain, update: { state: 'done', kind: 'update', startedAt: 0, log: [] } })).toBe(release);
  });

  it('offers nothing for the version the user skipped, and offers the next one', () => {
    expect(updateOffer(release, '1.2.0', { dev: false, skipped: '1.3.0' })).toBeNull();
    expect(updateOffer({ ...release, version: '1.4.0' }, '1.2.0', { dev: false, skipped: '1.3.0' })).not.toBeNull();
  });
});
