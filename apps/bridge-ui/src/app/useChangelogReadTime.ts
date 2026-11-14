import { useEffect, useRef } from 'react';
import { track, type TrackEvent } from '../lib/analytics.js';

/** What closed the What's new drawer: its close button or Esc, opening Settings, leaving the page, or anything else (back/forward). */
export type ChangelogCloseVia = Extract<TrackEvent, { name: 'changelog_closed' }>['via'];

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
 * How long the What's new drawer stays open, sent as one `changelog_closed` when it closes (or the page goes away
 * with it open). Every way of closing it ends with `open` turning false, so this watches `open` rather than each
 * close path; call the returned function just before closing to say how (it defaults to `other`).
 */
export function useChangelogReadTime(open: boolean): (via: ChangelogCloseVia) => void {
  const via = useRef<ChangelogCloseVia>('other');
  useEffect(() => {
    if (!open) return;
    via.current = 'other';
    const visible = () => document.visibilityState === 'visible';
    let timer = readTimer(() => performance.now(), visible());
    let sent = false;
    const send = (how: ChangelogCloseVia) => {
      if (sent) return;
      sent = true;
      track({ name: 'changelog_closed', via: how, seconds: Math.round(timer.elapsedMs() / 1000) });
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
