import { measurementOf, type CommandEntry, type Measurement } from '../lib/commands.js';
import { editViewOf, type EditViewData } from '../features/edit-views/index.js';
import { demoSnapshots, type RequestState, type RowMode, type SnapshotOp, type SnapshotsFeed } from '../features/snapshots/index.js';

/**
 * Fixed example data for the Storybook stories (and `?demo`): every measurement, edit view, drawer and
 * Snapshots state the page can draw. Add an example here with every new component state.
 */

export interface Example {
  title: string;
  /** What state this shows, in a few words */
  note?: string;
  entry: CommandEntry;
  /** The same command on the same track, newest first, `entry` included: drives the previous-call marks */
  history: CommandEntry[];
}

/** A fixed "now" so the stories' relative times read the same on every load */
export const EXAMPLE_NOW = Date.UTC(2026, 9, 29, 20, 30);

let seq = 100;
function call(c: string, params: Record<string, unknown>, r: Record<string, unknown> | undefined, opts: Partial<CommandEntry> = {}): CommandEntry {
  seq += 1;
  return { n: seq, t: EXAMPLE_NOW - 60_000 + seq * 1000, c, ms: 4.2, ok: true, s: 'example', p: JSON.stringify(params), r, ...opts };
}

/** The same call made two minutes earlier, with other results */
function earlier(e: CommandEntry, r: Record<string, unknown>): CommandEntry {
  return { ...e, n: e.n - 50, t: e.t - 120_000, r };
}

