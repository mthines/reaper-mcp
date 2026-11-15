// The live flag state of this browser: the viewer's overrides in localStorage, shared by every
// component through useSyncExternalStore (see app/useFlag.ts), so forcing a variant in the Developer drawer
// changes the flag everywhere on the page at once. With a bridge connected the overrides are also the bridge's
// flags.json (app/useSharedFlags.ts), so they apply to the MCP server too; localStorage is then the offline copy.
import { FLAG_REGISTRY, sanitizeFlagOverrides, type FlagDefinition, type FlagOverrides } from '@reaper-mcp/feature-flags';
import { track } from './analytics.js';
import { flagRows, readOverrides, readTargetingKey, writeOverrides, type FlagRow, type KeyValueStorage } from './flags.js';

function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

function sameOverrides(a: FlagOverrides, b: FlagOverrides): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
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
  /** Take the overrides from the bridge's flags.json: they win over this browser's; nothing is sent back */
  adopt(next: FlagOverrides): void;
  /** Where a change the viewer makes is sent too (the bridge), or null for this browser only */
  setSink(sink: ((overrides: FlagOverrides) => void) | null): void;
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
  let sink: ((overrides: FlagOverrides) => void) | null = null;
  const apply = (next: FlagOverrides) => {
    overrides = next;
    writeOverrides(storage, next);
    listeners.forEach((l) => l());
  };
  const commit = (next: FlagOverrides) => {
    apply(next);
    sink?.(next);
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
    adopt(next) {
      // A flag or variant this build doesn't have (the file is shared with other versions) is dropped here too
      const valid = sanitizeFlagOverrides(next, registry);
      if (sameOverrides(overrides, valid)) return;
      apply(valid);
    },
    setSink(next) {
      sink = next;
    },
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
