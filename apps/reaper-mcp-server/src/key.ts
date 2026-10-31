/**
 * Musical key from a 12-bin pitch-class profile (C first): Krumhansl-Kessler key
 * profiles correlated against all 24 rotations, as in Krumhansl's key-finding
 * algorithm. The profile comes from MIDI note time (detect_key on a MIDI track) or
 * from audio chroma (the sidecar).
 */

export const PITCH_CLASSES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

// Krumhansl & Kessler (1982) probe-tone ratings, tonic first
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Semitones above the tonic of each scale degree (natural minor for minor keys). */
export const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] } as const;

export type Mode = 'major' | 'minor';

export interface KeyCandidate {
  key: string;
  tonic: string;
  mode: Mode;
  /** Pearson correlation with the key's profile, -1..1 */
  r: number;
}

export interface KeyEstimate extends KeyCandidate {
  /** 0..1: how far the best key stands out from the next one (not the relative key), scaled down for a flat profile */
  confidence: number;
  relative: string;
  alternatives: KeyCandidate[];
  /** The profile scaled so its largest bin is 1 */
  chroma: number[];
}

/** Coefficient of variation at and above which a profile counts as fully tonal */
const CONTRAST_FULL = 0.4;

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

const keyName = (tonic: number, mode: Mode) => `${PITCH_CLASSES[tonic]} ${mode}`;

/** Every key ranked by correlation, best first. */
export function rankKeys(profile: number[]): KeyCandidate[] {
  const out: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    // The profile seen from this tonic: index 0 = the tonic's pitch class
    const rotated = profile.map((_, i) => profile[(i + tonic) % 12]);
    for (const mode of ['major', 'minor'] as const) {
      out.push({ key: keyName(tonic, mode), tonic: PITCH_CLASSES[tonic], mode, r: pearson(rotated, mode === 'major' ? MAJOR : MINOR) });
    }
  }
  return out.sort((a, b) => b.r - a.r);
}

/** The relative key: the minor a minor third below a major key, the major a minor third above a minor one. */
export function relativeKey(tonic: string, mode: Mode): string {
  const i = PITCH_CLASSES.indexOf(tonic as (typeof PITCH_CLASSES)[number]);
  return mode === 'major' ? keyName((i + 9) % 12, 'minor') : keyName((i + 3) % 12, 'major');
}

/** The best key for a profile, or null for a profile with no notes (all bins equal). */
export function estimateKey(profile: number[]): KeyEstimate | null {
  if (profile.length !== 12 || profile.some((x) => !Number.isFinite(x) || x < 0)) return null;
  const top = Math.max(...profile);
  if (!(top > 0) || profile.every((x) => x === profile[0])) return null;
  const ranked = rankKeys(profile);
  const best = ranked[0];
  const relative = relativeKey(best.tonic, best.mode);
  // A relative key shares every note, so it says nothing about how sure the pick is
  const rival = ranked.find((k) => k.key !== best.key && k.key !== relative) ?? ranked[1];
  const gap = Math.max(0, Math.min(1, (best.r - rival.r) / Math.max(best.r, 1e-9) * 4));
  // Pearson ignores scale, so a nearly flat profile (noise, a chromatic cluster) can still
  // correlate well; how much the bins differ (coefficient of variation) says whether there is tonality at all
  const mean = profile.reduce((a, x) => a + x, 0) / 12;
  const cv = Math.sqrt(profile.reduce((a, x) => a + (x - mean) ** 2, 0) / 12) / mean;
  const confidence = gap * Math.min(1, cv / CONTRAST_FULL) * Math.max(0, best.r);
  const short = (k: KeyCandidate): KeyCandidate => ({ ...k, r: round(k.r) });
  return {
    ...short(best),
    confidence: round(confidence, 2),
    relative,
    alternatives: ranked.slice(1, 4).map(short),
    chroma: profile.map((x) => round(x / top)),
  };
}
