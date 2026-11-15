// The live flag state of this browser: the viewer's overrides in localStorage, shared by every
// component through useSyncExternalStore (see app/useFlag.ts), so forcing a variant in Settings changes
// the flag everywhere at once.
import { FLAG_REGISTRY, type FlagDefinition, type FlagOverrides } from '@reaper-mcp/feature-flags';
import { track } from './analytics.js';
import { flagRows, readOverrides, readTargetingKey, writeOverrides, type FlagRow, type KeyValueStorage } from './flags.js';

function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

export interface FlagStore {
  /** A new object on every change, so useSyncExternalStore can compare by reference */
  overrides(): FlagOverrides;
  targetingKey(): string | undefined;
  /** Force a variant, or null to drop the override */
  setOverride(key: string, variant: string | null): void;
  resetAll(): void;
  /** The flags with how they resolve under `overrides` (pass the useSyncExternalStore snapshot) */
  rows(overrides: FlagOverrides): FlagRow[];
  subscribe(listener: () => void): () => void;
  /** Report that a flag was read, once per flag per store */
  exposed(def: FlagDefinition, variant: string, reason: FlagRow['reason']): void;
}

export function createFlagStore(
  storage: KeyValueStorage | undefined = browserStorage(),
  registry: readonly FlagDefinition[] = FLAG_REGISTRY,
  onExposed: (flag: string, variant: string, reason: FlagRow['reason']) => void = (flag, variant, reason) =>
    track({ name: 'feature_flag_exposed', flag, variant, reason }),
): FlagStore {
  let overrides = readOverrides(storage, registry);
  let key: string | undefined;
  let keyRead = false;
  const listeners = new Set<() => void>();
  const reported = new Set<string>();
  const commit = (next: FlagOverrides) => {
    overrides = next;
    writeOverrides(storage, next);
    listeners.forEach((l) => l());
  };
  const targetingKey = () => {
    if (!keyRead) {
      key = readTargetingKey(storage);
      keyRead = true;
    }
    return key;
  };

  return {
    overrides: () => overrides,
    targetingKey,
    setOverride(flag, variant) {
      const next = { ...overrides };
      if (variant === null) delete next[flag];
      else next[flag] = variant;
      commit(next);
    },
    resetAll: () => commit({}),
    rows: (current) => flagRows(registry, { targetingKey, overrides: current }),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    exposed(def, variant, reason) {
      if (reported.has(def.key)) return;
      reported.add(def.key);
      onExposed(def.key, variant, reason);
    },
  };
}

/** The page's one store */
export const flagStore = createFlagStore();
