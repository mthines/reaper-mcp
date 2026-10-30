import { useEffect, useRef, useState } from 'react';
import { HISTORY_MAX, type BridgeStatus, type Sample } from '../lib/status.js';

/** Snapshot the bridge's cumulative counters once per tick for the stat sparklines. */
export function useHistory(status: BridgeStatus | null, now: number): Sample[] {
  const [samples, setSamples] = useState<Sample[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const st = statusRef.current;
    if (!st) return;
    setSamples((prev) => {
      const last = prev[prev.length - 1];
      // Bridge restarted: counters reset, start a fresh history
      const base = last && st.commands < last.commands ? [] : prev;
      return [...base, { t: now, commands: st.commands, errors: st.errors, deferMs: st.deferMs }].slice(-HISTORY_MAX);
    });
  }, [now]);

  return samples;
}
