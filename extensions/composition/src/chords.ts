/** Chord notation → MIDI pitches. Pure: no REAPER, no I/O. */

export interface Note {
  pitch: number;
  velocity: number;
  startPosition: number;
  duration: number;
}

export interface ParsedChord {
  /** The token as written, for messages. */
  symbol: string;
  /** Pitch class 0-11 of the root and of the slash bass (undefined without one). */
  root: number;
  bass?: number;
  intervals: number[];
  /** Length in beats when the token carries `:beats`. */
  beats?: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const NATURALS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const QUALITIES: Record<string, number[]> = {
  maj: [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  '7sus4': [0, 5, 7, 10],
};

/** Spellings people write, mapped to a key of QUALITIES. Case matters: `M7` is major, `m7` minor. */
const ALIASES: Record<string, string> = {
  '': 'maj', maj: 'maj', M: 'maj',
  m: 'm', min: 'm', '-': 'm',
  dim: 'dim', '°': 'dim',
  aug: 'aug', '+': 'aug',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4',
  '5': '5', '6': '6', m6: 'm6', min6: 'm6',
  '7': '7', dom7: '7',
  maj7: 'maj7', M7: 'maj7', '△7': 'maj7', '∆7': 'maj7',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  mmaj7: 'mmaj7', mM7: 'mmaj7', 'm(maj7)': 'mmaj7',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5',
  dim7: 'dim7', '°7': 'dim7',
  '9': '9', maj9: 'maj9', M9: 'maj9', m9: 'm9', min9: 'm9',
  add9: 'add9',
  '7sus4': '7sus4', '7sus': '7sus4',
};

function pitchClass(text: string): number | undefined {
  const base = NATURALS[text[0]?.toUpperCase() ?? ''];
  if (base === undefined || text[0] !== text[0].toUpperCase()) return undefined;
  let pc = base;
  for (const c of text.slice(1)) {
    if (c === '#' || c === '♯') pc += 1;
    else if (c === 'b' || c === '♭') pc -= 1;
    else return undefined;
  }
  return ((pc % 12) + 12) % 12;
}

/** `Cm7`, `Bb7`, `F#m7b5`, `C/E`, `Am:2` (two beats). */
export function parseChord(token: string): Result<ParsedChord> {
  let body = token;
  let beats: number | undefined;
  const colon = body.lastIndexOf(':');
  if (colon >= 0) {
    beats = Number(body.slice(colon + 1));
    if (!Number.isFinite(beats) || beats <= 0) return { ok: false, error: `"${token}": the length after ":" must be a positive number of beats` };
    body = body.slice(0, colon);
  }
  let bass: number | undefined;
  const slash = body.indexOf('/');
  if (slash >= 0) {
    bass = pitchClass(body.slice(slash + 1));
    if (bass === undefined) return { ok: false, error: `"${token}": "${body.slice(slash + 1)}" is not a note name after "/"` };
    body = body.slice(0, slash);
  }
  const m = /^([A-G][#♯b♭]*)(.*)$/.exec(body);
  if (!m) return { ok: false, error: `"${token}" does not start with a note name A-G` };
  const root = pitchClass(m[1]);
  if (root === undefined) return { ok: false, error: `"${token}": "${m[1]}" is not a note name` };
  const quality = ALIASES[m[2]];
  if (!quality) return { ok: false, error: `"${token}": unknown chord quality "${m[2]}"` };
  return { ok: true, value: { symbol: token, root, ...(bass !== undefined && { bass }), intervals: QUALITIES[quality], ...(beats !== undefined && { beats }) } };
}

/** Split `"Cm7, Fm7 | Bb7 Eb"` into tokens: commas, bar lines and whitespace all separate chords. */
export function parseProgression(text: string): Result<ParsedChord[]> {
  const tokens = text.split(/[,|\s]+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: 'the progression is empty' };
  const chords: ParsedChord[] = [];
  for (const t of tokens) {
    const c = parseChord(t);
    if (!c.ok) return c;
    chords.push(c.value);
  }
  return { ok: true, value: chords };
}

export interface VoicingOptions {
  /** Octave of the chord's root, C4 = 60 (the REAPER/MIDI-note convention used by the other tools). */
  octave: number;
  /** Move the lowest note up an octave this many times. */
  inversion: number;
  /** Add the root (or the slash bass) an octave below. A slash bass is always added. */
  bass: boolean;
  velocity: number;
  beatsPerChord: number;
  startBeat: number;
}

export interface Voiced {
  notes: Note[];
  endBeat: number;
  chords: { symbol: string; startBeat: number; beats: number; pitches: number[] }[];
}

export function voiceProgression(chords: ParsedChord[], o: VoicingOptions): Result<Voiced> {
  const notes: Note[] = [];
  const spans: Voiced['chords'] = [];
  let at = o.startBeat;
  for (const c of chords) {
    const beats = c.beats ?? o.beatsPerChord;
    let pitches = c.intervals.map((i) => 12 * (o.octave + 1) + c.root + i);
    for (let k = 0; k < o.inversion; k++) {
      const [low, ...rest] = pitches;
      pitches = [...rest, low + 12];
    }
    const bassPc = c.bass ?? (o.bass ? c.root : undefined);
    if (bassPc !== undefined) {
      let b = 12 * o.octave + bassPc;
      while (b >= Math.min(...pitches)) b -= 12;
      pitches = [b, ...pitches];
    }
    const out = pitches.find((p) => p < 0 || p > 127);
    if (out !== undefined) return { ok: false, error: `${c.symbol}: pitch ${out} is outside 0-127 (octave ${o.octave}, inversion ${o.inversion}); change the octave` };
    for (const pitch of pitches) notes.push({ pitch, velocity: o.velocity, startPosition: at, duration: beats });
    spans.push({ symbol: c.symbol, startBeat: at, beats, pitches });
    at += beats;
  }
  return { ok: true, value: { notes, endBeat: at, chords: spans } };
}
