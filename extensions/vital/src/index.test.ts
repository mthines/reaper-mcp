import { describe, it, expect } from 'vitest';
import extension from './index.js';
import { fakeApi, vitalFx } from './__fixtures__/fake-api.js';
import { parseVitalState } from './state.js';
import { decodeFrame, FRAME_SIZE } from './wavetable.js';

async function setup(tracks: Parameters<typeof fakeApi>[0]) {
  const t = fakeApi(tracks);
  await t.load(extension);
  const patchOf = (track: number, fx: number) => {
    const r = parseVitalState(tracks[track][fx].state);
    if (!r.ok) throw new Error(r.error);
    return r.value.patch;
  };
  return { ...t, patchOf };
}

describe('vital_read_patch', () => {
  it('summarizes the patch and finds the Vital on the track by itself', async () => {
    const t = await setup({ 3: [{ name: 'VST: ReaEQ (Cockos)', state: new Uint8Array(1) }, vitalFx()] });
    const r = await t.call('read_patch', { trackIndex: 3 });
    expect(r).toMatchObject({ fxIndex: 1, presetName: 'Init', modulations: [{ source: 'velocity', destination: 'osc_1_level', amount: 1 }] });
    expect(t.writes).toEqual([]);
  });

  it('includes the raw values of settings whose names match', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const r = (await t.call('read_patch', { trackIndex: 0, settingsMatching: 'osc_1_' })) as { settings: Record<string, number> };
    expect(r.settings).toEqual({ osc_1_level: 0.7071067690849304, osc_1_on: 1 });
  });

  it('says so when the track has no Vital, and asks for fxIndex when it has two', async () => {
    const t = await setup({ 0: [{ name: 'VST: ReaEQ (Cockos)', state: new Uint8Array(1) }], 1: [vitalFx(), vitalFx()] });
    expect(await t.call('read_patch', { trackIndex: 0 })).toEqual({ error: 'No Vital on track 0' });
    const two = (await t.call('read_patch', { trackIndex: 1 })) as { error: string };
    expect(two.error).toContain('2 Vitals');
    expect(two.error).toContain('pass fxIndex');
    expect(await t.call('read_patch', { trackIndex: 1, fxIndex: 1 })).toMatchObject({ fxIndex: 1 });
  });

  it('refuses an FX that is not Vital and a state that is not Vital\'s', async () => {
    const t = await setup({ 0: [{ name: 'VST3: Pro-Q 3 (FabFilter)', state: new Uint8Array(1) }, { name: 'VST3i: Vital (Vital Audio)', state: new Uint8Array(600).fill(3) }] });
    expect(((await t.call('read_patch', { trackIndex: 0, fxIndex: 0 })) as { error: string }).error).toContain('not Vital');
    expect(((await t.call('read_patch', { trackIndex: 0, fxIndex: 1 })) as { error: string }).error).toContain('not the state layout Vital writes');
  });
});

