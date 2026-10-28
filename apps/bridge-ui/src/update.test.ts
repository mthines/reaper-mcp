import { describe, expect, it } from 'vitest';
import { compareVersions, controlUrl, updateLog } from './update.js';

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
