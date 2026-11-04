import { describe, it, expect } from 'vitest';
import { applyLfo, applyModulation, applySettings, applyWavetable, summarize } from './patch.js';
import { samplePatch } from './__fixtures__/vital-state.js';
import { buildWavetable, frameFromHarmonics, shapeHarmonics } from './wavetable.js';

describe('settings', () => {
  it('sets known settings and reports what changed, leaving unchanged ones out', () => {
    const p = samplePatch();
    const r = applySettings(p, { osc_1_level: 0.3, filter_1_cutoff: 80 });
    expect(r).toEqual({ ok: true, changed: { osc_1_level: { from: 0.7071067690849304, to: 0.3 } } });
    expect(p.settings['osc_1_level']).toBe(0.3);
  });

  it('refuses an unknown name, suggests close ones and, as the caller discards the patch, nothing is written', () => {
    const r = applySettings(samplePatch(), { osc_1_levl: 0.5, osc_1_level: 0.1 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('osc_1_levl');
    expect(applySettings(samplePatch(), { level: 0.5 }).ok).toBe(false);
    expect(applySettings(samplePatch(), { wavetables: 1 }).ok).toBe(false); // not a plain numeric setting
  });

  it('refuses a value that is not a finite number', () => {
    const r = applySettings(samplePatch(), { osc_1_level: Number.NaN });
    expect(!r.ok && r.error).toContain('finite numbers');
  });
});

describe('modulation matrix', () => {
  it('adds a route in the first free slot with amount 1 unless told otherwise', () => {
    const p = samplePatch();
    const r = applyModulation(p, { source: 'lfo_1', destination: 'filter_1_cutoff' });
    expect(r).toEqual({ ok: true, slot: 2, action: 'added' });
    expect(p.settings.modulations[1]).toEqual({ source: 'lfo_1', destination: 'filter_1_cutoff' });
    expect(p.settings['modulation_2_amount']).toBe(1);
  });

  it('adds with amount, bipolar and power as given', () => {
    const p = samplePatch();
    applyModulation(p, { source: 'env_2', destination: 'osc_2_level', amount: -0.4, bipolar: true, power: 3 });
    expect(p.settings['modulation_2_amount']).toBe(-0.4);
    expect(p.settings['modulation_2_bipolar']).toBe(1);
    expect(p.settings['modulation_2_power']).toBe(3);
  });

  it('updating an existing route changes only what was given and keeps its slot', () => {
    const p = samplePatch();
    const r = applyModulation(p, { source: 'velocity', destination: 'osc_1_level', amount: 0.25 });
    expect(r).toEqual({ ok: true, slot: 1, action: 'updated' });
    expect(p.settings['modulation_1_amount']).toBe(0.25);
    expect(p.settings.modulations.filter((m) => m.source).length).toBe(1);
  });

  it('removes a route, clears its slot and its numbers', () => {
    const p = samplePatch();
    expect(applyModulation(p, { source: 'velocity', destination: 'osc_1_level', remove: true })).toEqual({ ok: true, slot: 1, action: 'removed' });
    expect(p.settings.modulations[0]).toEqual({ source: '', destination: '' });
    expect(p.settings['modulation_1_amount']).toBe(0);
    const again = applyModulation(p, { source: 'velocity', destination: 'osc_1_level', remove: true });
    expect(!again.ok && again.error).toContain('No route');
  });

  it('refuses an unknown source, an unknown destination and an amount out of range', () => {
    const p = samplePatch();
    expect(applyModulation(p, { source: 'lfo1', destination: 'osc_1_level' }).ok).toBe(false);
    expect(applyModulation(p, { source: 'lfo_1', destination: 'cutoff' }).ok).toBe(false);
    expect(applyModulation(p, { source: 'lfo_1', destination: 'modulation_1_amount' }).ok).toBe(false);
    const r = applyModulation(p, { source: 'lfo_1', destination: 'osc_1_level', amount: 2 });
    expect(!r.ok && r.error).toContain('-1 to 1');
  });

  it('refuses when all 64 slots are in use', () => {
    const p = samplePatch();
    p.settings.modulations = p.settings.modulations.map(() => ({ source: 'note', destination: 'osc_1_level' }));
    const r = applyModulation(p, { source: 'lfo_2', destination: 'osc_2_level' });
    expect(!r.ok && r.error).toContain('64 modulation slots');
  });
});

describe('LFO shapes', () => {
  it('sets points, powers, name and smoothing', () => {
    const p = samplePatch();
    const r = applyLfo(p, { index: 2, name: 'Ramp down', points: [[0, 1], [1, 0]], smooth: true });
    expect(r.ok).toBe(true);
    expect(p.settings.lfos[1]).toMatchObject({ name: 'Ramp down', num_points: 2, points: [0, 1, 1, 0], powers: [0, 0], smooth: true });
    expect(p.settings.lfos[0].name).toBe('Triangle');
  });

  it.each([
    ['an LFO that does not exist', { index: 9, points: [[0, 0], [1, 1]] }, /1 to 8/],
    ['one point', { index: 1, points: [[0, 0]] }, /2 to 100/],
    ['a point outside 0..1', { index: 1, points: [[0, 0], [1.5, 1]] }, /outside 0..1/],
    ['a point that goes backwards', { index: 1, points: [[0, 0], [0.8, 1], [0.5, 0]] }, /backwards/],
    ['powers of the wrong length', { index: 1, points: [[0, 0], [1, 1]], powers: [0] }, /one number per point/],
  ])('refuses %s', (_l, edit, why) => {
    const r = applyLfo(samplePatch(), edit as never);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(why);
  });
});

describe('wavetable slot and summary', () => {
  const wt = () => buildWavetable({ name: 'Sine to Saw', frames: ['sine', 'saw'].map((s) => frameFromHarmonics(shapeHarmonics(s as 'sine' | 'saw'))) });

  it('puts a wavetable on one oscillator and the summary shows it', () => {
    const p = samplePatch();
    expect(applyWavetable(p, 2, wt()).ok).toBe(true);
    const osc = summarize(p).oscillators;
    expect(osc[1].wavetable).toEqual({ name: 'Sine to Saw', sources: ['Wave Source'], keyframes: 2 });
    expect(osc[0].wavetable.name).toBe('Init 1');
  });

  it('refuses oscillator 0 and 4', () => {
    expect(applyWavetable(samplePatch(), 0, wt()).ok).toBe(false);
    expect(applyWavetable(samplePatch(), 4, wt()).ok).toBe(false);
  });

  it('summarizes the routes in use with their amounts, and the effects that are on', () => {
    const p = samplePatch();
    p.settings['reverb_on'] = 1;
    p.settings['delay_on'] = 0;
    const s = summarize(p);
    expect(s.modulations).toEqual([{ slot: 1, source: 'velocity', destination: 'osc_1_level', amount: 1, bipolar: false, stereo: false, bypass: false, power: 0 }]);
    expect(s.effectsOn).toEqual(['reverb']);
    expect(s).toMatchObject({ presetName: 'Init', oscillators: [{ oscillator: 1, on: true }, { on: false }, { on: false }], lfos: expect.any(Array) });
    expect(s.lfos).toHaveLength(8);
  });
});
