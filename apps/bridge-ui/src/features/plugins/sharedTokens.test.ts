import { describe, expect, it } from 'vitest';
import { parseSharedTokens, saveSharedTokensUrl } from './sharedTokens.js';

const reply = (value: unknown) => `EXTSTATE\tMCPBridge\tlorekit_tokens\t${JSON.stringify(value)}\n`;

describe('shared LoreKit tokens', () => {
  it('reads both tokens the bridge published', () => {
    expect(parseSharedTokens(reply({ v: 1, read: 'lk_ro_a', publish: 'lk_rw_b', writable: true }))).toEqual({ read: 'lk_ro_a', publish: 'lk_rw_b', writable: true });
  });

  it('reads a missing token as none, and a bridge with no home folder as not writable', () => {
    expect(parseSharedTokens(reply({ v: 1, writable: false }))).toEqual({ read: null, publish: null, writable: false });
  });

  it('reads nothing from a bridge that predates it', () => {
    expect(parseSharedTokens('EXTSTATE\tMCPBridge\tlorekit_tokens\t\n')).toBeNull();
  });

  it('sends the tokens hex-encoded behind the control token, an empty one meaning none', () => {
    expect(saveSharedTokensUrl('7', 'tok', 'lk_ro_a', null)).toBe(`/_/SET/EXTSTATE/MCPBridge/tokens_req/7-tok-${Buffer.from('lk_ro_a').toString('hex')}-`);
  });
});
