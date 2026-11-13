import { useEffect, useState } from 'react';

/** How long REAPER's web server must stay gone before the bridge's own window closes with it. */
export const CLOSE_AFTER_MS = 5000;

/**
 * The bridge opens its status page as an app window (`?app=window`). When REAPER quits, its web
 * server goes away, so the window has nothing left to show: count down, then close it. Enter (or
 * `cancel`) keeps it open until REAPER is reachable again. Only that window closes (a tab, the
 * installed app and ?demo stay). A stopped bridge script (server still up) is not "unreachable"
 * and keeps the window open.
 *
 * `secondsLeft` is null while nothing is counting down.
 */
export function useCloseWithReaper(reachable: boolean, enabled: boolean): { secondsLeft: number | null; cancel: () => void } {
  const [cancelled, setCancelled] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  // REAPER is back: the next quit counts down again
  if (reachable && cancelled) setCancelled(false);
  const active = enabled && !reachable && !cancelled;

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const tick = () => {
      const remaining = Math.ceil((CLOSE_AFTER_MS - (Date.now() - start)) / 1000);
      if (remaining <= 0) {
        clearInterval(id);
        window.close();
      }
      else setLeft(remaining);
    };
    const id: ReturnType<typeof setInterval> = setInterval(tick, 250);
    return () => {
      clearInterval(id);
      setLeft(null);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      setCancelled(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return { secondsLeft: active ? left : null, cancel: () => setCancelled(true) };
}