const example = (title: string, entry: CommandEntry, note?: string, previous?: CommandEntry): Example => ({
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

/** A rendered file row: name, length, LUFS-I, true peak, sample peak and 60 waveform slices peaking at `top` */
function renderFile(name: string, dur: number, lufs: number, tp: number, peak: number, top: number): unknown[] {
  // A song's shape on the dB scale: quiet intro, verses, louder choruses, a breakdown and a fade, with slice-to-slice jitter
  const section = (i: number) => (i < 6 ? 0.06 + i * 0.03 : i < 18 ? 0.45 : i < 26 ? 0.95 : i < 36 ? 0.5 : i < 42 ? 0.15 : i < 54 ? 1 : (60 - i) / 6);
  const hi = Array.from({ length: 60 }, (_, i) => Math.round(Math.min(1, top * section(i) * (0.82 + 0.18 * Math.abs(Math.sin(i * 2.3)))) * 100) / 100);
  return [name, dur, lufs, tp, peak, hi, hi.map((v) => -Math.round(v * 0.94 * 100) / 100)];
}

const track = (trackIndex: number, extra: Record<string, unknown> = {}) => ({ trackIndex, ...extra });

function measurementExampleList(): Example[] {
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

  const render = { trackIndex: 0, startTime: 30, endTime: 35, commandId: 'example' };
  const wave = call('render_track_to_wav', render, { ...waveform(0.55), rmsDb: -19.4, clipped: 0 }, { ms: 912 });
  const waveClipped = call('render_track_to_wav', { ...render, trackIndex: 1 }, { ...waveform(1.1, 0.06), rmsDb: -11.2, clipped: 37 }, { ms: 1043 });
  const waveQuiet = call('render_track_to_wav', { ...render, trackIndex: 2 }, { ...waveform(0.06, 0.004), rmsDb: -42.5, clipped: 0 }, { ms: 870 });

  // Sidecar tools, logged by the server with `_log_result`
  const SONG_SECTIONS = [-16.2, -15.8, -11.4, -9.6, -9.1, -12.8, -15.1, -9.2, -8.7, -9.4, -14, -18.5].map((l, i) => [i * 15, i * 15 + 15, l]);
  const offlineR = {
    name: 'Master', lufs: -10.4, lra: 6.8, tp: -0.6, peak: -0.9, crest: 9.1, dur: 180, sib: 4,
    sections: SONG_SECTIONS, bands: [-15.2, -4.6, -8.9, -6.1, -11.8, -16.4, -18.9], res: [[315, 6.2], [2480, 4.1]],
  };
  const offline = call('analyze_track_offline', { trackIndex: -1, startTime: 0, durationSeconds: 180, sectionSeconds: 15 }, offlineR, { ms: 11_840 });
  const offlineRef = call('analyze_track_offline', { trackIndex: -1, durationSeconds: 180, referencePath: '/refs/Pop Ref.wav' }, {
    ...offlineR, ref: { lufs: -8.6, delta: -1.8, bands: [-0.8, 3.4, 1.2, 0.2, -1.6, -3.7, -2.9] },
  }, { ms: 14_210 });
  const audioFile = call('analyze_audio_file', { path: '/refs/Pop Ref.wav', sectionSeconds: 15 }, {
    ...offlineR, name: 'Pop Ref.wav', lufs: -8.6, lra: 4.2, tp: -0.1, crest: 7.4, sib: 0, res: [],
    sections: SONG_SECTIONS.map(([a, b, l]) => [a, b, l + 1.6]),
  }, { ms: 2_930 });
  const align = call('measure_track_alignment', { referenceTrack: 2, trackIndex: 3, startTime: 12 }, {
    ref: 'Snare Top', name: 'Snare Btm', delayMs: 0.84, samples: 37, corr: 0.93, inv: 1, cur: 0, offset: -0.84, phase: 1,
  }, { ms: 3_120 });
  const alignUnsure = call('measure_track_alignment', { referenceTrack: 2, trackIndex: 9, startTime: 12 }, {
    ref: 'Snare Top', name: 'Room', delayMs: -9.84, samples: -434, corr: 0.01, inv: 0, cur: 0, warn: 1,
  }, { ms: 3_040 });
  const aesthetics = call('analyze_track_aesthetics', { trackIndex: -1, startTime: 60 }, {
    name: 'Master', pq: 7.42, pc: 5.81, ce: 6.66, cu: 7.05, lufs: -18, dur: 30,
  }, { ms: 6_400 });
  // A song's short-term loudness, one point a second: quiet verses, loud choruses
  const song = (lift: number) => SONG_SECTIONS.flatMap(([, , l], i) =>
    Array.from({ length: 15 }, (_, k) => Math.round((l + lift + Math.sin((i * 15 + k) / 2.3) * 0.9 - (k < 2 && i > 0 ? 1.5 : 0)) * 10) / 10));
  const curveR = {
    name: 'Master', lufs: -10.4, tp: -0.6, lra: 6.8, plr: 9.8, maxM: -6.9, target: -14, overS: 86, start: 0, step: 1, term: 's',
    curve: song(0), loud: [124, 127, -7.8], quiet: [176, 179, -19.3],
    over: [[30, 76, -8.6], [105, 150, -7.8]],
  };
  const curve = call('analyze_loudness_curve', { trackIndex: -1, endTime: 180, targetLufs: -14 }, curveR, { ms: 9_800 });
  const curveShort = call('analyze_loudness_curve', { path: '/bounces/Hook.wav' }, {
    name: 'Hook', lufs: -16.8, tp: -3.2, lra: 1.4, plr: 13.6, start: 0, step: 0.1, term: 'm',
    curve: Array.from({ length: 24 }, (_, i) => -17 + Math.sin(i / 2) * 2), loud: null, quiet: null, over: [],
  }, { ms: 410 });
  const stereoR = {
    name: 'Master', dur: 180, flags: ['low end wide (correlation 0.42): mono the bass below 120 Hz'],
    bands: [['low', 0.42, -0.31, 0.08, -6.2], ['lowMid', 0.71, 0.12, 0.01, -9.4], ['mid', 0.55, -0.12, 0.04, -7.1], ['high', 0.38, -0.22, 0.09, -4.8], ['air', 0.21, -0.4, 0.18, -3.1]],
  };
  const stereo = call('analyze_stereo_bands', { trackIndex: -1, endTime: 180 }, stereoR, { ms: 8_200 });
  const stereoPhase = call('analyze_stereo_bands', { trackIndex: 4 }, {
    name: 'Synth Pad', dur: 60, flags: ['low end out of phase (correlation −0.62): it cancels in mono', 'the low mids (120–500 Hz) out of phase overall (correlation −0.18): it cancels in mono'],
    bands: [['low', -0.62, -0.91, 0.84, 4.1], ['lowMid', -0.18, -0.7, 0.61, 1.2], ['mid', 0.34, -0.3, 0.22, -3.3], ['high', 0.51, 0.02, 0.05, -5.6], ['air', null, null, null, null]],
  }, { ms: 3_100 });
  const MASK_HZ = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
  const bump = (centre: number, width: number, peak: number) => MASK_HZ.map((_, k) => Math.round(Math.max(0, peak * (1 - Math.abs(k - centre) / width)) * 100) / 100);
  const maskingR = {
    tracks: ['Kick', 'Bass', 'Keys', 'Vocal'], hz: MASK_HZ,
    pairs: [
      ['Kick', 'Bass', 0.31, bump(4, 4, 0.92)],
      ['Keys', 'Vocal', 0.24, bump(13, 5, 0.74)],
      ['Bass', 'Keys', 0.12, bump(8, 3, 0.48)],
      ['Kick', 'Keys', 0.03, bump(19, 2, 0.21)],
      ['Kick', 'Vocal', 0.01, bump(20, 1, 0.1)],
      ['Bass', 'Vocal', 0, bump(0, 0, 0)],
    ],
    conflicts: [
      ['Kick', 'Bass', 100, 0.92, 'cut Bass around 100 Hz (it matters more to Kick)'],
      ['Keys', 'Vocal', 800, 0.74, 'cut Keys around 800 Hz (it matters more to Vocal)'],
      ['Bass', 'Keys', 250, 0.48, 'cut Keys around 250 Hz (it matters more to Bass)'],
    ],
  };
  const masking = call('measure_masking', { tracks: [0, 1, 5, 9], startTime: 48, durationSeconds: 20 }, maskingR, { ms: 6_900 });
  const maskingClear = call('measure_masking', { tracks: [0, 12], startTime: 48 }, {
    tracks: ['Kick', 'Hi-hat'], hz: MASK_HZ, pairs: [['Kick', 'Hi-hat', 0, bump(0, 0, 0)]], conflicts: [],
  }, { ms: 2_400 });
  const stemsR = {
    name: 'Master', model: 'htdemucs', device: 'mps', secs: 180, proc: 61.4, inserted: 4, folder: 'Master stems',
    stems: [['drums', -14.2, -1.8], ['bass', -16.9, -4.1], ['other', -15.3, -2.6], ['vocals', -13.1, 0.7]],
  };
  const stems = call('separate_stems', { trackIndex: -1, endTime: 180, insertTracks: true }, stemsR, { ms: 64_200 });
  const stems6 = call('separate_stems', { path: '/refs/Live Take.flac', model: 'htdemucs_6s', stems: ['guitar', 'piano', 'vocals'] }, {
    name: 'Live Take', model: 'htdemucs_6s', device: 'cpu', secs: 45, proc: 52.3,
    stems: [['vocals', -17.4, -5.2], ['guitar', -19.8, -7.9], ['piano', null, -61.2]],
  }, { ms: 54_800 });

  const key = call('detect_key', { trackIndex: 7 }, {
    name: undefined, src: 'midi', key: 'A minor', tonic: 'A', mode: 'minor', r: 0.89, conf: 0.62, rel: 'C major',
    alt: [['C major', 0.82], ['D minor', 0.71], ['F major', 0.66]],
    chroma: [0.81, 0.04, 0.38, 0.06, 0.74, 0.31, 0.03, 0.47, 0.05, 1, 0.07, 0.22],
  }, { ms: 140 });
  const keyAudio = call('detect_key', { trackIndex: 3, endTime: 60 }, {
    name: 'Gtr Bus', src: 'audio', key: 'D major', tonic: 'D', mode: 'major', r: 0.61, conf: 0.14, rel: 'B minor',
    alt: [['G major', 0.58], ['A major', 0.55], ['E minor', 0.52]],
    chroma: [0.55, 0.42, 1, 0.38, 0.71, 0.49, 0.83, 0.77, 0.44, 0.92, 0.4, 0.58],
  }, { ms: 4_820 });

  return [
    example('Meters', meters, 'Comfortable levels'),
    example('Meters · hot', metersHot, 'Peaks above −6 dB turn amber, previous call ghosted', earlier(metersHot, { peakL: -6.8, peakR: -7.4, rmsL: -18.2, rmsR: -18.9 })),
    example('Meters · over', metersOver, 'Peaks over 0 dB turn red'),
    example('Loudness · on target', lufs, 'Within ±1 LU of the agent’s target', earlier(lufs, { integrated: -16.1, shortTerm: -15.2, momentary: -14.8, truePeakL: -3, truePeakR: -3.2, duration: 30 })),
    example('Loudness · over target', lufsOver, 'Louder than the target, true peak over 0'),
    example('Loudness · no target', lufsBare, 'The agent gave no target'),
    example('Correlation', corr, 'Mostly mono-compatible', earlier(corr, { correlation: 0.64, stereoWidth: 1.3, midLevel: -14.5, sideLevel: -21.9 })),
    example('Correlation · phase', corrPhase, 'Negative correlation is out of phase'),
    example('Crest', crest, 'Dynamic', earlier(crest, { crestFactor: 9.8, peakLevel: -4.1, rmsLevel: -13.9 })),
    example('Crest · squashed', crestHot, 'Little crest, peak near 0'),
    example('Spectrum', spectrum, 'Previous call dashed; hover for values', earlier(spectrum, { ...spec, peakDb: -9.1, rmsDb: -19.9, bands: bands(-3, 1) })),
    example('Spectrum · hot', spectrumHot, 'Bands near 0 dB turn amber, then red'),
    example('Waveform', wave, 'A render’s waveform on a dB scale; hover for values', earlier(wave, { ...waveform(0.45), rmsDb: -21.2, clipped: 0 })),
    example('Waveform · clipped', waveClipped, 'Clipped samples counted and named'),
    example('Waveform · quiet', waveQuiet, 'Quiet material still fills the height'),
    example('Offline analysis', offline, 'Sections, band balance, resonances; previous call ghosted', earlier(offline, { ...offlineR, lufs: -11.6 })),
    example('Offline · against a reference', offlineRef, 'Loudness and band balance against a reference file'),
    example('Audio file', audioFile, 'A reference on disk, no REAPER involved', earlier(audioFile, { ...offlineR, lufs: -8.6 })),
    example('Alignment', align, 'Bottom mic 0.84 ms late and inverted; the fix', earlier(align, { ref: 'Snare Top', name: 'Snare Btm', delayMs: 0.02, samples: 1, corr: 0.95, inv: 0, cur: -0.84, offset: -0.84, phase: 1 })),
    example('Alignment · unsure', alignUnsure, 'Low correlation: no fix suggested'),
    example('Aesthetics', aesthetics, 'Four scores on 0–10; previous call ghosted', earlier(aesthetics, { name: 'Master', pq: 7.18, pc: 5.9, ce: 6.4, cu: 6.95, lufs: -18, dur: 30 })),
    example('Key · MIDI', key, 'A minor from the notes: scale tones lit, the tonic strongest', earlier(key, { src: 'midi', key: 'C major', tonic: 'C', mode: 'major', r: 0.8, conf: 0.4, rel: 'A minor', alt: [], chroma: [1, 0.04, 0.4, 0.06, 0.7, 0.35, 0.03, 0.8, 0.05, 0.6, 0.07, 0.2] })),
    example('Key · audio, unsure', keyAudio, 'A dense guitar bus: low confidence flagged'),
    example('Loudness curve', curve, 'Short-term loudness against −14 LUFS: spans over target shaded, previous call dashed; hover for values',
      earlier(curve, { ...curveR, lufs: -9.1, curve: song(1.3), over: [[28, 80, -7.3], [100, 165, -6.5]] })),
    example('Loudness curve · short clip', curveShort, 'Under 3 s: momentary only, no target'),
    example('Stereo per band', stereo, 'A wide low end flagged; previous call ghosted',
      earlier(stereo, { ...stereoR, bands: stereoR.bands.map(([b, c, ...rest]) => [b, Math.min(1, (c as number) + 0.3), ...rest]) })),
    example('Stereo per band · out of phase', stereoPhase, 'Bands below 0 cancel in mono: red, named; a silent band says so'),
    example('Masking', masking, 'Pairs by band: Kick × Bass fight at 100 Hz; which to cut',
      earlier(masking, { ...maskingR, pairs: maskingR.pairs.map(([a, b, o, sc]) => [a, b, (o as number) * 1.4, sc]) })),
    example('Masking · clear', maskingClear, 'Nothing masks'),
    example('Stems', stems, 'Four stems inserted under a folder; vocals peak over 0 kept as float', earlier(stems, { ...stemsR, proc: 58.2 })),
    example('Stems · 6-stem model on a CPU', stems6, 'Three of six stems written to disk only; a silent stem'),
  ];
}

/** Every measuring command in its states */
export const MEASUREMENT_EXAMPLES: Example[] = measurementExampleList();

/** Volume automation: a dip at 12–17 s added over a flat line */
const VOLUME_BEFORE = [[0, 0, 0], [32, 0, 0]];
const VOLUME_AFTER = [[0, 0, 0], [8, 0, 0], [12, -2.5, 2], [13.5, -6, 0], [16, -6, 2], [17.5, -1.5, 0], [24, -1.5, 2], [26, 2, 0], [32, 2, 0]];

/** Four bars of chords, plus a melody this call added */
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]].flatMap((c, i) => c.map((p) => [p, i * 4, 4, 72, 0]));
const MELODY = [[72, 0, 1, 96], [71, 1, 0.5, 88], [69, 1.5, 1.5, 104], [67, 4, 1, 92], [69, 5, 1, 100], [72, 8, 2, 112], [74, 10, 2, 108], [72, 12, 4, 84]].map((n) => [...n, 1]);

