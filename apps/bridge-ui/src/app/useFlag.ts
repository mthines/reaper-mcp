import { useEffect, useSyncExternalStore } from 'react';
import { getFlagDefinition, resolveFlag, type FlagKey, type FlagValue } from '@reaper-mcp/feature-flags';
import { flagStore, type FlagStore } from '../lib/flag-store.js';

/**
 * The value of a feature flag for this browser: the viewer's override, else the experiment's split by the
 * browser's id, else the default. Reading it reports one `feature_flag_exposed` event per flag per page load,
 * which is what an experiment's arms are compared on. Declare flags in libs/feature-flags/src/registry.ts.
 *
 * Gate a UI-affecting experiment by rendering one whole component per arm, never inline branches.
 */
export function useFlag<K extends FlagKey>(key: K, store: FlagStore = flagStore): FlagValue<K> {
  const def = getFlagDefinition(key);
  if (!def) throw new Error(`unknown feature flag "${key}": run node scripts/gen-feature-flags.mjs`);
  const overrides = useSyncExternalStore(store.subscribe, store.overrides);
  const resolved = resolveFlag(def, { targetingKey: store.targetingKey(), overrides });
  useEffect(() => store.exposed(def, resolved.variant, resolved.reason), [store, def, resolved.variant, resolved.reason]);
  return resolved.value as FlagValue<K>;
}

/** The flags as the Developer section lists them, live with the overrides. */
export function useFlagRows(store: FlagStore = flagStore) {
  useSyncExternalStore(store.subscribe, store.overrides);
  return { rows: store.rows(), setOverride: store.setOverride, resetAll: store.resetAll, hasOverrides: Object.keys(store.overrides()).length > 0 };
}
