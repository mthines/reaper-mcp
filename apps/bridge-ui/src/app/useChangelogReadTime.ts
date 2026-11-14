import { useEffect, useRef } from 'react';
import { track, type TrackEvent } from '../lib/analytics.js';

/** What closed the What's new drawer: its close button or Esc, opening Settings, leaving the page, or anything else (back/forward). */
export type ChangelogCloseVia = Extract<TrackEvent, { name: 'changelog_closed' }>['via'];

/** A read's length as one of a few ranges: unlike `seconds`, few enough values for a dashboard to group by. */
export type ReadTimeBucket = Extract<TrackEvent, { name: 'changelog_closed' }>['read_time'];

/** Shortest first; each range holds the seconds below the next one's start. */
const READ_TIME_BUCKETS: ReadonlyArray<[upTo: number, bucket: ReadTimeBucket]> = [
  [5, '<5s'],
  [15, '5-15s'],
  [30, '15-30s'],
  [60, '30-60s'],
  [180, '1-3m'],
];

/** The range a read of `seconds` (already rounded) falls in. */
export function readTimeBucket(seconds: number): ReadTimeBucket {
  return READ_TIME_BUCKETS.find(([upTo]) => seconds < upTo)?.[1] ?? '3m+';
}

export interface ReadTimer {
  pause(): void;
  resume(): void;
  elapsedMs(): number;
}

/** Time that passes while the page is visible: a tab in the background isn't someone reading. */
export function readTimer(now: () => number, visible: boolean): ReadTimer {
  let total = 0;
  let since: number | null = visible ? now() : null;
  return {
    pause() {
      if (since === null) return;
      total += now() - since;
      since = null;
    },
    resume() {
      if (since === null) since = now();
    },
    elapsedMs: () => total + (since === null ? 0 : now() - since),
  };
}

/**
 * Sends one `changelog_closed` with how long the What's new drawer stayed open, when it closes or the page goes away.
 * @returns A function to call just before closing, naming how it closed; a close nobody named is `other`.
 */
export function useChangelogReadTime(open: boolean): (via: ChangelogCloseVia) => void {
  const via = useRef<ChangelogCloseVia>('other');
  // Every way of closing the drawer ends with `open` turning false, so watch that rather than each close path
  useEffect(() => {
    if (!open) return;
    via.current = 'other';
    const visible = () => document.visibilityState === 'visible';
    let timer = readTimer(() => performance.now(), visible());
    let sent = false;
    const send = (how: ChangelogCloseVia) => {
      if (sent) return;
      sent = true;
      const seconds = Math.round(timer.elapsedMs() / 1000);
      track({ name: 'changelog_closed', via: how, seconds, read_time: readTimeBucket(seconds) });
    };
    const onVisibility = () => (visible() ? timer.resume() : timer.pause());
    const onPageHide = () => send('page_left');
    // Back from the browser's page cache with the drawer still open: a new read starts
    const onPageShow = (ev: PageTransitionEvent) => {
      if (!ev.persisted || !sent) return;
      sent = false;
      timer = readTimer(() => performance.now(), visible());
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      send(via.current);
    };
  }, [open]);
  return (how) => {
    via.current = how;
  };
}
