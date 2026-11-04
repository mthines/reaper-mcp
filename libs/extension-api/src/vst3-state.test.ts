import { describe, it, expect } from 'vitest';
import { VST3_HEADER_BYTES, isVst3StateConsistent, isVst3WrapperCoherent, withVst3Lengths } from './vst3-state.js';
import { consistentVst3 } from './__fixtures__/vst3.js';

describe('VST3 state lengths', () => {
  it('a state with both lengths set is consistent, one with either stale is not', () => {
    const { header, state } = consistentVst3(new Uint8Array(100).fill(7));
    expect(isVst3StateConsistent(header, state)).toBe(true);

    const staleHeader = Uint8Array.from(header);
    staleHeader[32] ^= 1;
    expect(isVst3StateConsistent(staleHeader, state)).toBe(false);

    const staleState = Uint8Array.from(state);
    staleState[0] ^= 1;
    expect(isVst3StateConsistent(header, staleState)).toBe(false);
  });

  it('fixes both lengths after the state changed size, leaving every other byte alone', () => {
    const { header, state } = consistentVst3(new Uint8Array(100).fill(7));
    const longer = new Uint8Array(state.length + 50);
    longer.set(state);
    longer.fill(9, state.length);

    const fixed = withVst3Lengths(header, longer);
    expect(isVst3StateConsistent(fixed.header, fixed.state)).toBe(true);
    expect(Array.from(fixed.state.slice(4))).toEqual(Array.from(longer.slice(4)));
    expect(Array.from(fixed.header.slice(0, 32))).toEqual(Array.from(header.slice(0, 32)));
    expect(Array.from(fixed.header.slice(36))).toEqual(Array.from(header.slice(36)));
  });

  it('writes lengths above 16 MB and 2 GB correctly (unsigned, little-endian)', () => {
    const big = new Uint8Array(20_000_000);
    const fixed = withVst3Lengths(new Uint8Array(VST3_HEADER_BYTES), big);
    expect(isVst3StateConsistent(fixed.header, fixed.state)).toBe(true);
  });

  it('does not modify its inputs', () => {
    const header = new Uint8Array(VST3_HEADER_BYTES);
    const state = new Uint8Array(64);
    withVst3Lengths(header, state);
    expect(header.every((b) => b === 0)).toBe(true);
    expect(state.every((b) => b === 0)).toBe(true);
  });

  it('refuses a header of the wrong size and a state too short to hold its prefix', () => {
    expect(() => withVst3Lengths(new Uint8Array(10), new Uint8Array(64))).toThrow(/44 bytes/);
    expect(() => withVst3Lengths(new Uint8Array(VST3_HEADER_BYTES), new Uint8Array(8))).toThrow(/too short/);
  });

  describe('a wrapper we can safely rewrite', () => {
    it('accepts one REAPER wrote and one whose state grew trailing bytes after its lengths were set', () => {
      const { header, state } = consistentVst3(new Uint8Array(100).fill(7));
      expect(isVst3WrapperCoherent(header, state)).toBe(true);
      const grown = new Uint8Array(state.length + 6);
      grown.set(state);
      expect(isVst3WrapperCoherent(header, grown)).toBe(true);
      expect(isVst3StateConsistent(header, grown)).toBe(false);
    });

    it('refuses fields that disagree with each other, or that claim more bytes than the state has', () => {
      const { header, state } = consistentVst3(new Uint8Array(100).fill(7));
      const disagree = Uint8Array.from(state);
      disagree[0] ^= 1;
      expect(isVst3WrapperCoherent(header, disagree)).toBe(false);
      expect(isVst3WrapperCoherent(header, state.slice(0, state.length - 3))).toBe(false);
      expect(isVst3WrapperCoherent(new Uint8Array(10), state)).toBe(false);
    });
  });
});
