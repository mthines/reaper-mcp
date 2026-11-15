// GENERATED — do not edit.
// Source: libs/feature-flags/src/registry.ts
// Regenerate: node scripts/gen-feature-flags.mjs
//
// Edit the registry, not this file. `--check` fails CI when the two disagree.

/** Every declared flag key. */
export type FlagKey = never;

/** Flag key -> its evaluated value type. */
export type FlagValueMap = Record<never, never>;

/** The value type `evaluateFlag(key, …)` resolves to for a given key. */
export type FlagValue<K extends FlagKey> = FlagValueMap[K];

/** Every declared flag key, in registry order, for runtime iteration. */
export const FLAG_KEYS: readonly FlagKey[] = [];
