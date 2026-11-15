// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRegistry } from '@reaper-mcp/feature-flags';
import { createFlagStore } from '../lib/flag-store.js';
import { useSharedFlags } from './useSharedFlags.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = parseRegistry([
  { key: 'new-panel', description: 'fixture', type: 'boolean', variants: { off: false, on: true }, defaultVariant: 'off', owner: 'tests' },
]);
const memory = () => {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};

/** A bridge: its file, the requests it was sent, and the id it last handled */
function fakeBridge(file: Record<string, string>, writable = true) {
  const state = { file, req: null as string | null, requests: [] as string[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/SET/EXTSTATE/MCPBridge/flags_req/')) {
        state.requests.push(url);
        return { text: async () => '' };
      }
      const v = { v: 1, overrides: state.file, req: state.req, writable };
      return { text: async () => `EXTSTATE\tMCPBridge\tflag_overrides\t${JSON.stringify(v)}\n` };
    }),
  );
  return state;
}

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(store: ReturnType<typeof createFlagStore>, enabled = true) {
  const seen = { shared: false };
  const Probe = () => {
    const shared = useSharedFlags(enabled, 'tok', store);
    useLayoutEffect(() => {
      seen.shared = shared;
    });
    return null;
  };
  act(() => root.render(<Probe />));
  return () => seen.shared;
}
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

describe('feature flags shared with the bridge', () => {
  it('follows the overrides in the bridge’s file, and again when the CLI changes them', async () => {
    const bridge = fakeBridge({ 'new-panel': 'on' });
    const store = createFlagStore(memory(), registry, () => undefined);
    const shared = mount(store);
    await settle();
    expect(shared()).toBe(true);
    expect(store.overrides()).toEqual({ 'new-panel': 'on' });
    bridge.file = {};
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(store.overrides()).toEqual({});
  });

  it('sends a variant forced in the page to the bridge', async () => {
    const bridge = fakeBridge({});
    const store = createFlagStore(memory(), registry, () => undefined);
    mount(store);
    await settle();
    act(() => store.setOverride('new-panel', 'on'));
    expect(bridge.requests).toHaveLength(1);
    expect(decodeURIComponent(bridge.requests[0])).toContain(`-tok-${Buffer.from('{"new-panel":"on"}').toString('hex')}`);
  });

  it('does not let the old file undo a change the bridge has not handled yet', async () => {
    const bridge = fakeBridge({});
    const store = createFlagStore(memory(), registry, () => undefined);
    mount(store);
    await settle();
    act(() => store.setOverride('new-panel', 'on'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(store.overrides()).toEqual({ 'new-panel': 'on' });
    // once the bridge answers with that request, the file is the truth again
    bridge.file = { 'new-panel': 'on' };
    bridge.req = new URL(bridge.requests[0], 'http://x').pathname.split('/').pop()!.split('-')[0];
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(store.overrides()).toEqual({ 'new-panel': 'on' });
  });

  it('goes back to the file when the bridge never handled the change', async () => {
    fakeBridge({});
    const store = createFlagStore(memory(), registry, () => undefined);
    mount(store);
    await settle();
    act(() => store.setOverride('new-panel', 'on'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(9000)));
    expect(store.overrides()).toEqual({});
  });

  it('keeps the overrides in this browser when the bridge has no folder to keep them in', async () => {
    const bridge = fakeBridge({}, false);
    const store = createFlagStore(memory(), registry, () => undefined);
    const shared = mount(store);
    await settle();
    act(() => store.setOverride('new-panel', 'on'));
    expect(shared()).toBe(false);
    expect(bridge.requests).toEqual([]);
    expect(store.overrides()).toEqual({ 'new-panel': 'on' });
  });

  it('does nothing without a bridge', async () => {
    const bridge = fakeBridge({ 'new-panel': 'on' });
    const store = createFlagStore(memory(), registry, () => undefined);
    const shared = mount(store, false);
    await settle();
    expect(shared()).toBe(false);
    expect(store.overrides()).toEqual({});
    expect(bridge.requests).toEqual([]);
  });
});
