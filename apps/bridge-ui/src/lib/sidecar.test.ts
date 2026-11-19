import { describe, expect, it } from 'vitest';
import { missingSidecar } from './sidecar.js';
import type { CommandEntry } from './commands.js';

const entry = (n: number, c: string, ok: boolean, e?: string): CommandEntry => ({ n, t: n, c, ms: 5, ok: ok as never, ...(e ? { e } : {}) }) as CommandEntry;

describe('missingSidecar', () => {
  it('names the tool and the command a failed call asked for', () => {
    const got = missingSidecar([entry(2, 'separate_stems', false, 'Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation')]);
    expect(got).toEqual({ command: 'reaper-mcp setup-sidecar --with-separation', tool: 'separate_stems' });
  });

  it('falls back to the plain install command', () => {
    expect(missingSidecar([entry(1, 'detect_key', false, 'Python sidecar not installed. Run in a terminal: reaper-mcp setup-sidecar')])?.command).toBe('reaper-mcp setup-sidecar');
  });

  it('goes away once the tool that failed has worked since', () => {
    expect(missingSidecar([entry(3, 'detect_key', true), entry(2, 'detect_key', false, 'Audio understanding sidecar not installed.')])).toBeNull();
  });

  it('stays when only another tool has worked (it may not need the missing part)', () => {
    const got = missingSidecar([entry(3, 'measure_masking', true), entry(2, 'separate_stems', false, 'Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation')]);
    expect(got?.command).toBe('reaper-mcp setup-sidecar --with-separation');
  });

  it('asks for the core-only install when the tool names --without-aesthetics', async () => {
    const { sidecarAction, sidecarCommandFor } = await import('./sidecar.js');
    expect(sidecarAction('reaper-mcp setup-sidecar --without-aesthetics')).toBe('sidecarlite');
    expect(sidecarCommandFor('sidecarlite')).toBe('reaper-mcp setup-sidecar --without-aesthetics');
  });

  it('ignores ordinary failures', () => {
    expect(missingSidecar([entry(1, 'set_track_property', false, 'Track 9 not found')])).toBeNull();
  });
});
