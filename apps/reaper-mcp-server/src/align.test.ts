/** How hits of a double are matched to a guide's: what ends up paired, and what stays put. */
import { describe, it, expect } from 'vitest';
import { buildPairs, pairHits, type DoubleGeometry } from './align.js';

const GEO: DoubleGeometry = { position: 10, length: 8, startOffset: 0, playRate: 1 };
const OPTS = { maxShiftMs: 120, protectConsonants: false, consonantMs: 80 };

describe('pairing hits', () => {
  it('pairs hits in order and leaves out a hit with no partner within the shift', () => {
    // double has an extra hit (a breath) at 1.5 that the guide does not have
    const pairs = pairHits([1.0, 2.0, 3.0], [1.05, 1.5, 2.02, 2.95], 0.12);
    expect(pairs).toEqual([[0, 0], [1, 2], [2, 3]]);
  });

  it('does not pair hits further apart than the maximum shift', () => {
    expect(pairHits([1.0], [1.3], 0.12)).toEqual([]);
    expect(pairHits([1.0], [1.1], 0.12)).toEqual([[0, 0]]);
  });

  it('picks the closer guide hit when two compete for one hit', () => {
    expect(pairHits([1.0, 1.1], [1.09], 0.12)).toEqual([[1, 0]]);
  });

  it('never crosses pairs: matches stay in time order', () => {
    const pairs = pairHits([1.0, 1.2], [1.15, 1.25], 0.2);
    const di = pairs.map((p) => p[1]);
    expect([...di].sort((a, b) => a - b)).toEqual(di);
  });

  it('copes with empty lists', () => {
    expect(pairHits([], [1], 0.1)).toEqual([]);
    expect(pairHits([1], [], 0.1)).toEqual([]);
  });
});

describe('building pairs for a double', () => {
  it('maps source times of the double to the project times of the guide, in project time', () => {
    // double item at 10 s starting 2 s into its source: source 3.0 plays at project 11.0
    const g = { ...GEO, startOffset: 2 };
    const { pairs, matched } = buildPairs([{ time: 11.04 }], [{ time: 3.0 }], g, OPTS);
    expect(matched).toBe(1);
    expect(pairs).toEqual([{ src: 3.0, to: 11.04 }]);
  });

  it('ignores hits outside the double item and reports the unmatched ones', () => {
    const r = buildPairs(
      [{ time: 5 }, { time: 11 }, { time: 12 }],
      [{ time: 1.02 }, { time: 7 }],
      GEO, OPTS,
    );
    expect(r.pairs).toEqual([{ src: 1.02, to: 11 }]);
    expect(r.unmatchedGuide).toBe(1); // the hit at 12 s
    expect(r.unmatchedDouble).toBe(1); // source 7 s = project 17 s, no guide hit near
  });

  it('offset after is smaller than before: every pair lands on the guide', () => {
    const guide = [11.0, 12.0, 13.5].map((time) => ({ time }));
    const double = [1.07, 2.1, 3.42].map((time) => ({ time })); // project 11.07, 12.1, 13.42
    const { pairs } = buildPairs(guide, double, GEO, OPTS);
    const before = pairs.map((p) => Math.abs(p.src + GEO.position - p.to));
    expect(before.every((b) => b > 0.05)).toBe(true);
    expect(pairs.map((p) => p.to)).toEqual([11.0, 12.0, 13.5]);
  });

  it('adds a rigid tail after a high-band hit when protecting consonants, and not after others', () => {
    const guide = [11.0, 12.0].map((time) => ({ time }));
    const double = [{ time: 1.05, band: 'high' }, { time: 2.05, band: 'mid' }];
    const r = buildPairs(guide, double, GEO, { ...OPTS, protectConsonants: true });
    expect(r.pairs).toHaveLength(3);
    const tail = r.pairs.find((p) => p.extra);
    expect(tail).toEqual({ src: 1.05 + 0.08, to: 11.0 + 0.08, extra: true });
    expect(r.matched).toBe(2);
  });

  it('skips the consonant tail when it would run into the next hit or off the item', () => {
    const guide = [11.0, 11.05].map((time) => ({ time }));
    const crowded = buildPairs(guide, [{ time: 1.0, band: 'high' }, { time: 1.05 }], GEO, { ...OPTS, protectConsonants: true });
    expect(crowded.pairs.some((p) => p.extra)).toBe(false);
    const atEnd = buildPairs([{ time: 17.95 }], [{ time: 7.95, band: 'high' }], GEO, { ...OPTS, protectConsonants: true });
    expect(atEnd.pairs.some((p) => p.extra)).toBe(false);
  });

  it('turns protection off with protectConsonants false', () => {
    const r = buildPairs([{ time: 11 }], [{ time: 1.02, band: 'high' }], GEO, OPTS);
    expect(r.pairs.some((p) => p.extra)).toBe(false);
  });
});

describe('consonant tails near the next hit', () => {
  it('gives no tail when the next guide hit is closer than the tail, so the next hit is never pushed out', () => {
    // double hits 1.0 (high) and 1.2 are 200 ms apart, but the guide's targets 11.1 and 11.15 are 50 ms apart
    const r = buildPairs(
      [11.1, 11.15].map((time) => ({ time })),
      [{ time: 1.0, band: 'high' }, { time: 1.2 }],
      GEO, { ...OPTS, maxShiftMs: 120, protectConsonants: true },
    );
    expect(r.matched).toBe(2);
    expect(r.pairs.some((p) => p.extra)).toBe(false);
    expect(r.pairs.map((p) => p.to)).toEqual([11.1, 11.15]);
  });

  it('never returns more pairs than the stretch-marker limit, keeping every matched hit before any tail', () => {
    const n = 2000;
    const guide = Array.from({ length: n }, (_, i) => ({ time: 10.1 + i * 0.1 }));
    const double = Array.from({ length: n }, (_, i) => ({ time: 0.1 + i * 0.1 + 0.01, band: 'high' }));
    const r = buildPairs(guide, double, { ...GEO, length: 300 }, { ...OPTS, protectConsonants: true });
    expect(r.matched).toBe(n);
    expect(r.pairs.length).toBeLessThanOrEqual(2000);
    expect(r.pairs.filter((p) => !p.extra)).toHaveLength(n);
  });
});
