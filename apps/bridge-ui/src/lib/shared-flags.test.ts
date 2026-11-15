import { describe, expect, it } from 'vitest';
import { parseSharedFlags, saveSharedFlagsUrl } from './shared-flags.js';

const reply = (value: unknown) => `EXTSTATE\tMCPBridge\tflag_overrides\t${JSON.stringify(value)}\n`;

describe('shared feature-flag overrides', () => {
  it('reads the overrides the bridge published and the request it last handled', () => {
    expect(parseSharedFlags(reply({ v: 1, overrides: { 'new-panel': 'on' }, req: '12', writable: true }))).toEqual({
      overrides: { 'new-panel': 'on' },
      req: '12',
      writable: true,
    });
  });

  it('reads a missing map as no overrides, and a bridge with no home folder as not writable', () => {
    expect(parseSharedFlags(reply({ v: 1, writable: false }))).toEqual({ overrides: {}, req: null, writable: false });
  });

  it('keeps only string variants', () => {
    expect(parseSharedFlags(reply({ v: 1, overrides: { a: 'on', b: 1, c: null }, writable: true }))?.overrides).toEqual({ a: 'on' });
  });

  it('reads nothing from a bridge that predates it', () => {
    expect(parseSharedFlags('EXTSTATE\tMCPBridge\tflag_overrides\t\n')).toBeNull();
  });

  it('sends the whole map hex-encoded behind the control token', () => {
    expect(saveSharedFlagsUrl('7', 'tok', { 'new-panel': 'on' })).toBe(
      `/_/SET/EXTSTATE/MCPBridge/flags_req/7-tok-${Buffer.from('{"new-panel":"on"}').toString('hex')}`,
    );
  });
});
