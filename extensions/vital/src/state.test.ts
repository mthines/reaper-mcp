import { describe, it, expect } from 'vitest';
import { buildVitalState, parseVitalState } from './state.js';
import { makeVitalState, samplePatch } from './__fixtures__/vital-state.js';

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

describe('Vital state', () => {
  it('reads the patch out of a state the way Vital lays it out', () => {
    const r = parseVitalState(makeVitalState(samplePatch()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patch.preset_name).toBe('Init');
    expect(r.value.patch.settings['osc_1_level']).toBe(0.7071067690849304);
    expect(r.value.patch.settings.modulations[0]).toEqual({ source: 'velocity', destination: 'osc_1_level' });
  });

  it('writes an unchanged patch back as the identical bytes', () => {
    const state = makeVitalState(samplePatch());
    const r = parseVitalState(state);
    if (!r.ok) throw new Error(r.error);
    expect(Array.from(buildVitalState(r.value, r.value.patch))).toEqual(Array.from(state));
  });

  it('after a longer edit, the plugin sizes follow and the bytes around the JSON are untouched', () => {
    const state = makeVitalState(samplePatch());
    const r = parseVitalState(state);
    if (!r.ok) throw new Error(r.error);
    const edited = { ...r.value.patch, preset_name: 'A much longer preset name than before', settings: { ...r.value.patch.settings, osc_1_level: 0.123 } };
    const out = buildVitalState(r.value, edited);
    const delta = out.length - state.length;
    expect(delta).toBeGreaterThan(0);

    const again = parseVitalState(out);
    expect(again.ok && again.value.patch.preset_name).toBe('A much longer preset name than before');
    expect(again.ok && again.value.patch.settings['osc_1_level']).toBe(0.123);
    if (!again.ok) return;
    // chunk size (just before the JSON) and bank byte size (to the end of the state) both grew by the same amount
    expect(u32be(out, again.value.jsonStart - 4)).toBe(u32be(state, r.value.jsonStart - 4) + delta);
    expect(u32be(out, again.value.bankOffset + 4) + again.value.bankOffset + 8).toBe(out.length);
    // trailer and wrapper survive byte for byte
    expect(Array.from(out.slice(out.length - 40))).toEqual(Array.from(state.slice(state.length - 40)));
    expect(Array.from(out.slice(0, 32))).toEqual(Array.from(state.slice(0, 32)));
  });

  it('after a shorter edit the sizes shrink and the state still parses', () => {
    const state = makeVitalState(samplePatch());
    const r = parseVitalState(state);
    if (!r.ok) throw new Error(r.error);
    const shorter = { ...r.value.patch, author: undefined, comments: undefined };
    const out = buildVitalState(r.value, shorter);
    expect(out.length).toBeLessThan(state.length);
    const again = parseVitalState(out);
    expect(again.ok && u32be(out, again.value.bankOffset + 4) + again.value.bankOffset + 8).toBe(out.length);
  });

  it('handles braces and escaped quotes inside strings when finding where the JSON ends', () => {
    const patch = samplePatch();
    patch.comments = 'a } brace, a { brace and an \\" escaped quote \\\\';
    const r = parseVitalState(makeVitalState(patch));
    expect(r.ok && r.value.patch.comments).toBe(patch.comments);
  });

  it.each([
    ['something that is not a Vital state', new Uint8Array(500).fill(1), /not the state layout Vital writes/],
    ['a state cut short', makeVitalState(samplePatch()).slice(0, 400), /does not fit|not complete|Could not find/],
  ])('refuses %s with a reason', (_label, bytes, why) => {
    const r = parseVitalState(bytes);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(why);
  });

  it('refuses JSON that is not a Vital patch', () => {
    const r = parseVitalState(makeVitalState({ settings: { wavetables: [], lfos: [] } } as never));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('no Vital settings');
  });
});
