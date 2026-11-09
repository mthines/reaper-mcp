import { describe, it, expect } from 'vitest';
import extension from './index.js';
import { fakeApi, type FakeItem } from './__fixtures__/fake-api.js';

async function setup(tracks: Record<number, FakeItem[]> = { 0: [] }, tempo = 120) {
  const t = fakeApi({ tracks, tempo });
  await t.load(extension);
  return t;
}
const pitchesAt = (item: FakeItem, beat: number) => item.notes.filter((n) => n.startPosition === beat).map((n) => n.pitch).sort((a, b) => a - b);

describe('composition_chord_progression', () => {
  it('writes each chord on its own bar into a new item sized to the progression', async () => {
    const t = await setup();
    const r = await t.call('chord_progression', { trackIndex: 0, progression: 'Cm7, Fm7, Bb7, Eb' });
    expect(r).toMatchObject({ written: true, itemCreated: true, noteCount: 15, beats: 16 });
    const item = t.tracks[0][0];
    expect(item.length).toBe(8); // 16 beats at 120 BPM
    expect(pitchesAt(item, 0)).toEqual([48, 51, 55, 58]); // Cm7 at octave 3
    expect(pitchesAt(item, 4)).toEqual([53, 56, 60, 63]); // Fm7
    expect(pitchesAt(item, 12)).toEqual([51, 55, 58]); // Eb
    expect(item.notes.every((n) => n.duration === 4 && n.velocity === 90)).toBe(true);
  });

  it('adds a slash bass below the chord and honours per-chord lengths, inversion and octave', async () => {
    const t = await setup();
    await t.call('chord_progression', { trackIndex: 0, progression: 'C/E:2 G', octave: 4, inversion: 1 });
    const item = t.tracks[0][0];
    expect(pitchesAt(item, 0)).toEqual([52, 64, 67, 72]); // bass E3 under first-inversion C (E G C)
    expect(pitchesAt(item, 2)).toEqual([71, 74, 79]); // G first inversion
  });

  it('refuses a bad chord and writes nothing, naming the token', async () => {
    const t = await setup();
    const r = await t.call('chord_progression', { trackIndex: 0, progression: 'Cm7, Hx9, F' });
    expect(r).toEqual({ error: expect.stringContaining('"Hx9"') });
    expect(t.tracks[0]).toEqual([]);
  });

  it('refuses a voicing that leaves the MIDI range', async () => {
    const t = await setup();
    const r = (await t.call('chord_progression', { trackIndex: 0, progression: 'B9', octave: 9 })) as { error: string };
    expect(r.error).toContain('outside 0-127');
    expect(t.tracks[0]).toEqual([]);
  });

  it('writes into an existing item and warns when the progression outruns it', async () => {
    const t = await setup({ 0: [{ position: 0, length: 4, notes: [] }] });
    const r = await t.call('chord_progression', { trackIndex: 0, itemIndex: 0, progression: 'Am F C G' });
    expect(r.itemCreated).toBe(false);
    expect(r.warnings[0]).toContain('item is 4.00 s long');
    expect(t.tracks[0][0].notes).toHaveLength(12);
  });

  it('dry run shows the chords and changes nothing', async () => {
    const t = await setup();
    const r = await t.call('chord_progression', { trackIndex: 0, progression: 'Am', dryRun: true });
    expect(r).toMatchObject({ written: false, noteCount: 3, chords: [{ symbol: 'Am', pitches: [57, 60, 64] }] });
    expect(t.tracks[0]).toEqual([]);
  });

  it('reports an unknown track instead of throwing', async () => {
    const t = await setup();
    expect(await t.call('chord_progression', { trackIndex: 5, progression: 'C' })).toEqual({ error: 'Track 5 not found' });
  });
});

describe('composition_drum_pattern', () => {
  const lanes = { kick: 'x---x---x---x---', snare: '----x-------x---', hihat: 'x-x-x-x-x-x-x-x-' };

  it('writes a one-bar GM pattern in 16th steps', async () => {
    const t = await setup();
    const r = await t.call('drum_pattern', { trackIndex: 0, lanes });
    expect(r).toMatchObject({ written: true, patternBars: 1, lanes: [{ lane: 'kick', pitch: 36, hits: 4 }, { lane: 'snare', pitch: 38, hits: 2 }, { lane: 'hihat', pitch: 42, hits: 8 }] });
    const item = t.tracks[0][0];
    expect(pitchesAt(item, 0)).toEqual([36, 42]);
    expect(pitchesAt(item, 1)).toEqual([36, 38, 42]);
    expect(item.length).toBe(2);
  });

  it('uses the Invasion map, which is not GM', async () => {
    const t = await setup();
    await t.call('drum_pattern', { trackIndex: 0, map: 'invasion', lanes: { kick: 'x---', snare: '--x-', china: 'x---' } });
    expect(pitchesAt(t.tracks[0][0], 0)).toEqual([24, 65]);
    expect(pitchesAt(t.tracks[0][0], 0.5)).toEqual([26]);
  });

  it('marks accents and ghosts by velocity, repeats the bar and swings the off steps', async () => {
    const t = await setup();
    await t.call('drum_pattern', { trackIndex: 0, lanes: { snare: 'XoxX' }, repeat: 2, swing: 1 });
    const n = t.tracks[0][0].notes;
    expect(n.map((x) => x.velocity)).toEqual([120, 60, 100, 120, 120, 60, 100, 120]);
    expect(n[0].startPosition).toBe(0);
    expect(n[1].startPosition).toBeCloseTo(0.25 + 0.25 / 3);
    expect(n[4].startPosition).toBe(1);
  });

  it('refuses a lane the map does not have and says which it has', async () => {
    const t = await setup();
    const r = (await t.call('drum_pattern', { trackIndex: 0, map: 'invasion', lanes: { cowbell: 'x---' } })) as { error: string };
    expect(r.error).toContain('"cowbell"');
    expect(r.error).toContain('kick');
    expect(t.tracks[0]).toEqual([]);
  });

  it('takes a note number or a pitches override as the lane', async () => {
    const t = await setup();
    await t.call('drum_pattern', { trackIndex: 0, lanes: { '40': 'x---', pad: '--x-' }, pitches: { pad: 70 } });
    expect(t.tracks[0][0].notes.map((n) => n.pitch)).toEqual([40, 70]);
  });

  it('refuses lanes of different lengths and unknown step characters', async () => {
    const t = await setup();
    expect(((await t.call('drum_pattern', { trackIndex: 0, lanes: { kick: 'x---x---', snare: 'x-' } })) as { error: string }).error).toContain('pad it');
    expect(((await t.call('drum_pattern', { trackIndex: 0, lanes: { kick: 'x-?-' } })) as { error: string }).error).toContain('"?"');
    expect(t.tracks[0]).toEqual([]);
  });
});
