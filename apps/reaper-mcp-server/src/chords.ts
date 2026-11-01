/**
 * Chords from 12-bin pitch-class profiles (C first), one per bar or beat: each profile is
 * compared (cosine) with a template per root and quality, triads are preferred over
 * four-note chords unless the extra note is clearly there, and chords that belong to the
 * key get a small bonus. A change needs to beat the chord before it by a margin, so a
 * passing note does not split a bar. Equal neighbours merge into one span.
 */

import { PITCH_CLASSES, SCALE, type KeyEstimate } from './key.js';

export type Quality = 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '7' | 'maj7' | 'm7';

const QUALITIES: Record<Quality, { suffix: string; steps: number[]; bias: number }> = {
  maj: { suffix: '', steps: [0, 4, 7], bias: 0 },
  min: { suffix: 'm', steps: [0, 3, 7], bias: 0 },
  '7': { suffix: '7', steps: [0, 4, 7, 10], bias: -0.02 },
  maj7: { suffix: 'maj7', steps: [0, 4, 7, 11], bias: -0.02 },
  m7: { suffix: 'm7', steps: [0, 3, 7, 10], bias: -0.02 },
  sus2: { suffix: 'sus2', steps: [0, 2, 7], bias: -0.04 },
  sus4: { suffix: 'sus4', steps: [0, 5, 7], bias: -0.04 },
  dim: { suffix: 'dim', steps: [0, 3, 6], bias: -0.04 },
  aug: { suffix: 'aug', steps: [0, 4, 8], bias: -0.05 },
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
  for (const [quality, q] of Object.entries(QUALITIES) as [Quality, (typeof QUALITIES)[Quality]][]) {
    CANDIDATES.push({ root, quality, tones: new Set(q.steps.map((s) => (root + s) % 12)) });
  }
}

const chordName = (root: number, quality: Quality) => PITCH_CLASSES[root] + QUALITIES[quality].suffix;

/** Every candidate's weighted score for a profile, best first. */
function scoreAll(profile: number[], inKey: Set<number> | null): { c: Candidate; raw: number; weighted: number }[] {
  return CANDIDATES.map((c) => {
    const raw = cosine(profile, c.tones);
    const diatonic = inKey && [...c.tones].every((t) => inKey.has(t));
    return { c, raw, weighted: raw + QUALITIES[c.quality].bias + (diatonic ? IN_KEY_BONUS : 0) };
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
  const minorish = quality === 'min' || quality === 'm7' || quality === 'dim';
  const numeral = minorish ? base.toLowerCase() : base;
  const suffix: Record<Quality, string> = { maj: '', min: '', dim: '°', aug: '+', sus2: 'sus2', sus4: 'sus4', '7': '7', maj7: 'maj7', m7: '7' };
  return numeral + suffix[quality];
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

/**
 * One chord per segment (holding the previous chord unless a new one clearly wins), merged
 * into spans of equal chords.
 */
export function chordSpans(segments: Segment[], key: Pick<KeyEstimate, 'tonic' | 'mode'> | null): ChordSpan[] {
  const inKey = keyTones(key);
  const picks: { m: ChordMatch; c?: Candidate }[] = [];
  let prev: Candidate | undefined;
  for (const s of segments) {
    if (!s.profile.some((x) => x > 0)) {
      picks.push({ m: { chord: 'N', score: 0 } });
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
      picks.push({ m: { chord: 'N', score: round(pick.raw) } });
      prev = undefined;
      continue;
    }
    picks.push({ m: { chord: chordName(pick.c.root, pick.c.quality), root: PITCH_CLASSES[pick.c.root], quality: pick.c.quality, score: pick.raw }, c: pick.c });
    prev = pick.c;
  }

  const spans: ChordSpan[] = [];
  let scores: number[] = [];
  segments.forEach((s, i) => {
    const { m } = picks[i];
    const bassPc = s.bass !== undefined && s.bass >= 0 ? s.bass % 12 : undefined;
    const last = spans[spans.length - 1];
    const sameBass = last && (last.bass ?? null) === (bassPc !== undefined && m.root && PITCH_CLASSES[bassPc] !== m.root ? PITCH_CLASSES[bassPc] : null);
    if (last && last.chord.split('/')[0] === m.chord && sameBass && Math.abs(last.end - s.start) < 1e-3) {
      last.end = s.end;
      last.length += 1;
      scores.push(m.score);
      last.score = round(scores.reduce((a, x) => a + x, 0) / scores.length);
      return;
    }
    scores = [m.score];
    const span: ChordSpan = {
      start: round(s.start), end: round(s.end), ...(s.bar !== undefined ? { bar: s.bar, beat: s.beat } : {}),
      length: 1, chord: m.chord, score: round(m.score),
    };
    if (m.root && m.quality) {
      span.root = m.root;
      span.quality = m.quality;
      if (key) span.roman = romanNumeral(m.root, m.quality, key);
      const rootPc = PITCH_CLASSES.indexOf(m.root as (typeof PITCH_CLASSES)[number]);
      const low = bassPc ?? rootPc;
      if (bassPc !== undefined && bassPc !== rootPc) {
        span.bass = PITCH_CLASSES[bassPc];
        span.chord = `${m.chord}/${span.bass}`;
      }
      span.bassMidi = 28 + ((low - 4 + 12) % 12);
    }
    spans.push(span);
  });
  return spans;
}

/** "Am F C G": each span's chord once, in order (no-chord spans skipped). */
export function progression(spans: ChordSpan[]): string {
  return spans.filter((s) => s.chord !== 'N').map((s) => s.chord).join(' ');
}
