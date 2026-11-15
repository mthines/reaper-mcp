import { useEffect, useRef, useState } from 'react';
import { fetchText } from '../lib/fetch-text.js';
import { parseSharedFlags, saveSharedFlagsUrl, sharedFlagsUrl } from '../lib/shared-flags.js';
import { flagStore, type FlagStore } from '../lib/flag-store.js';

const POLL_MS = 3000;
/** A write the bridge never acknowledged (refused, or the bridge went away) stops holding back the file after this */
const PENDING_MS = 4000;

/**
 * Keeps the page's flag overrides and the bridge's flags.json the same list: it reads the file on load and every few
 * seconds (so `reaper-mcp flags set` shows up here), and sends every change made in the Developer drawer to it, so the MCP
 * server sees the same override. While one of the page's own writes is in flight the file is not adopted, or the
 * old value would flash back. Without a bridge (the demo, bridge down, no home folder) it does nothing and
 * the overrides stay this browser's. Returns whether they are shared.
 */
export function useSharedFlags(enabled: boolean, controlToken: string | undefined, store: FlagStore = flagStore): boolean {
  const [shared, setShared] = useState(false);
  const pending = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled || !controlToken) return;
    let cancelled = false;
    const read = () => {
      if (document.hidden) return;
      void fetchText(sharedFlagsUrl()).then((body) => {
        const file = body === null ? null : parseSharedFlags(body);
        if (cancelled || !file?.writable) return;
        setShared(true);
        const waiting = pending.current;
        if (waiting && file.req !== waiting.id && Date.now() - waiting.at < PENDING_MS) return;
        pending.current = null;
        store.adopt(file.overrides);
      });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, controlToken, store]);

  useEffect(() => {
    if (!shared || !controlToken) return;
    store.setSink((overrides) => {
      const id = String(Date.now());
      pending.current = { id, at: Date.now() };
      void fetchText(saveSharedFlagsUrl(id, controlToken, overrides));
    });
    return () => store.setSink(null);
  }, [shared, controlToken, store]);

  return shared && enabled;
}