const SONG_REGIONS = [[0, 16, 'Intro', '', 1], [16, 48, 'Verse 1', '#7cc4ff', 2], [48, 80, 'Chorus', '#c4a5ff', 3], [80, 112, 'Verse 2', '#7cc4ff', 4], [112, 144, 'Chorus', '#c4a5ff', 5], [144, 160, 'Bridge', '#fcd34d', 6], [160, 192, 'Chorus', '#c4a5ff', 7], [192, 200, 'Outro', '', 8]];
const SONG_MARKERS = [[18, 'Vox in', '', 1], [140, 'Fill', '', 3]];
const SONG_TEMPO = [[0, 92, 4, 4, 0]];

function editExampleList(): Example[] {
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
  // A song's lead vocal: one pool per section type, so every chorus shares one level curve
  const VERSE: [number, number, number][] = [[0, -1, 0], [64, -1, 0]];
  const CHORUS: [number, number, number][] = [[0, 0.5, 0], [30, 0.5, 2], [32, 1.5, 0]];
  const sections = [
    [56, 64, 1, 'Vox Verse'], [120, 32, 2, 'Vox Chorus'], [152, 52, 1, 'Vox Verse'], [204, 32, 2, 'Vox Chorus'],
    [236, 16, 3, 'Vox C'], [292, 32, 2, 'Vox Chorus'],
  ];
  const pooled = call('insert_automation_item', track(79, { envelopeIndex: 0, position: 292, length: 32, poolId: 2 }), {
    env: 'Volume', unit: 'dB', from: 20, to: 360, count: 1, pts: [[0, 0, 0]], was: [[0, 0, 0]], ai: 5,
    ais: sections, pools: [[1, VERSE], [2, CHORUS], [3, [[0, -2, 0], [16, -2, 0]]]],
    wasAis: sections.slice(0, 5), wasPools: [[1, VERSE], [2, CHORUS], [3, [[0, -2, 0], [16, -2, 0]]]],
  });
  const poolEdit = call('edit_envelope_points', track(79, { envelopeIndex: 0, automationItemIndex: 1, points: '[…]' }), {
    env: 'Volume', unit: 'dB', from: 100, to: 256, count: 1, pts: [[0, 0, 0]], was: [[0, 0, 0]], ai: 1,
    ais: sections, pools: [[1, VERSE], [2, CHORUS.map(([t, d, sh]) => [t, d - 1, sh])], [3, [[0, -2, 0], [16, -2, 0]]]],
    wasAis: sections, wasPools: [[1, VERSE], [2, CHORUS], [3, [[0, -2, 0], [16, -2, 0]]]],
  });
  const aiGone = call('delete_automation_item', track(79, { envelopeIndex: 0, automationItemIndex: 4 }), {
    env: 'Volume', unit: 'dB', from: 220, to: 268, count: 1, pts: [[0, 0, 0]], was: [[0, 0, 0]],
    ais: sections.filter((_, i) => i !== 4), pools: [[1, VERSE], [2, CHORUS]],
    wasAis: sections, wasPools: [[1, VERSE], [2, CHORUS], [3, [[0, -2, 0], [16, -2, 0]]]],
  });
  const melody = call('insert_midi_notes', { trackIndex: 7, itemIndex: 0, notes: '[…]' }, {
    total: CHORDS.length + MELODY.length, beats: 16, ts: [4, 4], more: 0, gone: [], notes: [...CHORDS, ...MELODY],
  });
  // A played-in line, a little early and late, snapped to 8ths at full strength
  const LOOSE = MELODY.map(([p, s, l, v], i) => [p, s + [0.06, -0.08, 0.11, -0.04, 0.09, -0.07, 0.05, 0.12][i], l, v]);
  const quantized = call('quantize_midi', { trackIndex: 7, itemIndex: 0, grid: 0.5 }, {
    total: CHORDS.length + MELODY.length, beats: 16, ts: [4, 4], more: 0, notes: [...CHORDS, ...MELODY], gone: LOOSE,
  });
  const imported = call('import_midi_file', { path: '/Users/me/Sketches/hook.mid', trackIndex: 7, position: 0 }, {
    total: CHORDS.length + MELODY.length, beats: 16, ts: [4, 4], more: 0, gone: [], notes: [...CHORDS, ...MELODY].map((n) => [...n.slice(0, 4), 1]),
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
  // A real session's density: twelve markers in six minutes, several seconds apart (the labels have to give way)
  const denseMarkers: Array<[number, string, string, number]> = [
    [0, 'COUNT', '', 1], [4, 'PRESET', '', 2], [62, '12 Ret guitar', '', 3], [70, 'Fill', '', 4], [96, 'Ret guitar', '', 5],
    [100, 'Drop', '', 6], [150, 'Lead', '', 7], [208, 'TILFØJ', '', 8], [212, 'Stik', '', 9], [216, 'Solo', '', 10],
    [300, 'Break', '', 11], [330, 'END', '', 12],
  ];
  const dense = call('list_markers', {}, { regions: SONG_REGIONS.map((r) => [Number(r[0]) * 1.8, Number(r[1]) * 1.8, r[2], r[3], r[4]]), markers: denseMarkers, tempo: SONG_TEMPO, len: 366 });
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
  const MIX = [
    ['Drums', 0, '#f9a8d4', -3, 0, 'F'], ['Kick', 1, '#f9a8d4', -4.5, 0, ''], ['Snare', 1, '#f9a8d4', -8, 0.05, ''],
    ['Bass', 0, '#fcd34d', -12, 0, ''], ['Vox', 0, '#7cc4ff', 1.5, 0, ''], ['Old Vox', 0, '', -9, 0, 'M'],
  ];
  const MIX_IDS = ['d1', 'k2', 's3', 'b4', 'v5', 'o6'];
  const structure = call('add_track', { name: 'Vox Bus', index: 5 }, {
    total: 6,
    // Vox Bus added, Old Vox deleted earlier in the same plan, Bass moved above the drums
    tracks: [MIX[3], MIX[0], MIX[1], MIX[2], MIX[4], ['Vox Bus', 0, '#7cc4ff', 0, 0, '']],
    ids: ['b4', 'd1', 'k2', 's3', 'v5', 'vb7'],
    was: { tracks: MIX, ids: MIX_IDS },
    master: ['Master', 0, '', -0.3, 0, ''],
  });
  const VOX_CHAIN = [
    ['VST3: Pro-Q 3 (FabFilter)', '', 'a1', ''], ['VST3: Pro-C 2 (FabFilter)', '', 'b2', 'Vocal Leveler'],
    ['JS: De-esser', '', 'c3', ''], ['VST3: Saturn 2 (FabFilter)', '', 'd4', ''],
  ];
  const fxBypass = call('set_fx_enabled', track(8, { fxIndex: 3, enabled: 0 }), {
    chains: [{ t: 'Vox', fx: [...VOX_CHAIN.slice(0, 3), ['VST3: Saturn 2 (FabFilter)', 'B', 'd4', '']], was: VOX_CHAIN }],
  });
  const fxAdded = call('add_fx', track(8, { fxName: 'ReaComp', position: 1 }), {
    chains: [{ t: 'Vox', fx: [VOX_CHAIN[0], ['VST: ReaComp (Cockos)', '', 'e5', ''], VOX_CHAIN[1], VOX_CHAIN[3]], was: VOX_CHAIN }],
  });
  const fxMoved = call('move_fx', track(8, { fxIndex: 2, toTrackIndex: 9, toFxIndex: 0 }), {
    chains: [
      { t: 'Vox', fx: [VOX_CHAIN[0], VOX_CHAIN[1], VOX_CHAIN[3]], was: VOX_CHAIN },
      { t: 'Vox Dbl', fx: [VOX_CHAIN[2], ['VST3: Pro-Q 3 (FabFilter)', 'O', 'f6', '']], was: [['VST3: Pro-Q 3 (FabFilter)', 'O', 'f6', '']] },
    ],
  });
  const fxListed = call('get_track_properties', track(8), {
    chains: [{ t: 'Vox', fx: [...VOX_CHAIN.slice(0, 3), ['VST3: Saturn 2 (FabFilter)', 'BO', 'd4', '']] }],
  });
  const routing = call('add_send', { from: 'Vox', to: 'Vox Bus', volume: -6 }, {
    t: 'Vox',
    routes: [['s', 'Verb', -12, 0, ''], ['s', 'Vox Bus', -6, 0, ''], ['s', 'Delay', -16, -0.3, 'M'], ['h', 'Out 3/4', 0, 0, '']],
    was: [['s', 'Verb', -14, 0, ''], ['s', 'Delay', -16, -0.3, 'M'], ['h', 'Out 3/4', 0, 0, ''], ['r', 'Vox Dbl', -3, 0, '']],
  });
  const routingListed = call('get_track_routing', track(10), {
    t: 'Verb', routes: [['r', 'Vox', -12, 0, ''], ['r', 'Gtr L', -18, -0.6, ''], ['r', 'Gtr R', -18, 0.6, ''], ['r', 'Snare', -20, 0, 'M']],
  });
  const ITEMS = [[16, 30, 0.5, 2, 0, 0], [48, 31, 0, 0.5, 0, 0], [112, 31, 0, 0, 0, 0]];
  const itemMoved = call('move_media_item', track(4, { itemIndex: 1, newTrackIndex: 5, newPosition: 82 }), {
    regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO, len: 200,
    lanes: [
      { t: 'Gtr L', items: [ITEMS[0], ITEMS[2]], was: ITEMS },
      { t: 'Gtr R', items: [[82, 31, 0, 0.5, 0, 0], [160, 31, 0, 4, 0, 0]], was: [[160, 31, 0, 4, 0, 0]] },
    ],
  });
  const itemSplit = call('split_media_item', track(4, { itemIndex: 0, position: 30 }), {
    regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO, len: 200,
    lanes: [{ t: 'Gtr L', items: [[16, 14, 0.5, 0, 0, 0], [30, 16, 0, 2, 0, 0], ITEMS[1], ITEMS[2]], was: ITEMS }],
  });
  const midiItems = call('list_midi_items', track(7), {
    regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO, len: 200,
    lanes: [{ t: 'Keys', items: [[16, 32, 0, 0, 1, 0], [48, 32, 0, 0, 1, 0], [112, 32, 0, 0, 1, 1], [160, 32, 0, 0, 1, 0]] }],
  });
  const selection = call('set_time_selection', { start: 48, end: 80 }, {
    regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO, len: 200,
    sel: [48, 80], cur: 48, wasSel: [16, 48], wasCur: 12.5,
  });
  const fxParams = call('get_fx_parameters', track(8, { fxIndex: 1 }), {
    more: 41,
    rows: [
      { t: 'Pro-C 2', p: 'Threshold', s: 'norm', b: 0.62, bt: '−18.0 dB' },
      { t: 'Pro-C 2', p: 'Ratio', s: 'norm', b: 0.3, bt: '3.0:1' },
      { t: 'Pro-C 2', p: 'Attack', s: 'norm', b: 0.18, bt: '4.5 ms' },
      { t: 'Pro-C 2', p: 'Release', s: 'norm', b: 0.44, bt: '120 ms' },
      { t: 'Pro-C 2', p: 'Knee', s: 'norm', b: 0.5, bt: '12 dB' },
    ],
  });
  const cc = call('insert_midi_cc', { trackIndex: 7, itemIndex: 0, ccNumber: 11, value: 30, position: 12 }, {
    env: 'CC 11 · Expression', unit: 'cc', beats: 1, from: 0, to: 17, count: 9, otherCcs: 2,
    pts: [[0, 64, 1], [2, 80, 1], [4, 96, 1], [6, 110, 1], [8, 100, 1], [10, 72, 1], [12, 30, 1], [14, 48, 1], [15.5, 90, 1]],
    was: [[0, 64, 1], [2, 80, 1], [4, 96, 1], [6, 110, 1], [8, 100, 1], [10, 72, 1], [14, 48, 1], [15.5, 90, 1]],
  });
  // Arrangement: the song with its 16 s bridge (144–160)
  const shift = (r: (string | number)[], by: number, from: number) => (r[0] as number) >= from ? [(r[0] as number) + by, (r[1] as number) + by, ...r.slice(2)] : r;
  const noBridge = SONG_REGIONS.filter((r) => r[2] !== 'Bridge').map((r) => shift(r, -16, 160));
  const inserted = call('insert_time', { position: 144, length: 16 }, {
    op: 'insert', span: [144, 160], moreTracks: 6,
    regions: SONG_REGIONS.map((r) => shift(r, 16, 144)), markers: SONG_MARKERS, tempo: SONG_TEMPO, len: 216,
    was: { regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO },
    lanes: [
      { t: 'Drums', items: [[0, 144, 0, 0, 0, 0], [160, 56, 0, 2, 0, 0]], was: [[0, 200, 0, 2, 0, 0]] },
      { t: 'Gtr L', items: [ITEMS[0], ITEMS[1], ITEMS[2], [176, 31, 0, 4, 0, 0]], was: [ITEMS[0], ITEMS[1], ITEMS[2], [160, 31, 0, 4, 0, 0]] },
    ],
  });
  const cut = call('remove_time', { start: 144, end: 160 }, {
    op: 'remove', span: [144, 160], moreTracks: 6,
    regions: noBridge, markers: SONG_MARKERS, tempo: SONG_TEMPO, len: 200,
    was: { regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO },
    lanes: [
      { t: 'Drums', items: [[0, 144, 0, 0, 0, 0], [144, 40, 0, 2, 0, 0]], was: [[0, 200, 0, 2, 0, 0]] },
      { t: 'Gtr L', items: [ITEMS[0], ITEMS[1], ITEMS[2], [144, 31, 0, 4, 0, 0]], was: [ITEMS[0], ITEMS[1], ITEMS[2], [160, 31, 0, 4, 0, 0]] },
    ],
  });
  const section = call('copy_section', { regionIndex: 2, position: 200 }, {
    op: 'section', span: [48, 80], to: [200, 232],
    regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO, len: 232,
    was: { regions: SONG_REGIONS, markers: SONG_MARKERS, tempo: SONG_TEMPO },
    lanes: [
      { t: 'Gtr L', items: [...ITEMS, [200, 31, 0, 0.5, 0, 0]], was: ITEMS },
      { t: 'Vox', items: [[18, 28, 0.2, 0.5, 0, 0], [52, 26, 0.2, 1, 0, 0], [204, 26, 0.2, 1, 0, 0]], was: [[18, 28, 0.2, 0.5, 0, 0], [52, 26, 0.2, 1, 0, 0]] },
    ],
  });
  const repeated = call('copy_media_items', { items: '[{"trackIndex":7,"itemIndex":0}]', times: 3 }, {
    op: 'copy', span: [16, 24], to: [24, 48],
    regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO, len: 200,
    was: { regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO },
    lanes: [{ t: 'Keys', items: [[16, 8, 0, 0, 1, 0], [24, 8, 0, 0, 1, 0], [32, 8, 0, 0, 1, 0], [40, 8, 0, 0, 1, 0]], was: [[16, 8, 0, 0, 1, 0]] }],
  });
  const normalized = call('process_items', { operation: 'normalize', items: '[…]', target: -1 }, {
    op: 'normalize',
    regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO, len: 200,
    was: { regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO },
    lanes: [
      { t: 'Gtr L', items: [[16, 30, 0.5, 2, 0, 0, 11], [48, 31, 0, 0.5, 0, 0, 5.5]], was: [[16, 30, 0.5, 2, 0, 0, 0], [48, 31, 0, 0.5, 0, 0, 0]] },
    ],
  });
  const glued = call('process_items', { operation: 'glue', items: '[…]' }, {
    op: 'glue',
    regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO, len: 200,
    was: { regions: SONG_REGIONS, markers: [], tempo: SONG_TEMPO },
    lanes: [{ t: 'Gtr L', items: [[16, 63, 0.5, 0.5, 0, 0], ITEMS[2]], was: [[16, 14, 0.5, 0, 0, 0], [30, 16, 0, 2, 0, 0], ITEMS[1], ITEMS[2]] }],
  });
  const plan = call('run_plan', { ops: '[…]', dryRun: true }, {
    total: 4, dryRun: true,
    ops: [['add_track', 'Vox Bus'], ['add_fx', '$bus · VST3: Pro-C 2'], ['add_send', 'Vox → $bus'], ['set_track', 'Vox']],
  });
  const renderMaster = call('render_project', { overwrite: true }, {
    fmt: 'wav', bd: '24', src: 'master', norm: 'lufs_i', nt: -14, lim: -1, tp: true,
    groups: [{ v: '', m: [], f: [renderFile('Night Drive (Master).wav', 214.6, -14.1, -1.02, -1.4, 0.8)] }],
  });
  const renderOver = call('render_project', {}, {
    fmt: 'flac', bd: '16', src: 'master', norm: 'lufs_i', nt: -14,
    groups: [{ v: '', m: [], f: [renderFile('Night Drive (Loud).flac', 214.6, -9.8, 0.4, 0.1, 1)] }],
  });
  const renderStems = call('render_project', { tracks: '["Drums","Bass","Keys","Vocals"]' }, {
    fmt: 'wav', bd: '32f', src: 'stems',
    groups: [{ v: '', m: [], f: [
      renderFile('Drums.wav', 214.6, -17.2, -2.1, -2.6, 0.75), renderFile('Bass.wav', 214.6, -19.8, -5.3, -5.9, 0.5),
      renderFile('Keys.wav', 214.6, -24.5, -9.1, -9.6, 0.3), renderFile('Lead Vocal Double (Harmony).wav', 214.6, -21.3, -0.6, -0.9, 0.85),
    ] }],
  });
  const renderVersions = call('render_versions', { versions: '[…]' }, {
    fmt: 'mp3', kbps: 320, src: 'master', norm: 'lufs_i', nt: -14, lim: -1, tp: true,
    groups: [
      { v: 'Full', m: [], f: [renderFile('song-Full.mp3', 214.6, -14, -1.1, -1.3, 0.8)] },
      { v: 'Instrumental', m: ['Lead Vox', 'Vox Dbl', 'Backing Vox'], f: [renderFile('song-Instrumental.mp3', 214.6, -14.2, -1.05, -1.3, 0.7)] },
      { v: 'TV', m: ['Lead Vox'], f: [renderFile('song-TV.mp3', 214.6, -13.9, -1.2, -1.5, 0.72)] },
    ],
  });
  return [
    example('Track volume', volume, 'One track, before → after'),
    example('Several tracks', batch, 'Volume above 0, pan, mute'),
    example('FX parameters', fx, 'The plugin’s own readout; unchanged rows fade'),
    example('Automation added', envelope, 'New points over the curve before'),
    example('Automation listed', pan, 'Pan envelope, no before'),
    example('Automation removed', removed, 'A range cleared: removed points dashed'),
    example('Automation items pooled', pooled, 'One pool per section type; the new chorus instance outlined'),
    example('Pool edited', poolEdit, 'One chorus edited, every chorus follows; the old curve dashed'),
    example('Automation item deleted', aiGone, 'The C section’s item gone, its place dashed'),
    example('Notes added', melody, 'A melody over the chords it kept'),
    example('Note deleted', deleted, 'The removed note dashed'),
    example('MIDI quantized', quantized, 'A played-in melody snapped to 8ths: where each note was, dashed'),
    example('MIDI file imported', imported, 'Every note new, from a .mid without REAPER’s dialog'),
    example('Large MIDI item', big, 'First 256 of 2044 notes'),
    example('MIDI analysis', drums, 'Velocity per pitch, machine gun on the hi-hat'),
    example('Markers listed', markers, 'Regions and markers'),
    example('Markers · dense', dense, 'Labels that would collide show on hover'),
    example('Marker added', added, 'The new marker underlined'),
    example('Tempo change', tempo, 'A 3/4 bridge at 88 BPM'),
    example('Items listed', items, 'Fades, a muted item, a MIDI item'),
    example('Mixer', mixer, 'Folders, mute, solo, arm, a hot fader'),
    example('Tracks changed', structure, 'Added, moved and removed tracks marked'),
    example('FX bypassed', fxBypass, 'The chain after, the bypassed slot marked'),
    example('FX added', fxAdded, 'Inserted mid-chain; the removed one struck through'),
    example('FX moved to another track', fxMoved, 'Both chains, before → after'),
    example('FX chain listed', fxListed, 'Presets, a bypassed and offline slot'),
    example('Send added', routing, 'New, changed and removed routes; was-level ghosted'),
    example('Routing listed', routingListed, 'A bus and its receives'),
    example('Item moved', itemMoved, 'From one track to another; where it was dashed'),
    example('Item split', itemSplit, 'One item became two'),
    example('MIDI items listed', midiItems, 'One lane, a muted item'),
    example('Time selection', selection, 'Selection and cursor, where they were dashed'),
    example('FX parameters listed', fxParams, 'The plugin’s readout, first parameters only'),
    example('MIDI CC inserted', cc, 'A controller lane in beats, held between events'),
    example('Plan', plan, 'A dry run'),
    example('Arrange · time inserted', inserted, 'A 16 s gap opened at 2:24: everything after moves, the drum item split'),
    example('Arrange · time removed', cut, 'The bridge cut: its region gone, the rest pulled back'),
    example('Arrange · section copied', section, 'The chorus (outlined) copied to the end (hatched)'),
    example('Arrange · items repeated', repeated, 'A 4-bar MIDI loop repeated 3 times'),
    example('Arrange · normalized', normalized, 'Item gain to −1 dB peak, the gain each item got'),
    example('Arrange · glued', glued, 'Three items became one'),
    example('Render · on target', renderMaster, 'Normalized to −14 LUFS, true-peak limited at −1'),
    example('Render · off target', renderOver, 'Louder than the target, true peak over 0'),
    example('Render · stems', renderStems, 'One file per selected track, 32-bit float, no target'),
    example('Render · versions', renderVersions, 'Full, instrumental and TV mix in one call; muted tracks named'),
  ];
}

/** Every edit view in its states */
export const EDIT_EXAMPLES: Example[] = editExampleList();

/** The details drawer for the kinds of call it shows differently */
export const DRAWER_EXAMPLES: Example[] = (() => {
  const measured = MEASUREMENT_EXAMPLES[3];
  const refused = call('add_fx', { trackIndex: 3, fxName: 'VST3: Pro-Q 4' }, undefined, {
    ok: false,
    e: 'FX "VST3: Pro-Q 4" not found on track 3. Installed match candidates: Pro-Q 3',
    ms: 22.4,
  });
  const failed = call('send_midi_cc', { trackIndex: 0, cc: 1, value: 64 }, undefined, {
    ok: false,
    e: 'Internal error: reaper-mcp/mcp_midi_emitter was inserted but could not be found in the MCP Meters container',
    ms: 3.1,
  });
  const long = call('render_project', { bounds: 'time_selection', overwrite: true }, undefined, { ms: 4655 });
  const slow = call('get_fx_parameters', { trackIndex: 3, fxIndex: 0 }, undefined, { ms: 612 });
  const bare = call('list_tracks', {}, undefined, { p: undefined, ms: 3.1 });
  return [
    { ...measured, title: 'With a result', note: 'A measurement, its params and the previous call' },
    example('Refused', refused, 'An expected rejection: a warning, not counted as an error'),
    example('Error', failed, 'A system error: counted, and notified when enabled'),
    example('Long-running', long, 'Slow by nature, so not marked slow'),
    example('Very slow', slow, 'Over 500 ms'),
    example('No params', bare),
    example('From this page', call('snapshot_restore', { name: 'mix-B' }, undefined, { s: undefined, src: 'page', ms: 38.2 }), 'A snapshot loaded from the Snapshots view'),
  ];
})();

/** The Snapshots view in one state: the list A/B/C is played from, a request in each state, the save form */
export interface SnapshotExample {
  title: string;
  note?: string;
  feed: SnapshotsFeed | null;
  request: RequestState | null;
  blocked: string | null;
  /** Show only the save form, with this name typed (and the replace prompt open) */
  saveForm?: { name: string; confirm?: boolean };
  /** A row in rename or delete-confirm mode */
  row?: RowMode;
  /** Drawn in a narrow column */
  narrow?: boolean;
}

export const SNAPSHOT_EXAMPLES: SnapshotExample[] = (() => {
  const feed = demoSnapshots(EXAMPLE_NOW);
  const req = (op: SnapshotOp, name: string) => ({ id: '17618', op, name, at: EXAMPLE_NOW - 2_000 });
  const readonlyError = "Read-only mode is on in the MCP Bridge window: 'snapshot_restore' would change the project. Ask the user to turn read-only off.";
  return [
    { title: 'List', note: 'mix-B loaded; 1–9 load from the keyboard', feed, request: null, blocked: null },
    { title: 'Loading', note: 'Waiting for the bridge', feed, request: { ...req('restore', 'mix-C'), state: 'pending' }, blocked: null },
    {
      title: 'Loaded with warnings',
      note: 'A track renamed since the save',
      feed: { ...feed, current: 'mix-A' },
      request: {
        ...req('restore', 'mix-A'),
        state: 'done',
        result: { id: '17618', op: 'restore', name: 'mix-A', ok: true, tracksRestored: 24, warnings: ["Track 4: is now 'Gtr L' (saved as 'Guitar L')"] },
      },
      blocked: null,
    },
    { title: 'Saved', feed, request: { ...req('save', 'mix-C'), state: 'done', result: { id: '17618', op: 'save', name: 'mix-C', ok: true } }, blocked: null },
    {
      title: 'Refused',
      note: 'Read-only was switched on meanwhile',
      feed,
      request: { ...req('restore', 'mix-A'), state: 'done', result: { id: '17618', op: 'restore', name: 'mix-A', ok: false, error: readonlyError } },
      blocked: null,
    },
    { title: 'No answer', note: 'The bridge script stopped', feed, request: { ...req('save', 'mix-D'), state: 'lost' }, blocked: null },
    { title: 'Read-only', note: 'Restore and save off', feed, request: null, blocked: 'Read-only: turn it off in Settings to restore or save snapshots' },
    { title: 'Empty', note: 'Unsaved project', feed: { v: 1, storage: 'global', snapshots: [] }, request: null, blocked: null },
    { title: 'Waiting for the list', feed: null, request: null, blocked: null },
    { title: 'Save · replaces', note: 'A name already saved', feed, request: null, blocked: null, saveForm: { name: 'mix-B' } },
    { title: 'Save · confirm replace', feed, request: null, blocked: null, saveForm: { name: 'mix-B', confirm: true } },
    { title: 'Deleted', feed, request: { ...req('delete', 'mix-A'), state: 'done', result: { id: '17618', op: 'delete', name: 'mix-A', ok: true } }, blocked: null },
    { title: 'Delete · confirm', note: 'Delete asks once, in the row', feed, request: null, blocked: null, row: { name: 'mix-B', mode: 'delete' } },
    { title: 'Rename', note: 'Name and description, in place of the row', feed, request: null, blocked: null, row: { name: 'mix-B', mode: 'edit' } },
    { title: 'Narrow', note: 'Under ~420px', feed, request: { ...req('restore', 'mix-B'), state: 'pending' }, blocked: null, narrow: true },
  ];
})();

type MeasurementOf<K extends Measurement['kind']> = Extract<Measurement, { kind: K }>;

/** The measurement examples of one kind as the drawer reads them, with the previous call's reading (or null) */
export function measuredExamples<K extends Measurement['kind']>(kind: K) {
  return MEASUREMENT_EXAMPLES.flatMap((x) => {
    const m = measurementOf(x.entry);
    if (m?.kind !== kind) return [];
    const previous = x.history.find((h) => h.n < x.entry.n);
    const was = previous ? measurementOf(previous) : null;
    return [{ ...x, previous, m: m as MeasurementOf<K>, was: was?.kind === kind ? (was as MeasurementOf<K>) : null }];
  });
}

/** The edit view examples of one kind, as the drawer reads them */
export function editExamples<K extends EditViewData['kind']>(kind: K) {
  return EDIT_EXAMPLES.flatMap((x) => {
    const v = editViewOf(x.entry);
    return v?.kind === kind ? [{ ...x, v: v as Extract<EditViewData, { kind: K }> }] : [];
  });
}
