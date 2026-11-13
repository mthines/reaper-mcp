// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeSettings, BridgeStatus, SettingKey } from '../lib/status.js';
import type { Sample } from '../lib/log.js';
import { HISTORY_MAX } from '../lib/log.js';
import { useHistory } from './useHistory.js';
import { useSettings } from './useSettings.js';
import { CLOSE_AFTER_MS, useCloseWithReaper } from './useCloseWithReaper.js';

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

describe('useCloseWithReaper', () => {
  function Probe({ reachable, enabled = true }: { reachable: boolean; enabled?: boolean }) {
    const { secondsLeft, cancel } = useCloseWithReaper(reachable, enabled);
    return (
      <>
        <span data-testid="left">{secondsLeft ?? 'none'}</span>
        <button onClick={cancel}>Keep open</button>
      </>
    );
  }
  const render = (reachable: boolean, enabled = true) => act(() => root.render(<Probe reachable={reachable} enabled={enabled} />));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const left = () => document.querySelector('[data-testid=left]')?.textContent;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    close = vi.fn();
    vi.stubGlobal('close', close);
  });
  afterEach(() => vi.useRealTimers());

  it('counts down and closes the window once REAPER has stayed unreachable', () => {
    render(false);
    wait(500);
    expect(left()).toBe('5');
    wait(2000);
    expect(left()).toBe('3');
    wait(CLOSE_AFTER_MS);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open when REAPER comes back before the countdown ends', () => {
    render(false);
    wait(CLOSE_AFTER_MS - 1000);
    render(true);
    wait(CLOSE_AFTER_MS);
    expect(close).not.toHaveBeenCalled();
    expect(left()).toBe('none');
  });

  it('stays open after pressing Keep open', () => {
    render(false);
    wait(1000);
    act(() => document.querySelector('button')?.click());
    wait(CLOSE_AFTER_MS * 2);
    expect(close).not.toHaveBeenCalled();
    expect(left()).toBe('none');
  });

  it('stays open after pressing Enter', () => {
    render(false);
    wait(1000);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
    wait(CLOSE_AFTER_MS * 2);
    expect(close).not.toHaveBeenCalled();
  });

  it('counts down again the next time REAPER quits after a cancel', () => {
    render(false);
    act(() => document.querySelector('button')?.click());
    render(true);
    render(false);
    wait(CLOSE_AFTER_MS + 500);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open outside the bridge window (a tab, the installed app, demo)', () => {
    render(false, false);
    wait(CLOSE_AFTER_MS * 2);
    expect(close).not.toHaveBeenCalled();
    expect(left()).toBe('none');
  });
});
