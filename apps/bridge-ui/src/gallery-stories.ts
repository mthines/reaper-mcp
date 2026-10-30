import type { CommandEntry } from './status.js';

/**
 * The component gallery (`?gallery`): every UI element in its states, like Storybook, for development.
 * Shown only from a local build (`file://`) or when the bridge runs in developer mode; anyone else
 * opening the link gets the normal page.
 */
export function galleryAllowed(search: string, protocol: string, dev: boolean | undefined): boolean {
  if (!new URLSearchParams(search).has('gallery')) return false;
  return protocol === 'file:' || dev === true;
}

export interface Story {
  title: string;
  /** What state this shows, in a few words */
  note?: string;
  entry: CommandEntry;
  /** The same command on the same track, newest first, `entry` included: drives the previous-call marks */
  history: CommandEntry[];
}

/** A fixed "now" so the stories' relative times read the same on every load */
export const GALLERY_NOW = Date.UTC(2026, 9, 29, 20, 30);

let seq = 100;
function call(c: string, params: Record<string, unknown>, r: Record<string, unknown> | undefined, opts: Partial<CommandEntry> = {}): CommandEntry {
  seq += 1;
  return { n: seq, t: GALLERY_NOW - 60_000 + seq * 1000, c, ms: 4.2, ok: true, s: 'gallery', p: JSON.stringify(params), r, ...opts };
}

/** The same call made two minutes earlier, with other results */
function earlier(e: CommandEntry, r: Record<string, unknown>): CommandEntry {
  return { ...e, n: e.n - 50, t: e.t - 120_000, r };
}

const story = (title: string, entry: CommandEntry, note?: string, previous?: CommandEntry): Story => ({
  title,
  note,
  entry,
  history: previous ? [entry, previous] : [entry],
});

/** A mix-bus-like spectrum: pink tilt, a low bump and a presence peak, shifted by `lift` dB */
function bands(lift = 0, presence = 4): number[] {
  return Array.from({ length: 48 }, (_, b) => {
    const hz = 20 * 1000 ** ((b + 0.5) / 48);
    const tilt = -3 * Math.log2(hz / 100);
    const low = 8 * Math.exp(-(Math.log2(hz / 60) ** 2));
    const pres = presence * Math.exp(-(Math.log2(hz / 3000) ** 2) * 2);
    const air = hz > 16000 ? -36 * Math.log2(hz / 16000) : 0;
    return Math.round((-24 + tilt + low + pres + air + lift) * 100) / 100;
  });
}

/** A beat: a hit every half second over a bed; `top` is the loudest hit (1 = full scale) */
function waveform(top: number, bed = 0.03) {
  const hi = Array.from({ length: 120 }, (_, i) => Math.round(Math.min(1, bed + top * Math.exp(-((i % 12) / 12) * 9)) * 100) / 100);
  const lo = hi.map((v) => -Math.round(v * 0.92 * 100) / 100);
  const peak = Math.max(...hi);
  return { hi, lo, peakDb: Math.round(20 * Math.log10(peak) * 100) / 100, durationSeconds: 5, sampleRate: 44100, channels: 2 };
}

const track = (trackIndex: number, extra: Record<string, unknown> = {}) => ({ trackIndex, ...extra });

