/**
 * The pure flag resolver, shared by the OpenFeature provider (server) and the bridge page (browser).
 * No Node API and no OpenFeature import, so it runs anywhere.
 *
 * Order: a valid override (variant key) -> an enabled experiment's split -> `defaultVariant`.
 */
import { assignExperimentVariant } from './bucketing.js';
import type { FlagOverrides } from './overrides.js';
import type { FlagDefinition, JsonValue } from './schema.js';

export type FlagReason = 'override' | 'split' | 'static';

export interface FlagResolution {
  variant: string;
  value: JsonValue;
  reason: FlagReason;
}

export interface FlagResolveContext {
  /**
   * A stable per-install (server) or per-browser (page) id. An active experiment evaluated without one
   * resolves to the default variant: bucketing on a constant would put everyone on the same arm, which
   * is not a split. Pass a function to read it only when an enabled experiment needs it, so a registry
   * without a live experiment never creates an id.
   */
  targetingKey?: string | (() => string | undefined);
  overrides?: FlagOverrides;
}

export function resolveFlag(def: FlagDefinition, context: FlagResolveContext = {}): FlagResolution {
  const forced = context.overrides?.[def.key];
  if (forced !== undefined && Object.hasOwn(def.variants, forced)) {
    return { variant: forced, value: def.variants[forced], reason: 'override' };
  }
  if (def.experiment?.enabled) {
    const key = typeof context.targetingKey === 'function' ? context.targetingKey() : context.targetingKey;
    if (key) {
      const variant = assignExperimentVariant(def.key, def.experiment, key);
      return { variant, value: def.variants[variant], reason: 'split' };
    }
  }
  return { variant: def.defaultVariant, value: def.variants[def.defaultVariant], reason: 'static' };
}
