// Feature flags on the page: the browser half of libs/feature-flags. Pure functions over an injected
// storage and registry (the live store with the real localStorage is flag-store.ts), so they are tested
// without a DOM. Only the browser-safe entry of the lib is imported here, never its /server entry.
import {
  FLAG_REGISTRY,
  resolveFlag,
  sanitizeFlagOverrides,
  type FlagDefinition,
  type FlagOverrides,
  type FlagReason,
  type FlagResolveContext,
  type JsonValue,
} from '@reaper-mcp/feature-flags';
import { INSTALL_ID_KEY } from './storage-keys.js';

export const FLAG_OVERRIDES_KEY = 'mcp_bridge.flag_overrides';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The browser's stable targeting key: the analytics install id, created when it does not exist yet.
 * Undefined when storage is blocked, so an experiment then stays on its default instead of re-rolling the arm each load.
 */
export function readTargetingKey(storage: KeyValueStorage | undefined): string | undefined {
  if (!storage) return undefined;
  try {
    const existing = storage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const id = newId();
    storage.setItem(INSTALL_ID_KEY, id);
    return id;
  } catch {
    return undefined;
  }
}

/** The viewer's overrides: only entries that name a real flag and one of its variants survive. */
export function readOverrides(storage: KeyValueStorage | undefined, registry: readonly FlagDefinition[] = FLAG_REGISTRY): FlagOverrides {
  try {
    const raw = storage?.getItem(FLAG_OVERRIDES_KEY);
    return raw ? sanitizeFlagOverrides(JSON.parse(raw), registry) : {};
  } catch {
    return {};
  }
}

export function writeOverrides(storage: KeyValueStorage | undefined, overrides: FlagOverrides): void {
  try {
    storage?.setItem(FLAG_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // a per-browser convenience: blocked storage means the override lasts until reload
  }
}

/** One flag as the Developer section shows it: how it resolves now, and the variants it can be forced to. */
export interface FlagRow {
  key: string;
  description: string;
  variants: string[];
  variant: string;
  reason: FlagReason;
  /** The variant the viewer forced, when one is set */
  override?: string;
  /** The split an experiment uses, when it is running */
  split?: string;
}

export function flagRows(registry: readonly FlagDefinition[], context: { targetingKey?: FlagResolveContext['targetingKey']; overrides: FlagOverrides }): FlagRow[] {
  return registry.map((def) => {
    const resolved = resolveFlag(def, context);
    return {
      key: def.key,
      description: def.description,
      variants: Object.keys(def.variants),
      variant: resolved.variant,
      reason: resolved.reason,
      ...(context.overrides[def.key] !== undefined && { override: context.overrides[def.key] }),
      ...(def.experiment?.enabled && { split: def.experiment.variants.map((v) => `${v.key} ${v.weight}%`).join(' / ') }),
    };
  });
}

/** Resolve one definition to its value, variant and reason for this browser. */
export function evaluateFor(def: FlagDefinition, context: { targetingKey?: FlagResolveContext['targetingKey']; overrides: FlagOverrides }): { value: JsonValue; variant: string; reason: FlagReason } {
  return resolveFlag(def, context);
}