function measurementStories(): Story[] {
  const meters = call('read_track_meters', track(0), { peakL: -9.4, peakR: -10.1, rmsL: -21.3, rmsR: -22 });
  const metersHot = call('read_track_meters', track(1), { peakL: -2.6, peakR: -4.1, rmsL: -14.2, rmsR: -15 });
  const metersOver = call('read_track_meters', track(2), { peakL: 1.2, peakR: 0.4, rmsL: -8.1, rmsR: -8.6 });

  const lufs = call('read_track_lufs', track(-1, { targetLufs: -14 }), { integrated: -14.3, shortTerm: -13.6, momentary: -12.9, truePeakL: -1.8, truePeakR: -2.1, duration: 30 });
  const lufsOver = call('read_track_lufs', track(-1, { targetLufs: -14 }), { integrated: -9.2, shortTerm: -8.4, momentary: -7.5, truePeakL: 0.4, truePeakR: -0.6, duration: 30 });
  const lufsBare = call('read_track_lufs', track(3), { integrated: -18.6, shortTerm: -17.9, momentary: -16.2, truePeakL: -4.4, truePeakR: -4.9, duration: 8 });

  const corr = call('read_track_correlation', track(4), { correlation: 0.82, stereoWidth: 1.12, midLevel: -14.2, sideLevel: -24.8 });
  const corrPhase = call('read_track_correlation', track(5), { correlation: -0.38, stereoWidth: 1.9, midLevel: -22.4, sideLevel: -15.1 });

  const crest = call('read_track_crest', track(6), { crestFactor: 12.4, peakLevel: -6.2, rmsLevel: -18.6 });
  const crestHot = call('read_track_crest', track(7), { crestFactor: 6.1, peakLevel: -0.8, rmsLevel: -6.9 });

  const spec = { sampleRate: 48000, fftSize: 4096 };
  const spectrum = call('read_track_spectrum', track(8, { fftSize: 4096 }), { ...spec, peakDb: -7.4, rmsDb: -18.2, bands: bands() });
  const spectrumHot = call('read_track_spectrum', track(9, { fftSize: 4096 }), { ...spec, peakDb: -0.4, rmsDb: -9.8, bands: bands(14, 8) });

  const render = { trackIndex: 0, startTime: 30, endTime: 35, commandId: 'gallery' };
  const wave = call('render_track_to_wav', render, { ...waveform(0.55), rmsDb: -19.4, clipped: 0 }, { ms: 912 });
  const waveClipped = call('render_track_to_wav', { ...render, trackIndex: 1 }, { ...waveform(1.1, 0.06), rmsDb: -11.2, clipped: 37 }, { ms: 1043 });
  const waveQuiet = call('render_track_to_wav', { ...render, trackIndex: 2 }, { ...waveform(0.06, 0.004), rmsDb: -42.5, clipped: 0 }, { ms: 870 });

  return [
    story('Meters', meters, 'Comfortable levels'),
    story('Meters · hot', metersHot, 'Peaks above −6 dB turn amber, previous call ghosted', earlier(metersHot, { peakL: -6.8, peakR: -7.4, rmsL: -18.2, rmsR: -18.9 })),
    story('Meters · over', metersOver, 'Peaks over 0 dB turn red'),
    story('Loudness · on target', lufs, 'Within ±1 LU of the agent’s target', earlier(lufs, { integrated: -16.1, shortTerm: -15.2, momentary: -14.8, truePeakL: -3, truePeakR: -3.2, duration: 30 })),
    story('Loudness · over target', lufsOver, 'Louder than the target, true peak over 0'),
    story('Loudness · no target', lufsBare, 'The agent gave no target'),
    story('Correlation', corr, 'Mostly mono-compatible', earlier(corr, { correlation: 0.64, stereoWidth: 1.3, midLevel: -14.5, sideLevel: -21.9 })),
    story('Correlation · phase', corrPhase, 'Negative correlation is out of phase'),
    story('Crest', crest, 'Dynamic', earlier(crest, { crestFactor: 9.8, peakLevel: -4.1, rmsLevel: -13.9 })),
    story('Crest · squashed', crestHot, 'Little crest, peak near 0'),
    story('Spectrum', spectrum, 'Previous call dashed; hover for values', earlier(spectrum, { ...spec, peakDb: -9.1, rmsDb: -19.9, bands: bands(-3, 1) })),
    story('Spectrum · hot', spectrumHot, 'Bands near 0 dB turn amber, then red'),
    story('Waveform', wave, 'A render’s waveform on a dB scale; hover for values', earlier(wave, { ...waveform(0.45), rmsDb: -21.2, clipped: 0 })),
    story('Waveform · clipped', waveClipped, 'Clipped samples counted and named'),
    story('Waveform · quiet', waveQuiet, 'Quiet material still fills the height'),
  ];
}

/** Every measuring command in its states */
export const MEASUREMENT_STORIES: Story[] = measurementStories();

/** Volume automation: a dip at 12–17 s added over a flat line */
const VOLUME_BEFORE = [[0, 0, 0], [32, 0, 0]];
const VOLUME_AFTER = [[0, 0, 0], [8, 0, 0], [12, -2.5, 2], [13.5, -6, 0], [16, -6, 2], [17.5, -1.5, 0], [24, -1.5, 2], [26, 2, 0], [32, 2, 0]];

/** Four bars of chords, plus a melody this call added */
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]].flatMap((c, i) => c.map((p) => [p, i * 4, 4, 72, 0]));
const MELODY = [[72, 0, 1, 96], [71, 1, 0.5, 88], [69, 1.5, 1.5, 104], [67, 4, 1, 92], [69, 5, 1, 100], [72, 8, 2, 112], [74, 10, 2, 108], [72, 12, 4, 84]].map((n) => [...n, 1]);

