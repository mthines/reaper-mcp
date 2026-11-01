/**
 * Chord names, qualities and roman numerals, and two ways to pick them. Templates: chords from 12-bin pitch-class profiles (C first), one per bar or beat: each profile is
 * compared (cosine) with a template per root and quality, triads are preferred over
 * four-note chords unless the extra note is clearly there, and chords that belong to the
 * key get a small bonus. A change needs to beat the chord before it by a margin, so a
 * passing note does not split a bar. The chord model: its Harte labels (parseHarte) mapped onto the
 * grid by largest overlap (modelPicks). Either way equal neighbours merge into one span (mergeSpans).
 */

import { PITCH_CLASSES, SCALE, type KeyEstimate } from './key.js';

export type Quality =
  | 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '7' | 'maj7' | 'm7'
  // Only from the chord model (Harte labels); the templates match the nine above
  | 'dim7' | 'm7b5' | '6' | 'm6' | '9' | 'maj9' | 'm9' | 'mMaj7' | '5' | '11' | '13';

interface QualityInfo {
  /** Appended to the root: "Am7" */
  suffix: string;
  /** Appended to the roman numeral: "ii7" */
  roman: string;
  /** Semitones above the root */
  steps: number[];
  /** Lower-case numeral (minor third) */
  minorish: boolean;
  /** Template score offset; absent = not a template (model only) */
  bias?: number;
}

const QUALITIES: Record<Quality, QualityInfo> = {
  maj: { suffix: '', roman: '', steps: [0, 4, 7], minorish: false, bias: 0 },
  min: { suffix: 'm', roman: '', steps: [0, 3, 7], minorish: true, bias: 0 },
  '7': { suffix: '7', roman: '7', steps: [0, 4, 7, 10], minorish: false, bias: -0.02 },
  maj7: { suffix: 'maj7', roman: 'maj7', steps: [0, 4, 7, 11], minorish: false, bias: -0.02 },
  m7: { suffix: 'm7', roman: '7', steps: [0, 3, 7, 10], minorish: true, bias: -0.02 },
  sus2: { suffix: 'sus2', roman: 'sus2', steps: [0, 2, 7], minorish: false, bias: -0.04 },
  sus4: { suffix: 'sus4', roman: 'sus4', steps: [0, 5, 7], minorish: false, bias: -0.04 },
  dim: { suffix: 'dim', roman: '°', steps: [0, 3, 6], minorish: true, bias: -0.04 },
  aug: { suffix: 'aug', roman: '+', steps: [0, 4, 8], minorish: false, bias: -0.05 },
  dim7: { suffix: 'dim7', roman: '°7', steps: [0, 3, 6, 9], minorish: true },
  m7b5: { suffix: 'm7b5', roman: 'ø7', steps: [0, 3, 6, 10], minorish: true },
  '6': { suffix: '6', roman: '6', steps: [0, 4, 7, 9], minorish: false },
  m6: { suffix: 'm6', roman: '6', steps: [0, 3, 7, 9], minorish: true },
  '9': { suffix: '9', roman: '9', steps: [0, 4, 7, 10, 2], minorish: false },
  maj9: { suffix: 'maj9', roman: 'maj9', steps: [0, 4, 7, 11, 2], minorish: false },
  m9: { suffix: 'm9', roman: '9', steps: [0, 3, 7, 10, 2], minorish: true },
  mMaj7: { suffix: 'm(maj7)', roman: 'maj7', steps: [0, 3, 7, 11], minorish: true },
  '5': { suffix: '5', roman: '5', steps: [0, 7], minorish: false },
  '11': { suffix: '11', roman: '11', steps: [0, 4, 7, 10, 2, 5], minorish: false },
  '13': { suffix: '13', roman: '13', steps: [0, 4, 7, 10, 2, 9], minorish: false },
};

/** Score under which a segment counts as no chord ("N") */
const MIN_SCORE = 0.6;
/** Bonus for a chord whose notes are all in the key */
const IN_KEY_BONUS = 0.03;
/** How much a new chord must beat the one before it to start a new span */
const HOLD_MARGIN = 0.03;

export interface ChordMatch {
  /** e.g. "Am", "G7", "N" for no chord */
  chord: string;
  root?: string;
  quality?: Quality;
  /** 0..1: cosine similarity with the chord's template */
  score: number;
}

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

