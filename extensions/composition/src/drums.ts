/** Step-sequencer drum notation → MIDI notes. Pure: no REAPER, no I/O. */
import type { Note } from './chords.js';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Lane name → MIDI note. Only drums the kit really has are listed. */
export const DRUM_MAPS: Record<string, Record<string, number>> = {
  gm: {
    kick: 36, sidestick: 37, snare: 38, clap: 39, tom_floor: 41, hihat: 42, pedal_hat: 44, tom_low: 45,
    open_hat: 46, tom_mid: 47, tom_high: 50, crash: 49, ride: 51, china: 52, splash: 55, cowbell: 56,
  },
  // GetGood Drums Invasion (Kontakt, C3 = 60): not GM. Right foot kick; alternate with `kick_l` when two kicks are <= a 16th apart.
  invasion: {
    kick: 24, kick_l: 23, snare: 26, sidestick: 30, tom_high: 33, tom_mid: 34, tom_low: 35, tom_floor: 36,
    hihat: 43, open_hat: 45, pedal_hat: 48, crash: 52, crash_r: 54, ride: 62, ride_bell: 61, ride_edge: 63,
    china: 65, china_r: 67, splash: 73,
  },
};

export const STEP_VELOCITY: Record<string, number> = { x: 100, X: 120, o: 60 };
const RESTS = new Set(['-', '.', '_']);

export interface PatternOptions {
  /** A map name from DRUM_MAPS, or "custom" (every lane then needs a note number). */
  map: string;
  /** Extra lane name → note, overriding the map. */
  pitches: Record<string, number>;
  stepsPerBeat: number;
  beatsPerBar: number;
  /** Repeat the written pattern this many times. */
  repeat: number;
  /** 0-1: delay every second step by up to a third of a step. */
  swing: number;
  /** Beat (from the item start) the pattern starts at. */
  startBeat: number;
  /** Note length in beats; defaults to one step. */
  noteLength?: number;
}

export interface Pattern {
  notes: Note[];
  /** The written pattern's length in beats and the whole thing with repeats. */
  patternBeats: number;
  endBeat: number;
  lanes: { lane: string; pitch: number; hits: number }[];
}

/** Lane keys may be a lane name or a plain note number ("36"). */
function resolvePitch(lane: string, o: PatternOptions): Result<number> {
  if (Object.hasOwn(o.pitches, lane)) return { ok: true, value: o.pitches[lane] };
  if (/^\d+$/.test(lane)) {
    const n = Number(lane);
    return n <= 127 ? { ok: true, value: n } : { ok: false, error: `lane "${lane}" is not a note number 0-127` };
  }
  const map = DRUM_MAPS[o.map];
  if (map && Object.hasOwn(map, lane)) return { ok: true, value: map[lane] };
  const known = map ? Object.keys(map).join(', ') : 'none, pass pitches';
  return { ok: false, error: `lane "${lane}" has no note in the "${o.map}" map (lanes: ${known}); pass it in pitches or use a note number` };
}

export function buildPattern(lanes: Record<string, string>, o: PatternOptions): Result<Pattern> {
  const names = Object.keys(lanes);
  if (names.length === 0) return { ok: false, error: 'no lanes given' };
  if (o.map !== 'custom' && !(o.map in DRUM_MAPS)) return { ok: false, error: `unknown map "${o.map}" (${[...Object.keys(DRUM_MAPS), 'custom'].join(', ')})` };

  const cleaned: Record<string, string[]> = {};
  for (const lane of names) {
    // Spaces and "|" are only for reading: "x--- x--- | x---"
    const steps = [...lanes[lane].replace(/[\s|]/g, '')];
    const bad = steps.find((c) => !(c in STEP_VELOCITY) && !RESTS.has(c));
    if (bad !== undefined) return { ok: false, error: `lane "${lane}": "${bad}" is not a step; use x (hit), X (accent), o (ghost) and - (rest)` };
    cleaned[lane] = steps;
  }
  const length = Math.max(...Object.values(cleaned).map((s) => s.length));
  if (length === 0) return { ok: false, error: 'every lane is empty' };
  const short = names.find((l) => cleaned[l].length !== length);
  if (short) return { ok: false, error: `lane "${short}" has ${cleaned[short].length} steps but the longest lane has ${length}; pad it with "-"` };

  const stepBeats = 1 / o.stepsPerBeat;
  const noteLen = o.noteLength ?? stepBeats;
  const patternBeats = length * stepBeats;
  const notes: Note[] = [];
  const summary: Pattern['lanes'] = [];
  for (const lane of names) {
    const p = resolvePitch(lane, o);
    if (!p.ok) return p;
    let hits = 0;
    for (let r = 0; r < o.repeat; r++) {
      cleaned[lane].forEach((c, i) => {
        const velocity = STEP_VELOCITY[c];
        if (velocity === undefined) return;
        const swung = i % 2 === 1 ? o.swing * (stepBeats / 3) : 0;
        notes.push({ pitch: p.value, velocity, startPosition: o.startBeat + r * patternBeats + i * stepBeats + swung, duration: noteLen });
        hits++;
      });
    }
    summary.push({ lane, pitch: p.value, hits });
  }
  notes.sort((a, b) => a.startPosition - b.startPosition || a.pitch - b.pitch);
  return { ok: true, value: { notes, patternBeats, endBeat: o.startBeat + patternBeats * o.repeat, lanes: summary } };
}
