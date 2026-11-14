// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../lib/analytics.js', () => analytics);

import { readTimeBucket, readTimer, useChangelogReadTime, type ChangelogCloseVia } from './useChangelogReadTime.js';

// React's act() needs this flag outside a test renderer
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('readTimer', () => {
  it('counts only the time the page is visible', () => {
    let t = 0;
    const timer = readTimer(() => t, true);
    t = 4000;
    timer.pause();
    t = 60_000; // in a background tab
    timer.resume();
    t = 61_500;
    expect(timer.elapsedMs()).toBe(5500);
  });

  it('starts paused for a page opened in the background, and ignores a repeated pause or resume', () => {
    let t = 0;
    const timer = readTimer(() => t, false);
    t = 10_000;
    timer.pause();
    timer.resume();
    t = 12_000;
    timer.resume();
    t = 13_000;
    expect(timer.elapsedMs()).toBe(3000);
  });
});

describe('readTimeBucket', () => {
  it('puts each read in the range that starts at or below it', () => {
    const cases: Array<[number, string]> = [
      [0, '<5s'], [4, '<5s'], [5, '5-15s'], [14, '5-15s'], [15, '15-30s'], [29, '15-30s'],
      [30, '30-60s'], [59, '30-60s'], [60, '1-3m'], [179, '1-3m'], [180, '3m+'], [3600, '3m+'],
    ];
    for (const [seconds, bucket] of cases) expect(readTimeBucket(seconds), `${seconds} s`).toBe(bucket);
  });
});

describe('useChangelogReadTime', () => {
  let root: Root;
  let now = 0;
  let closedVia: (via: ChangelogCloseVia) => void;
  let hidden = false;

  function Drawer({ open }: { open: boolean }) {
    const setVia = useChangelogReadTime(open);
    useLayoutEffect(() => {
      closedVia = setVia;
    });
    return null;
  }
  const render = (open: boolean) => act(() => root.render(<Drawer open={open} />));
  const setHidden = (h: boolean) => {
    hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    analytics.track.mockClear();
    now = 0;
    hidden = false;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'));
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it('sends nothing while the drawer stays closed', () => {
    render(false);
    render(false);
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('sends how long it was open and how it was closed, once', () => {
    render(true);
    now = 12_400;
    closedVia('close');
    render(false);
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith({ name: 'changelog_closed', via: 'close', seconds: 12, read_time: '5-15s' });
  });

  it('leaves out the time the page was hidden', () => {
    render(true);
    now = 5000;
    setHidden(true);
    now = 300_000;
    setHidden(false);
    now = 308_000;
    closedVia('settings');
    render(false);
    expect(analytics.track).toHaveBeenCalledWith({ name: 'changelog_closed', via: 'settings', seconds: 13, read_time: '5-15s' });
  });

  it('calls a close nobody named `other` (back/forward), and each opening starts again', () => {
    render(true);
    now = 3000;
    closedVia('close');
    render(false);
    now = 10_000;
    render(true);
    now = 17_000;
    render(false);
    expect(analytics.track).toHaveBeenLastCalledWith({ name: 'changelog_closed', via: 'other', seconds: 7, read_time: '5-15s' });
  });

  it('sends page_left when the page goes away with the drawer open, and not again on unmount', () => {
    render(true);
    now = 21_000;
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    render(false);
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith({ name: 'changelog_closed', via: 'page_left', seconds: 21, read_time: '15-30s' });
  });

  it('starts a new read after a bfcache restore with the drawer open', () => {
    render(true);
    now = 4000;
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    now = 10_000;
    closedVia('close');
    render(false);
    expect(analytics.track).toHaveBeenCalledTimes(2);
    expect(analytics.track).toHaveBeenLastCalledWith({ name: 'changelog_closed', via: 'close', seconds: 6, read_time: '5-15s' });
  });
});
