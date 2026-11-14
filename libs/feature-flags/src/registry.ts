/**
 * The flag registry: the single, hand-authored source of truth.
 *
 * Add or change a flag HERE, then regenerate the derived artifacts:
 *
 *   node scripts/gen-feature-flags.mjs        (or: pnpm nx run feature-flags:generate)
 *
 * `--check` (and `generated-artifacts.test.ts`) fails when the generated files drift from this one.
 *
 * Every entry must gate something real. Do NOT add a placeholder flag so a code path "has an example":
 * a registry entry is a live product decision, and one that gates nothing is indistinguishable from one
 * left behind after a rollout finished. The machinery is covered by tests that declare their own
 * `FlagDefinition` fixtures. Authoring, ramping and removing: docs/FEATURE-FLAGS.md.
 *
 * Validated at import time: an invalid entry throws instead of shipping a flag that resolves to undefined.
 */
import { parseRegistry, type FlagDefinition } from './schema.js';

const REGISTRY_INPUT = [] satisfies unknown[];

/** The validated, canonical set of flags. Import this, never `REGISTRY_INPUT`. */
export const FLAG_REGISTRY: readonly FlagDefinition[] = parseRegistry(REGISTRY_INPUT);

export function getFlagDefinition(key: string): FlagDefinition | undefined {
  return FLAG_REGISTRY.find((f) => f.key === key);
}
