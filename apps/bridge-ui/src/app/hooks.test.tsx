// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeSettings, BridgeStatus, SettingKey } from '../lib/status.js';
import type { Sample } from '../lib/log.js';
import { HISTORY_MAX } from '../lib/log.js';
import { useHistory } from './useHistory.js';
import { useSettings } from './useSettings.js';

// React's act() needs this flag outside a test renderer
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS: BridgeSettings = { paused: false, readonly: false, openOnStart: true, dev: false };
const feed = (fields: Partial<BridgeStatus>) => ({ commands: 0, errors: 0, deferMs: 1, settings: SETTINGS, ...fields }) as BridgeStatus;

let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('useSettings', () => {
  let shown: BridgeSettings | null;
  let set: (key: SettingKey, on: boolean) => void;
  function Toggles({ status }: { status: BridgeStatus | null }) {
    const [s, setter] = useSettings(status);
    useLayoutEffect(() => {
      [shown, set] = [s, setter];
    });
    return null;
  }
  const render = (status: BridgeStatus | null) => act(() => root.render(<Toggles status={status} />));

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
  });

  it('shows a click at once and keeps it while the bridge still echoes the old value', () => {
    render(feed({}));
    act(() => set('cfg_readonly', true));
    expect(shown?.readonly).toBe(true);
    render(feed({ commands: 1 })); // a poll from before the write landed
    expect(shown?.readonly).toBe(true);
  });

  it('follows the bridge again once it confirmed the click', () => {
    render(feed({}));
    act(() => set('cfg_paused', true));
    render(feed({ settings: { ...SETTINGS, paused: true } }));
    expect(shown?.paused).toBe(true);
    // Later the setting changes elsewhere (another page): the bridge wins
    render(feed({ settings: { ...SETTINGS, paused: false } }));
    expect(shown?.paused).toBe(false);
  });

  it('snaps a toggle back when the write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(feed({}));
    await act(async () => set('cfg_open_on_start', false));
    expect(shown?.openOnStart).toBe(true);
  });

  it('shows nothing before the first status', () => {
    render(null);
    expect(shown).toBeNull();
  });
});

describe('useHistory', () => {
  let samples: Sample[];
  function Stats({ status, now }: { status: BridgeStatus | null; now: number }) {
    const s = useHistory(status, now);
    useLayoutEffect(() => {
      samples = s;
    });
    return null;
  }
  const render = (status: BridgeStatus | null, now: number) => act(() => root.render(<Stats status={status} now={now} />));

  it('takes one sample per tick, however often the page renders', () => {
    render(feed({ commands: 1 }), 1000);
    render(feed({ commands: 2 }), 1000);
    render(feed({ commands: 3 }), 2000);
    expect(samples.map((s) => [s.t, s.commands])).toEqual([
      [1000, 1],
      [2000, 3],
    ]);
  });

  it('starts a fresh history when the bridge restarts', () => {
    render(feed({ commands: 40 }), 1000);
    render(feed({ commands: 41 }), 2000);
    render(feed({ commands: 2 }), 3000);
    expect(samples.map((s) => s.commands)).toEqual([2]);
  });

  it(`keeps the last ${HISTORY_MAX} samples`, () => {
    for (let i = 1; i <= HISTORY_MAX + 5; i++) render(feed({ commands: i }), i * 1000);
    expect(samples).toHaveLength(HISTORY_MAX);
    expect(samples[0].commands).toBe(6);
  });

  it('samples nothing while the bridge is unreachable', () => {
    render(null, 1000);
    expect(samples).toEqual([]);
  });
});
