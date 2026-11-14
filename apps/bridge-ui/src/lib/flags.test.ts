import { describe, expect, it } from 'vitest';
import { parseRegistry } from '@reaper-mcp/feature-flags';
import { FLAG_OVERRIDES_KEY, flagRows, readOverrides, readTargetingKey, type KeyValueStorage } from './flags.js';
import { createFlagStore } from './flag-store.js';
import { INSTALL_ID_KEY } from './storage-keys.js';

const registry = parseRegistry([
  {
    key: 'new-panel',
    description: 'fixture',
    type: 'boolean',
    variants: { off: false, on: true },
    defaultVariant: 'off',
    owner: 'tests',
    experiment: { enabled: true, variants: [{ key: 'off', weight: 50 }, { key: 'on', weight: 50 }] },
  },
  {
    key: 'static-panel',
    description: 'fixture',
    type: 'string',
    variants: { a: 'A', b: 'B' },
    defaultVariant: 'a',
    owner: 'tests',
  },
]);

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('readTargetingKey', () => {
  it('creates a stable id once and keeps returning it', () => {
    const storage = memoryStorage();
    const first = readTargetingKey(storage);
    expect(first).toBeTruthy();
    expect(storage.data[INSTALL_ID_KEY]).toBe(first);
    expect(readTargetingKey(storage)).toBe(first);
  });

  it('reuses the analytics install id so an exposure event joins the browser\'s other events', () => {
    expect(readTargetingKey(memoryStorage({ [INSTALL_ID_KEY]: 'abc' }))).toBe('abc');
  });

  it('has no id when storage is blocked, so an experiment stays on its default', () => {
    const blocked: KeyValueStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(readTargetingKey(blocked)).toBeUndefined();
    expect(readTargetingKey(undefined)).toBeUndefined();
  });
});

describe('readOverrides', () => {
  it('drops stale entries and survives corrupt storage', () => {
    expect(readOverrides(memoryStorage({ [FLAG_OVERRIDES_KEY]: '{"new-panel":"on","gone":"x","static-panel":"zzz"}' }), registry)).toEqual({ 'new-panel': 'on' });
    expect(readOverrides(memoryStorage({ [FLAG_OVERRIDES_KEY]: '{oops' }), registry)).toEqual({});
  });
});

describe('flagRows', () => {
  it('reports how each flag resolves, with the running split and any override', () => {
    const rows = flagRows(registry, { targetingKey: 'browser-1', overrides: { 'static-panel': 'b' } });
    expect(rows[0]).toMatchObject({ key: 'new-panel', reason: 'split', split: 'off 50% / on 50%', variants: ['off', 'on'] });
    expect(rows[1]).toMatchObject({ key: 'static-panel', variant: 'b', reason: 'override', override: 'b' });
  });
});

describe('flag store', () => {
  it('forces a variant, persists it, notifies subscribers and resets', () => {
    const storage = memoryStorage();
    const store = createFlagStore(storage, registry, () => undefined);
    let notified = 0;
    store.subscribe(() => notified++);
    const before = store.overrides();

    store.setOverride('static-panel', 'b');
    expect(store.overrides()).not.toBe(before);
    expect(store.rows().find((r) => r.key === 'static-panel')).toMatchObject({ variant: 'b', reason: 'override' });
    expect(JSON.parse(storage.data[FLAG_OVERRIDES_KEY])).toEqual({ 'static-panel': 'b' });

    store.setOverride('static-panel', null);
    expect(store.overrides()).toEqual({});
    store.setOverride('new-panel', 'on');
    store.resetAll();
    expect(store.overrides()).toEqual({});
    expect(notified).toBe(4);
  });

  it('keeps a browser on the same arm across page loads', () => {
    const storage = memoryStorage();
    const arm = () => createFlagStore(storage, registry, () => undefined).rows()[0].variant;
    expect(arm()).toBe(arm());
  });

  it('reports a flag\'s exposure once per page load', () => {
    const seen: string[] = [];
    const store = createFlagStore(memoryStorage(), registry, (flag, variant, reason) => seen.push(`${flag}:${variant}:${reason}`));
    store.exposed(registry[1], 'a', 'static');
    store.exposed(registry[1], 'a', 'static');
    expect(seen).toEqual(['static-panel:a:static']);
  });
});
