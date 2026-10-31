import { describe, expect, it } from 'vitest';
import type { CommandEntry } from '../../lib/commands.js';
import { summaryOf, toolTitle } from './tools.js';
import { DRAWER_EXAMPLES, EDIT_EXAMPLES, MEASUREMENT_EXAMPLES } from '../../demo/examples.js';
import { DEMO_CALLS } from '../../demo/demo-calls.js';

const call = (c: string, p: Record<string, unknown>, r?: Record<string, unknown>, extra: Partial<CommandEntry> = {}): CommandEntry => ({
  n: 10, t: 100_000, c, ms: 1, ok: true, p: JSON.stringify(p), r, ...extra,
});
const ctx = { now: 130_000 };

describe('what the drawer says the agent did', () => {
  it('reads levels as the peak and RMS, names a hot peak, and compares with the last reading', () => {
    const now = call('read_track_meters', { trackIndex: 0 }, { peakL: -1.2, peakR: -6, rmsL: -17.3, rmsR: -18.3 });
    const before = call('read_track_meters', { trackIndex: 0 }, { peakL: -5.5, peakR: -7, rmsL: -20, rmsR: -21 }, { n: 5, t: 100_000 });
    expect(summaryOf(now, 'midnight-drive', { ...ctx, previous: before })).toBe(
      'midnight-drive read the levels on track 1: peaks at −1.2 dB, RMS −17.3 dB — within 6 dB of clipping; peaks 4.3 dB hotter than 30 s ago.',
    );
  });

  it('names the plugin, the setting and the track a modulation was added to', () => {
    const e = call('set_fx_param_modulation', { trackIndex: 3, fxIndex: 0, paramIndex: 4 }, {
      fx: 'VST3: Pro-Q 3 (FabFilter)',
      rows: [{ p: 'Band 2 Frequency', base: 0.42, v: 0.5, lfo: ['triangle', 0.25, 0.3, 0, 0, 1], was: { p: 'Band 2 Frequency', base: 0.42, v: 0.42 } }],
    });
    expect(summaryOf(e, 'midnight-drive', ctx)).toBe('midnight-drive added an LFO to Band 2 Frequency on Pro-Q 3, track 4.');
  });

  it('says what removing time did to everything after the cut', () => {
    const e = call('remove_time', { start: 144, end: 160 });
    expect(summaryOf(e, 'midnight-drive', ctx)).toBe('midnight-drive cut 2:24.0–2:40.0 out of the project, and everything after it moved 16.0 s earlier.');
  });

  it('names a deleted track by its name', () => {
    expect(summaryOf(call('delete_track', { track: 'Old Vox' }), 'You', ctx)).toBe('You deleted the track “Old Vox”.');
  });

  it('says what was tried when a call failed, and whether REAPER refused it', () => {
    const failed = call('delete_track', { track: 'Old Vox' }, undefined, { ok: false, e: 'Track "Old Vox" not found' });
    expect(summaryOf(failed, 'midnight-drive', ctx)).toBe('midnight-drive tried to delete a track on “Old Vox”, and REAPER refused.');
  });

  it('falls back to the plain name and target when a call carries too little to say more', () => {
    expect(summaryOf(call('move_track', { trackIndex: -1 }), 'stems-prep', ctx)).toBe('stems-prep ran “move a track” on the master.');
  });

  it('says a track setting in the units the mixer shows', () => {
    expect(summaryOf(call('set_track_property', { trackIndex: 0, property: 'volume', value: -4.5 }), 'A', ctx)).toBe('A set track 1: the volume to −4.5 dB.');
    expect(summaryOf(call('set_track_property', { trackIndex: 2, property: 'pan', value: -0.3 }), 'A', ctx)).toBe('A set track 3: the pan to 30% left.');
  });

  it('names notes, grids and plugins as a musician would', () => {
    expect(summaryOf(call('insert_midi_note', { trackIndex: 1, itemIndex: 0, pitch: 60, velocity: 100 }), 'A', ctx)).toBe('A added C4 (velocity 100) to MIDI item 1 on track 2.');
    expect(summaryOf(call('quantize_midi', { trackIndex: 1, itemIndex: 0, grid: 0.25, strength: 0.5 }), 'A', ctx)).toBe(
      'A quantized the notes in MIDI item 1 on track 2 to 16th notes at 50% strength.',
    );
    expect(summaryOf(call('add_fx', { trackIndex: 8, fxName: 'VST3: ReaComp (Cockos)' }), 'A', ctx)).toBe('A added ReaComp to track 9.');
  });

  it('gives the answer of a measurement against its target', () => {
    const e = call('read_track_lufs', { trackIndex: -1, targetLufs: -14 }, { integrated: -11.2 });
    expect(summaryOf(e, 'A', ctx)).toBe('A measured the master at −11.2 LUFS integrated, 2.8 LU over the −14 LUFS target.');
  });

  it('says which way a send level moved, naming where it goes', () => {
    const e = call('set_send', { track: 'Vox', index: 0, volume: -9 }, {
      kind: 'routing', t: 'Vox', routes: [['s', 'Verb', -9, 0, '']], was: [['s', 'Verb', -6, 0, '']],
    });
    expect(summaryOf(e, 'A', ctx)).toBe('A turned the send to “Verb” on “Vox” down from −6.0 to −9.0 dB.');
  });

  it('says a plan dry run changed nothing', () => {
    expect(summaryOf(call('run_plan', { dryRun: true, ops: [{ op: 'add_track' }, { op: 'add_fx' }] }), 'A', ctx)).toBe('A checked a plan of 2 edits without changing anything.');
  });

  it('writes a readable sentence for every example and demo call', () => {
    const entries = [...MEASUREMENT_EXAMPLES, ...EDIT_EXAMPLES, ...DRAWER_EXAMPLES].map((x) => x.entry).filter((e) => e.ok);
    for (const [c, p] of Object.entries(DEMO_CALLS)) if (p !== 'example') entries.push(call(c, p));
    const odd = entries.map((e) => summaryOf(e, 'A', ctx)).filter((s) => /undefined|NaN|null|\[object|“”| {2}/.test(s));
    expect(odd).toEqual([]);
  });

  it('gives a command it does not know (a newer bridge) a readable name', () => {
    expect(toolTitle('make_coffee_now')).toBe('Make coffee now');
  });
});