function cosine(profile: number[], tones: Set<number>): number {
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < 12; i++) {
    norm += profile[i] ** 2;
    if (tones.has(i)) dot += profile[i];
  }
  return norm > 0 ? dot / (Math.sqrt(norm) * Math.sqrt(tones.size)) : 0;
}

/** Pitch classes of the key's scale; in a minor key the raised 7th too (the major V) */
function keyTones(key: Pick<KeyEstimate, 'tonic' | 'mode'> | null): Set<number> | null {
  if (!key) return null;
  const t = PITCH_CLASSES.indexOf(key.tonic as (typeof PITCH_CLASSES)[number]);
  const steps: number[] = [...SCALE[key.mode], ...(key.mode === 'minor' ? [11] : [])];
  return new Set(steps.map((s) => (t + s) % 12));
}

interface Candidate { root: number; quality: Quality; tones: Set<number> }
const CANDIDATES: Candidate[] = [];
for (let root = 0; root < 12; root++) {
  for (const [quality, q] of Object.entries(QUALITIES) as [Quality, QualityInfo][]) {
    if (q.bias === undefined) continue;
    CANDIDATES.push({ root, quality, tones: new Set(q.steps.map((s) => (root + s) % 12)) });
  }
}

const chordName = (root: number, quality: Quality) => PITCH_CLASSES[root] + QUALITIES[quality].suffix;

/** Every candidate's weighted score for a profile, best first. */
function scoreAll(profile: number[], inKey: Set<number> | null): { c: Candidate; raw: number; weighted: number }[] {
  return CANDIDATES.map((c) => {
    const raw = cosine(profile, c.tones);
    const diatonic = inKey && [...c.tones].every((t) => inKey.has(t));
    return { c, raw, weighted: raw + (QUALITIES[c.quality].bias ?? 0) + (diatonic ? IN_KEY_BONUS : 0) };
  }).sort((a, b) => b.weighted - a.weighted);
}

/** The best chord for one profile, or "N" for silence or no clear chord. */
export function matchChord(profile: number[], key: Pick<KeyEstimate, 'tonic' | 'mode'> | null = null): ChordMatch {
  if (profile.length !== 12 || !profile.some((x) => x > 0)) return { chord: 'N', score: 0 };
  const [best] = scoreAll(profile, keyTones(key));
  if (best.raw < MIN_SCORE) return { chord: 'N', score: round(best.raw) };
  return { chord: chordName(best.c.root, best.c.quality), root: PITCH_CLASSES[best.c.root], quality: best.c.quality, score: round(best.raw) };
}

const MAJOR_NUMERALS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♭V', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const MINOR_NUMERALS = ['I', '♭II', 'II', 'III', '♯III', 'IV', '♭V', 'V', 'VI', '♯VI', 'VII', '♯VII'];

/** The chord's roman numeral in the key: upper case for major, lower for minor, ° diminished, + augmented. */
export function romanNumeral(root: string, quality: Quality, key: Pick<KeyEstimate, 'tonic' | 'mode'>): string {
  const t = PITCH_CLASSES.indexOf(key.tonic as (typeof PITCH_CLASSES)[number]);
  const r = PITCH_CLASSES.indexOf(root as (typeof PITCH_CLASSES)[number]);
  const base = (key.mode === 'major' ? MAJOR_NUMERALS : MINOR_NUMERALS)[(r - t + 12) % 12];
  const q = QUALITIES[quality];
  return (q.minorish ? base.toLowerCase() : base) + q.roman;
}

export interface Segment {
  start: number;
  end: number;
  /** 1-based bar and beat on the project grid (absent for a file without a tempo) */
  bar?: number;
  beat?: number;
  profile: number[];
  /** Lowest held MIDI note, when known (MIDI source), else -1 or absent */
  bass?: number;
}

export interface ChordSpan {
  start: number;
  end: number;
  bar?: number;
  beat?: number;
  /** Segments (bars or beats) the chord lasts */
  length: number;
  chord: string;
  root?: string;
  quality?: Quality;
  /** Roman numeral in the detected key */
  roman?: string;
  /** Lowest held note's pitch class when it is not the root ("C/E"): MIDI only */
  bass?: string;
  /** MIDI note for a bass line: the bass (or root) between E1 (28) and D#2 (39) */
  bassMidi?: number;
  /** 0..1: mean template fit over the span */
  score: number;
}

