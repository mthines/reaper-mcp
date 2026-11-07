/**
 * Pairing for align_audio_to_guide: which hit of a double belongs to which hit of the
 * guide. Pure functions (no bridge, no sidecar), so the matching is tested on its own.
 */

export interface Hit {
  /** Seconds. Project time for the guide's hits, source-file time for a double's. */
  time: number;
  strength?: number;
  /** Dominant band the sidecar found for the hit */
  band?: string;
}

/** A hit of the double and the project time it should land on (the bridge's `pairs`). */
export interface AlignPair {
  /** Seconds in the double's source file */
  src: number;
  /** Project time to land on */
  to: number;
  /** A consonant's rigid tail: moves with its hit, not counted in the offsets */
  extra?: boolean;
}

/** Most hits per list the pairing handles: the stretch-marker limit per item. */
export const MAX_HITS = 2000;

/**
 * Pairs two ascending lists of times so that pairs keep their order, no pair is further
 * apart than `maxShift`, and the total distance plus the hits left alone is smallest
 * (a hit left alone costs `maxShift`, so a feasible pair always wins over leaving both).
 * Returns [guideIndex, doubleIndex] in time order.
 */
export function pairHits(guide: number[], double: number[], maxShift: number): Array<[number, number]> {
  const n = guide.length;
  const m = double.length;
  if (n === 0 || m === 0) return [];
  const w = m + 1;
  const cost = new Float64Array((n + 1) * w);
  // 0 = leave the guide hit, 1 = leave the double hit, 2 = pair them
  const step = new Uint8Array((n + 1) * w);
  for (let i = 1; i <= n; i++) { cost[i * w] = i * maxShift; step[i * w] = 0; }
  for (let j = 1; j <= m; j++) { cost[j] = j * maxShift; step[j] = 1; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = cost[(i - 1) * w + j] + maxShift;
      let how = 0;
      const skipDouble = cost[i * w + j - 1] + maxShift;
      if (skipDouble < best) { best = skipDouble; how = 1; }
      const d = Math.abs(guide[i - 1] - double[j - 1]);
      if (d <= maxShift) {
        const paired = cost[(i - 1) * w + j - 1] + d;
        if (paired <= best) { best = paired; how = 2; }
      }
      cost[i * w + j] = best;
      step[i * w + j] = how;
    }
  }
  const out: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const how = step[i * w + j];
    if (how === 2) { out.push([i - 1, j - 1]); i--; j--; }
    else if (how === 0) i--;
    else j--;
  }
  return out.reverse();
}

export interface DoubleGeometry {
  /** Project time of the item's start */
  position: number;
  /** Item length in seconds */
  length: number;
  /** Take start offset (seconds into the source) */
  startOffset: number;
  playRate: number;
}

export interface BuildOptions {
  maxShiftMs: number;
  /** Move high-band hits (sibilants, t/k) as a block, so the stretch lands after them */
  protectConsonants: boolean;
  consonantMs: number;
}

/** Project time of a time in the double's source file (before any stretch markers). */
export const projectTime = (g: DoubleGeometry, src: number) => g.position + (src - g.startOffset) / g.playRate;

/**
 * The pairs to send for one double: its hits (source time) matched to the guide's (project
 * time), plus a rigid tail after each high-band hit when protecting consonants. Only hits
 * inside both items count. Returns the pairs and how many hits were left unmatched.
 */
export function buildPairs(
  guideHits: Hit[],
  doubleHits: Hit[],
  g: DoubleGeometry,
  opts: BuildOptions,
): { pairs: AlignPair[]; matched: number; unmatchedGuide: number; unmatchedDouble: number } {
  const maxShift = opts.maxShiftMs / 1000;
  const end = g.position + g.length;
  const inside = <T extends Hit>(hits: T[], at: (h: T) => number) =>
    hits.filter((h) => at(h) > g.position && at(h) < end).sort((a, b) => at(a) - at(b));
  const guide = inside(guideHits, (h) => h.time);
  const double = inside(doubleHits, (h) => projectTime(g, h.time));
  const matches = pairHits(guide.map((h) => h.time), double.map((h) => projectTime(g, h.time)), maxShift);

  const pairs: AlignPair[] = [];
  const tail = opts.consonantMs / 1000;
  matches.forEach(([gi, di], k) => {
    const hit = double[di];
    pairs.push({ src: hit.time, to: guide[gi].time });
    if (!opts.protectConsonants || hit.band !== 'high') return;
    // The tail needs room before the next matched hit and inside the item
    const tailSrc = hit.time + tail * g.playRate;
    const next = matches[k + 1] ? double[matches[k + 1][1]].time : Infinity;
    if (projectTime(g, tailSrc) < end - 0.01 && tailSrc < next - 0.02) {
      pairs.push({ src: tailSrc, to: guide[gi].time + tail, extra: true });
    }
  });
  return {
    pairs,
    matched: matches.length,
    unmatchedGuide: guide.length - matches.length,
    unmatchedDouble: double.length - matches.length,
  };
}
