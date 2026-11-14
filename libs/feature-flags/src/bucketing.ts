/**
 * Deterministic, stateless variant assignment for A/B(/n) experiments and percentage rollouts.
 *
 * The same `(flagKey, targetingKey)` pair always lands in the same bucket, across every process and
 * every release, with no shared storage: hashing `"<flagKey>:<targetingKey>"` (FNV-1a, 32 bit) into
 * `[0, 100)` and walking the variants' cumulative weight. Byte-identical to LoreKit's implementation,
 * so an arm assignment can be reasoned about the same way in both products.
 */
import type { Experiment } from './schema.js';

/** FNV-1a, 32-bit. Not cryptographic: fast, well-distributed, good enough for bucketing. */
export function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Maps a hash into `[0, 100)`, the same domain as `ExperimentVariant.weight`. */
export function bucketOf(flagKey: string, targetingKey: string): number {
  return fnv1aHash(`${flagKey}:${targetingKey}`) % 100;
}

/** The first variant, in declared order, whose cumulative weight range contains the bucket. */
export function assignExperimentVariant(flagKey: string, experiment: Experiment, targetingKey: string): string {
  const bucket = bucketOf(flagKey, targetingKey);
  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant.key;
  }
  return experiment.variants[experiment.variants.length - 1].key;
}