/** One segment's chord, before merging: a pitch-class root and quality, or none ("N"). */
export interface ChordPick {
  root?: number;
  quality?: Quality;
  /** Pitch class of the bass when it is not the root (a slash chord) */
  bassPc?: number;
  /** 0..1: template fit, or the share of the segment the model's chord covers */
  score: number;
}

/** Template picks: the best chord per segment, holding the previous one unless a new one clearly wins. */
function templatePicks(segments: Segment[], key: Pick<KeyEstimate, 'tonic' | 'mode'> | null): ChordPick[] {
  const inKey = keyTones(key);
  const picks: ChordPick[] = [];
  let prev: Candidate | undefined;
  for (const s of segments) {
    if (!s.profile.some((x) => x > 0)) {
      picks.push({ score: 0 });
      prev = undefined;
      continue;
    }
    const ranked = scoreAll(s.profile, inKey);
    let pick = ranked[0];
    if (prev) {
      const held = ranked.find((x) => x.c === prev);
      if (held && held.raw >= MIN_SCORE && held.weighted >= pick.weighted - HOLD_MARGIN) pick = held;
    }
    if (pick.raw < MIN_SCORE) {
      picks.push({ score: pick.raw });
      prev = undefined;
      continue;
    }
    const bassPc = s.bass !== undefined && s.bass >= 0 ? s.bass % 12 : undefined;
    picks.push({ root: pick.c.root, quality: pick.c.quality, score: pick.raw, ...(bassPc !== undefined && bassPc !== pick.c.root ? { bassPc } : {}) });
    prev = pick.c;
  }
  return picks;
}

/**
 * One chord per segment (holding the previous chord unless a new one clearly wins), merged
 * into spans of equal chords.
 */
export function chordSpans(segments: Segment[], key: Pick<KeyEstimate, 'tonic' | 'mode'> | null): ChordSpan[] {
  return mergeSpans(segments, templatePicks(segments, key), key);
}

/** Picked chords (one per segment) merged into spans of equal chords, with roman numerals and a bass note. */
export function mergeSpans(
  segments: Pick<Segment, 'start' | 'end' | 'bar' | 'beat'>[],
  picks: ChordPick[],
  key: Pick<KeyEstimate, 'tonic' | 'mode'> | null,
): ChordSpan[] {
  const spans: ChordSpan[] = [];
  let scores: number[] = [];
  segments.forEach((s, i) => {
    const p = picks[i] ?? { score: 0 };
    const has = p.root !== undefined && p.quality !== undefined;
    const chord = has ? chordName(p.root as number, p.quality as Quality) : 'N';
    const bass = has && p.bassPc !== undefined && p.bassPc !== p.root ? PITCH_CLASSES[p.bassPc] : undefined;
    const last = spans[spans.length - 1];
    if (last && last.chord.split('/')[0] === chord && last.bass === bass && Math.abs(last.end - s.start) < 1e-3) {
      last.end = round(s.end);
      last.length += 1;
      scores.push(p.score);
      last.score = round(scores.reduce((a, x) => a + x, 0) / scores.length);
      return;
    }
    scores = [p.score];
    const span: ChordSpan = {
      start: round(s.start), end: round(s.end), ...(s.bar !== undefined ? { bar: s.bar, beat: s.beat } : {}),
      length: 1, chord, score: round(p.score),
    };
    if (has) {
      const root = p.root as number;
      const quality = p.quality as Quality;
      span.root = PITCH_CLASSES[root];
      span.quality = quality;
      if (key) span.roman = romanNumeral(span.root, quality, key);
      if (bass) {
        span.bass = bass;
        span.chord = `${chord}/${bass}`;
      }
      span.bassMidi = 28 + (((p.bassPc ?? root) - 4 + 12) % 12);
    }
    spans.push(span);
  });
  return spans;
}

// ---------------------------------------------------------------------------
// The chord model's labels (Harte syntax, as in JAMS / MIREX): "C:maj", "A:min7", "C:maj/3",
// "Bb:7(b9)", "N" (no chord), "X" (unknown)
// ---------------------------------------------------------------------------

const HARTE_QUALITY: Record<string, Quality> = {
  maj: 'maj', min: 'min', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4',
  '7': '7', maj7: 'maj7', min7: 'm7', dim7: 'dim7', hdim7: 'm7b5', maj6: '6', min6: 'm6',
  '9': '9', maj9: 'maj9', min9: 'm9', minmaj7: 'mMaj7', '5': '5', '1': '5', '11': '11', '13': '13',
  min11: 'm9', maj11: 'maj9', maj13: 'maj9', min13: 'm9',
};
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEGREE: Record<string, number> = { '1': 0, '2': 2, '3': 4, '4': 5, '5': 7, '6': 9, '7': 11, '9': 2, '11': 5, '13': 9 };

