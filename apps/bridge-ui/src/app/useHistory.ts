import { useState } from 'react';
import type { BridgeStatus } from '../lib/status.js';
import { HISTORY_MAX, type Sample } from '../lib/log.js';

/** Snapshot the bridge's cumulative counters once per tick for the stat sparklines. */
export function useHistory(status: BridgeStatus | null, now: number): Sample[] {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampledAt, setSampledAt] = useState<number | null>(null);
  // One sample per tick, taken while rendering it (React's pattern for state that follows a prop)
  if (status && now !== sampledAt) {
    setSampledAt(now);
    const last = samples[samples.length - 1];
    // Bridge restarted: counters reset, start a fresh history
    const base = last && status.commands < last.commands ? [] : samples;
    setSamples([...base, { t: now, commands: status.commands, errors: status.errors, deferMs: status.deferMs }].slice(-HISTORY_MAX));
  }
  return samples;
}