describe('vital_write_patch', () => {
  it('writes settings, a mod route and an LFO shape in one step, and what was written reads back', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const r = await t.call('write_patch', {
      trackIndex: 0,
      settings: { osc_1_level: 0.3 },
      modulations: [{ source: 'lfo_1', destination: 'filter_1_cutoff', amount: 0.5 }],
      lfos: [{ index: 1, name: 'Ramp', points: [[0, 0], [1, 1]] }],
    });
    expect(r).toMatchObject({
      written: true,
      changedSettings: { osc_1_level: { from: 0.7071067690849304, to: 0.3 } },
      modulations: [{ slot: 2, action: 'added' }],
      lfosSet: [1],
    });
    const p = t.patchOf(0, 0);
    expect(p.settings['osc_1_level']).toBe(0.3);
    expect(p.settings.modulations[1]).toEqual({ source: 'lfo_1', destination: 'filter_1_cutoff' });
    expect(p.settings['modulation_2_amount']).toBe(0.5);
    expect(p.settings.lfos[0]).toMatchObject({ name: 'Ramp', num_points: 2 });
    const back = (await t.call('read_patch', { trackIndex: 0 })) as { modulations: unknown[] };
    expect(back.modulations).toHaveLength(2);
  });

  it('a dry run reports the change and writes nothing', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const before = t.patchOf(0, 0).settings['osc_1_level'];
    const r = await t.call('write_patch', { trackIndex: 0, settings: { osc_1_level: 0.1 }, dryRun: true });
    expect(r).toMatchObject({ written: false, dryRun: true, changedSettings: { osc_1_level: { to: 0.1 } } });
    expect(t.writes).toEqual([]);
    expect(t.patchOf(0, 0).settings['osc_1_level']).toBe(before);
  });

  it('one bad edit refuses the whole request and nothing is written', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const r = (await t.call('write_patch', {
      trackIndex: 0,
      settings: { osc_1_level: 0.1 },
      modulations: [{ source: 'lfo1', destination: 'osc_1_level' }],
    })) as { error: string };
    expect(r.error).toContain('Unknown modulation source "lfo1"');
    expect(r.error).toContain('nothing was changed');
    expect(t.writes).toEqual([]);
    expect(t.patchOf(0, 0).settings['osc_1_level']).toBe(0.7071067690849304);
  });

  it('refuses an empty request and an unknown setting name', async () => {
    const t = await setup({ 0: [vitalFx()] });
    expect(await t.call('write_patch', { trackIndex: 0 })).toEqual({ error: 'Nothing to change: give settings, modulations or lfos' });
    expect(((await t.call('write_patch', { trackIndex: 0, settings: { osc_1_levl: 1 } })) as { error: string }).error).toContain('Unknown setting');
    expect(t.writes).toEqual([]);
  });

  it('refuses to write to a FX that is not Vital', async () => {
    const t = await setup({ 0: [vitalFx(undefined, 'VST3: Serum (Xfer Records)')] });
    // without fxIndex there is simply no Vital to find; pointing at the wrong FX by index is refused by name
    expect(await t.call('write_patch', { trackIndex: 0, settings: { osc_1_level: 0.1 } })).toEqual({ error: 'No Vital on track 0' });
    expect(((await t.call('write_patch', { trackIndex: 0, fxIndex: 0, settings: { osc_1_level: 0.1 } })) as { error: string }).error).toContain('not Vital');
    expect(t.writes).toEqual([]);
  });

  it('removes a mod route', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const r = await t.call('write_patch', { trackIndex: 0, modulations: [{ source: 'velocity', destination: 'osc_1_level', remove: true }] });
    expect(r).toMatchObject({ written: true, modulations: [{ action: 'removed', slot: 1 }] });
    expect(t.patchOf(0, 0).settings.modulations[0]).toEqual({ source: '', destination: '' });
  });
});

describe('vital_set_wavetable', () => {
  it('puts a sine-to-saw morph on oscillator 2 with real frames at the ends of the position axis', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const r = await t.call('set_wavetable', { trackIndex: 0, oscillator: 2, name: 'Sine to Saw', frames: [{ shape: 'sine' }, { shape: 'saw', harmonics: 32 }] });
    expect(r).toMatchObject({ written: true, oscillator: 2, wavetable: { name: 'Sine to Saw', frames: 2 } });
    const wt = t.patchOf(0, 0).settings.wavetables[1] as { name: string; groups: { components: { keyframes: { position: number; wave_data: string }[] }[] }[] };
    expect(wt.name).toBe('Sine to Saw');
    const kf = wt.groups[0].components[0].keyframes;
    expect(kf.map((k) => k.position)).toEqual([0, 255]);
    const first = decodeFrame(kf[0].wave_data);
    expect(first.length).toBe(FRAME_SIZE);
    expect(first[FRAME_SIZE / 4]).toBeCloseTo(1, 3);
    expect((t.patchOf(0, 0).settings.wavetables[0] as { name: string }).name).toBe('Init 1');
  });

  it('takes an additive recipe, and refuses silence without touching the patch', async () => {
    const t = await setup({ 0: [vitalFx()] });
    expect(await t.call('set_wavetable', { trackIndex: 0, oscillator: 1, name: 'Organ', frames: [{ harmonics: [1, 0.5, 0.25], phases: [0, 0, 0] }] })).toMatchObject({ written: true });
    const silent = (await t.call('set_wavetable', { trackIndex: 0, oscillator: 3, name: 'Nothing', frames: [{ harmonics: [0, 0] }] })) as { error: string };
    expect(silent.error).toContain('silence');
    expect(t.writes).toHaveLength(1);
  });

  it('a dry run builds the wavetable but writes nothing', async () => {
    const t = await setup({ 0: [vitalFx()] });
    const r = await t.call('set_wavetable', { trackIndex: 0, oscillator: 1, name: 'x', frames: [{ shape: 'square' }], dryRun: true });
    expect(r).toMatchObject({ written: false });
    expect(t.writes).toEqual([]);
  });

  it('refuses an oscillator outside 1-3 as invalid input', async () => {
    const t = await setup({ 0: [vitalFx()] });
    await expect(t.call('set_wavetable', { trackIndex: 0, oscillator: 4, name: 'x', frames: [{ shape: 'sine' }] })).rejects.toThrow();
  });
});