/** Semitones of a Harte interval ("3", "b7", "#4"), or undefined. */
function degreeSemitones(degree: string): number | undefined {
  const m = /^([b#]*)(\d+)$/.exec(degree.trim());
  if (!m || DEGREE[m[2]] === undefined) return undefined;
  const shift = [...m[1]].reduce((a, c) => a + (c === '#' ? 1 : -1), 0);
  return (((DEGREE[m[2]] + shift) % 12) + 12) % 12;
}

/** A Harte label as a pick: root and quality (unknown qualities fall back to min or maj), and a slash bass. */
export function parseHarte(label: string): Omit<ChordPick, 'score'> | null {
  const trimmed = label.trim();
  if (!trimmed || trimmed === 'N' || trimmed === 'X') return null;
  const [main, bassDegree] = trimmed.split('/');
  const colon = main.indexOf(':');
  const rootText = colon >= 0 ? main.slice(0, colon) : main;
  const m = /^([A-G])([b#]*)$/.exec(rootText);
  if (!m) return null;
  const root = ((NATURAL[m[1]] + [...m[2]].reduce((a, c) => a + (c === '#' ? 1 : -1), 0)) % 12 + 12) % 12;
  const qualityText = colon >= 0 ? main.slice(colon + 1) : '';
  // "maj(9)" or "(1,b3,5)": extensions in brackets, or a bare interval list
  const bare = qualityText.replace(/\(.*\)/, '');
  let quality: Quality;
  if (!bare) quality = /\bb3\b/.test(qualityText) ? 'min' : 'maj';
  else quality = HARTE_QUALITY[bare] ?? (bare.startsWith('min') ? 'min' : 'maj');
  const pick: Omit<ChordPick, 'score'> = { root, quality };
  if (bassDegree) {
    const step = degreeSemitones(bassDegree);
    if (step !== undefined && step !== 0) pick.bassPc = (root + step) % 12;
  }
  return pick;
}

/** A labelled stretch of time from the chord model (seconds) */
export interface ModelSegment { start: number; end: number; label: string }

/**
 * The model's chords on our grid: each segment takes the label covering most of it
 * ("N" and "X" count together as no chord); the score is the share it covers.
 */
export function modelPicks(grid: Pick<Segment, 'start' | 'end'>[], model: ModelSegment[]): ChordPick[] {
  const sorted = [...model].sort((a, b) => a.start - b.start);
  return grid.map((g) => {
    const length = g.end - g.start;
    if (length <= 0) return { score: 0 };
    const cover = new Map<string, number>();
    for (const m of sorted) {
      if (m.end <= g.start) continue;
      if (m.start >= g.end) break;
      const parsed = parseHarte(m.label);
      const id = parsed ? `${parsed.root}:${parsed.quality}:${parsed.bassPc ?? ''}` : 'N';
      cover.set(id, (cover.get(id) ?? 0) + Math.min(m.end, g.end) - Math.max(m.start, g.start));
    }
    let best = 'N';
    let bestCover = 0;
    for (const [id, c] of cover) if (c > bestCover + 1e-9) { best = id; bestCover = c; }
    const score = round(bestCover / length);
    if (best === 'N') return { score };
    const [root, quality, bassPc] = best.split(':');
    return { root: Number(root), quality: quality as Quality, score, ...(bassPc ? { bassPc: Number(bassPc) } : {}) };
  });
}

/** A key profile from the model's chords: each chord's tones weighted by its duration, the root counted 1.5 times. */
export function chordProfile(model: ModelSegment[]): number[] {
  const profile = new Array(12).fill(0);
  for (const m of model) {
    const p = parseHarte(m.label);
    const d = m.end - m.start;
    if (!p || p.root === undefined || !p.quality || d <= 0) continue;
    for (const step of QUALITIES[p.quality].steps) profile[(p.root + step) % 12] += d * (step === 0 ? 1.5 : 1);
  }
  return profile;
}

/** "Am F C G": each span's chord once, in order (no-chord spans skipped). */
export function progression(spans: ChordSpan[]): string {
  return spans.filter((s) => s.chord !== 'N').map((s) => s.chord).join(' ');
}
