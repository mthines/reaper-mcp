/**
 * Overrides: how the owner forces a variant for their own install or browser without touching the
 * registry. Transport-agnostic and browser-safe: it defines the map shape (flag key -> variant key)
 * and parses one out of an untrusted string (a file, an env var, localStorage).
 *
 * An override always wins over the experiment split and the static default, and is reported with
 * reason `override`.
 */
import { FLAG_REGISTRY } from './registry.js';
import type { FlagDefinition } from './schema.js';

/** Flag key -> the variant key to force. */
export type FlagOverrides = Record<string, string>;

/** The `EvaluationContext` field the provider reads overrides from. */
export const FLAG_OVERRIDES_CONTEXT_KEY = 'flagOverrides' as const;

/**
 * Parse a raw override string into a validated map. Never trusts the input: malformed JSON, an unknown
 * flag, or a variant that does not exist (a stale file after a flag was removed or renamed) is silently
 * dropped, so one bad entry never breaks evaluation of the others.
 */
export function parseFlagOverrides(
  raw: string | undefined | null,
  registry: readonly FlagDefinition[] = FLAG_REGISTRY,
): FlagOverrides {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  return sanitizeFlagOverrides(parsed, registry);
}

/** Keep only the entries of an already-parsed value that name a real flag and one of its variants. */
export function sanitizeFlagOverrides(
  parsed: unknown,
  registry: readonly FlagDefinition[] = FLAG_REGISTRY,
): FlagOverrides {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const valid: FlagOverrides = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const def = registry.find((f) => f.key === key);
    if (!def || !Object.hasOwn(def.variants, value)) continue;
    valid[key] = value;
  }
  return valid;
}

/** Serialize an override map for storage. Inverse of `parseFlagOverrides`. */
export function serializeFlagOverrides(overrides: FlagOverrides): string {
  return JSON.stringify(overrides);
}
