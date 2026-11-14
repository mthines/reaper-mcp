import { describe, expect, it } from 'vitest';
import { assignExperimentVariant, bucketOf, fnv1aHash } from './bucketing.js';
import type { Experiment } from './schema.js';

describe('fnv1aHash', () => {
  // Vectors shared with LoreKit's implementation: an arm assignment must be identical in both products
  it.each([
    ['', 2166136261],
    ['a', 3826002220],
    ['insights-visual:user-123', 2573777393],
    ['example-flag:00000000-0000-0000-0000-000000000000', 4034025352],
    ['x:ü', 1275141281],
  ])('hashes %j to %i', (input, expected) => {
    expect(fnv1aHash(input)).toBe(expected);
  });
});

describe('bucketOf', () => {
  it('is stable and inside [0, 100)', () => {
    for (let i = 0; i < 500; i++) {
      const bucket = bucketOf('flag', `install-${i}`);
      expect(bucket).toBe(bucketOf('flag', `install-${i}`));
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('buckets the same install differently per flag, so arms of two experiments are independent', () => {
    const differing = Array.from({ length: 200 }, (_, i) => i).filter(
      (i) => bucketOf('flag-a', `install-${i}`) !== bucketOf('flag-b', `install-${i}`),
    );
    expect(differing.length).toBeGreaterThan(100);
  });
});

describe('assignExperimentVariant', () => {
  const experiment = (weights: number[]): Experiment => ({
    enabled: true,
    variants: weights.map((weight, i) => ({ key: `arm-${i}`, weight })),
  });

  it('splits roughly by weight over many installs', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) {
      const arm = assignExperimentVariant('split', experiment([10, 90]), `install-${i}`);
      counts[arm] = (counts[arm] ?? 0) + 1;
    }
    expect(counts['arm-0']).toBeGreaterThan(800);
    expect(counts['arm-0']).toBeLessThan(1200);
  });

  it('puts everyone on the arm holding all the weight', () => {
    for (let i = 0; i < 200; i++) {
      expect(assignExperimentVariant('all', experiment([0, 100]), `install-${i}`)).toBe('arm-1');
    }
  });

  it('never moves an install between arms when the same weights are re-evaluated', () => {
    const first = assignExperimentVariant('stable', experiment([50, 50]), 'install-7');
    expect(assignExperimentVariant('stable', experiment([50, 50]), 'install-7')).toBe(first);
  });
});
