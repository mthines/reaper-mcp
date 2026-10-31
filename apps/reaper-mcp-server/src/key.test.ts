import { describe, it, expect } from 'vitest';
import { estimateKey } from './key.js';

// Pitch-class weights (C first) of a scale with stronger tonic/fifth/third
const profileOf = (tonic: number, degrees: number[], weights = [5, 2, 3, 2, 4, 2, 2]) => {
  const p = new Array(12).fill(0.1);
  degrees.forEach((d, i) => { p[(tonic + d) % 12] = weights[i]; });
  return p;
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

describe('estimateKey', () => {
  it('finds C major from a C major scale weighted toward the tonic triad', () => {
    const k = estimateKey(profileOf(0, MAJOR, [5, 2, 4, 3, 4.5, 2.5, 1.5]));
    expect(k?.key).toBe('C major');
    expect(k?.relative).toBe('A minor');
    expect(k?.chroma[0]).toBe(1);
    expect(k?.alternatives).toHaveLength(3);
  });

  it('finds A minor when the minor tonic and fifth dominate, and works for every tonic', () => {
    expect(estimateKey(profileOf(9, MINOR, [5, 2, 4, 3, 4.5, 2.5, 1.5]))?.key).toBe('A minor');
    expect(estimateKey(profileOf(7, MAJOR, [5, 2, 4, 3, 4.5, 2.5, 1.5]))?.key).toBe('G major');
    expect(estimateKey(profileOf(3, MINOR, [5, 2, 4, 3, 4.5, 2.5, 1.5]))?.key).toBe('Eb minor');
  });

  it('is confident about a clear scale and not about a chromatic cluster', () => {
    const clear = estimateKey(profileOf(2, MAJOR, [5, 2, 4, 3, 4.5, 2.5, 1.5]))!;
    const vague = estimateKey([1, 0.95, 1, 0.9, 1, 0.97, 0.93, 1, 0.92, 1, 0.96, 0.94])!;
    expect(clear.confidence).toBeGreaterThan(vague.confidence);
    expect(clear.confidence).toBeGreaterThan(0.25);
    expect(vague.confidence).toBeLessThan(0.25);
  });

  it('gives no key for silence or a flat profile', () => {
    expect(estimateKey(new Array(12).fill(0))).toBeNull();
    expect(estimateKey(new Array(12).fill(1))).toBeNull();
    expect(estimateKey([1, 2, 3])).toBeNull();
  });
});