const SONG_REGIONS = [[0, 16, 'Intro', '', 1], [16, 48, 'Verse 1', '#7cc4ff', 2], [48, 80, 'Chorus', '#c4a5ff', 3], [80, 112, 'Verse 2', '#7cc4ff', 4], [112, 144, 'Chorus', '#c4a5ff', 5], [144, 160, 'Bridge', '#fcd34d', 6], [160, 192, 'Chorus', '#c4a5ff', 7], [192, 200, 'Outro', '', 8]];
const SONG_MARKERS = [[18, 'Vox in', '', 1], [140, 'Fill', '', 3]];
const SONG_TEMPO = [[0, 92, 4, 4, 0]];

function editStories(): Story[] {
  const volume = call('set_track_property', track(0, { property: 'volume', value: -4.5 }), { rows: [{ t: 'Kick', p: 'volume', s: 'db', a: -6, b: -4.5 }] });
  const batch = call('set_multiple_track_properties', { tracks: '[…]' }, {
    rows: [
      { t: 'Bass', p: 'volume', s: 'db', a: -10, b: -12 },
      { t: 'Vox', p: 'volume', s: 'db', a: -6, b: 1.5 },
      { t: 'Gtr L', p: 'pan', s: 'pan', a: -0.8, b: -1 },
      { t: 'Vox Dbl', p: 'mute', s: 'bool', a: 0, b: 1 },
    ],
  });
  const fx = call('set_multiple_fx_parameters', { updates: '[…]' }, {
    rows: [
      { t: 'Vox · Pro-Q 3', p: 'Band 2 Gain', s: 'norm', a: 0.47, b: 0.4, at: '−1.8 dB', bt: '−4.2 dB' },
      { t: 'Vox · Pro-Q 3', p: 'Band 2 Frequency', s: 'norm', a: 0.52, b: 0.55, at: '320 Hz', bt: '380 Hz' },
      { t: 'Vox · Pro-Q 3', p: 'Band 5 Gain', s: 'norm', a: 0.5, b: 0.56, at: '0.0 dB', bt: '+2.0 dB' },
      { t: 'Vox · Pro-Q 3', p: 'Output Level', s: 'norm', a: 0.5, b: 0.5, at: '0.0 dB', bt: '0.0 dB' },
    ],
  });
  const envelope = call('insert_envelope_points', track(4, { envelopeIndex: 0, points: '[…]' }), {
    env: 'Volume', unit: 'dB', from: 0, to: 32, count: 9, pts: VOLUME_AFTER, was: VOLUME_BEFORE,
  });
  const pan = call('get_envelope_points', track(6, { envelopeIndex: 1 }), {
    env: 'Pan', unit: 'pan', from: 16, to: 32, count: 9,
    pts: Array.from({ length: 9 }, (_, i) => [16 + i * 2, i % 2 ? -0.6 : 0.6, 2]),
  });
  const removed = call('remove_envelope_points', track(4, { envelopeIndex: 0, timeStart: 12, timeEnd: 18 }), {
    env: 'Volume', unit: 'dB', from: 9, to: 21, count: 4, pts: [[8, 0, 0], [24, -1.5, 2]], was: VOLUME_AFTER.slice(1, 7),
  });
  const melody = call('insert_midi_notes', { trackIndex: 7, itemIndex: 0, notes: '[…]' }, {
    total: CHORDS.length + MELODY.length, beats: 16, ts: [4, 4], more: 0, gone: [], notes: [...CHORDS, ...MELODY],
  });
  const deleted = call('delete_midi_note', { trackIndex: 7, itemIndex: 0, noteIndex: 3 }, {
    total: CHORDS.length - 1, beats: 16, ts: [4, 4], more: 0, gone: [[53, 4, 4, 72]], notes: CHORDS.filter((n) => !(n[0] === 53 && n[1] === 4)),
  });
  const big = call('get_midi_notes', { trackIndex: 2, itemIndex: 0 }, {
    total: 2044, beats: 64, ts: [4, 4], more: 2044 - 256,
    notes: Array.from({ length: 256 }, (_, i) => [[36, 38, 42, 42][i % 4], i * 0.25, 0.25, i % 4 === 2 ? 100 : 80 + ((i * 37) % 40), 0]),
  });
  const drums = call('analyze_midi', { trackIndex: 2, itemIndex: 0 }, {
    total: 120, beats: 32,
    pitches: [[36, 32, 96, 118, 108, 0], [38, 16, 88, 124, 104, 0], [42, 56, 100, 101, 100.5, 24], [46, 8, 70, 96, 84, 0], [49, 8, 110, 120, 114, 0]],
    hist: [0, 0, 0, 0, 0, 0, 0, 2, 7, 18, 62, 23, 8],
  });
  const markers = call('list_markers', {}, { regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO, len: 200 });
  const added = call('add_marker', { position: 80, name: 'Drop' }, {
    regions: SONG_REGIONS, markers: [SONG_MARKERS[0], [80, 'Drop', '', 2], SONG_MARKERS[1]], tempo: SONG_TEMPO, len: 200,
    was: { regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO },
  });
  const tempo = call('add_tempo_marker', { position: 144, bpm: 88, timeSigNumerator: 3, timeSigDenominator: 4 }, {
    regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: [...SONG_TEMPO, [144, 88, 3, 4, 0], [160, 92, 4, 4, 0]], len: 200,
    was: { regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: [...SONG_TEMPO, [160, 92, 4, 4, 0]] },
  });
  const items = call('list_media_items', track(4), {
    regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO, len: 200,
    items: [[16, 30, 0.5, 2, 0, 0], [48, 31, 0, 0.5, 0, 0], [82, 28, 1, 0, 0, 1], [112, 31, 0, 0, 0, 0], [160, 31, 0, 4, 1, 0]],
  });
  const mixer = call('list_tracks', {}, {
    total: 10,
    tracks: [
      ['Drums', 0, '#f9a8d4', -3, 0, 'F'], ['Kick', 1, '#f9a8d4', -4.5, 0, ''], ['Snare', 1, '#f9a8d4', -8, 0.05, ''], ['Overheads', 1, '#f9a8d4', -12, 0, ''],
      ['Bass', 0, '#fcd34d', -12, 0, 'R'], ['Guitars', 0, '#a3e635', -2, 0, 'F'], ['Gtr L', 1, '#a3e635', -9, -1, ''], ['Gtr R', 1, '#a3e635', -9, 1, ''],
      ['Vox', 0, '#7cc4ff', 1.5, 0, 'S'], ['Vox Dbl', 0, '', -9, 0, 'M'],
    ],
    master: ['Master', 0, '', -0.3, 0, ''],
  });
  const plan = call('run_plan', { ops: '[…]', dryRun: true }, {
    total: 4, dryRun: true,
    ops: [['add_track', 'Vox Bus'], ['add_fx', '$bus · VST3: Pro-C 2'], ['add_send', 'Vox → $bus'], ['set_track', 'Vox']],
  });
  return [
    story('Track volume', volume, 'One track, before → after'),
    story('Several tracks', batch, 'Volume above 0, pan, mute'),
    story('FX parameters', fx, 'The plugin’s own readout; unchanged rows fade'),
    story('Automation added', envelope, 'New points over the curve before'),
    story('Automation listed', pan, 'Pan envelope, no before'),
    story('Automation removed', removed, 'A range cleared: removed points dashed'),
    story('Notes added', melody, 'A melody over the chords it kept'),
    story('Note deleted', deleted, 'The removed note dashed'),
    story('Large MIDI item', big, 'First 256 of 2044 notes'),
    story('MIDI analysis', drums, 'Velocity per pitch, machine gun on the hi-hat'),
    story('Markers listed', markers, 'Regions and markers'),
    story('Marker added', added, 'The new marker underlined'),
    story('Tempo change', tempo, 'A 3/4 bridge at 88 BPM'),
    story('Items listed', items, 'Fades, a muted item, a MIDI item'),
    story('Mixer', mixer, 'Folders, mute, solo, arm, a hot fader'),
    story('Plan', plan, 'A dry run'),
  ];
}

/** Every edit view in its states */
export const EDIT_STORIES: Story[] = editStories();

/** The details drawer for the kinds of call it shows differently */
export const DRAWER_STORIES: Story[] = (() => {
  const measured = MEASUREMENT_STORIES[3];
  const failed = call('add_fx', { trackIndex: 3, fxName: 'VST3: Pro-Q 4' }, undefined, {
    ok: false,
    e: 'FX "VST3: Pro-Q 4" not found on track 3. Installed match candidates: Pro-Q 3',
    ms: 22.4,
  });
  const long = call('render_project', { bounds: 'time_selection', overwrite: true }, undefined, { ms: 4655 });
  const slow = call('get_fx_parameters', { trackIndex: 3, fxIndex: 0 }, undefined, { ms: 612 });
  const bare = call('list_tracks', {}, undefined, { p: undefined, ms: 3.1 });
  return [
    { ...measured, title: 'With a result', note: 'A measurement, its params and the previous call' },
    story('Error', failed, 'Failed call with its message'),
    story('Long-running', long, 'Slow by nature, so not marked slow'),
    story('Very slow', slow, 'Over 500 ms'),
    story('No params', bare),
  ];
})();
