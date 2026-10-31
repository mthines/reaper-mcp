import type { CommandEntry } from './commands.js';
import type { TimeBar } from './timeline.js';

/** The bridge's saved command log (ExtState `log`), kept across restarts. */
export interface SavedLog {
  /** The `log_want` request this answers */
  req: string;
  /** Newest first */
  entries: CommandEntry[];
}

/**
 * Merge the bridge's saved log into the page's log: the union by sequence number, newest first,
 * capped at LOG_MAX. Entries at or below `clearedThrough` (cleared by the user) stay out.
 */
export function restoreLog(log: CommandEntry[], saved: CommandEntry[], clearedThrough = 0): CommandEntry[] {
  const byN = new Map<number, CommandEntry>();
  for (const e of saved) if (e.n > clearedThrough) byN.set(e.n, e);
  for (const e of log) byN.set(e.n, e);
  return [...byN.values()].sort((a, b) => b.n - a.n).slice(0, LOG_MAX);
}

/** Bars that ended by `at` (the viewer's last Clear) drawn empty; the bar Clear fell in keeps its counts. */
export function clearedBefore(bars: TimeBar[], at: number): TimeBar[] {
  if (!at) return bars;
  return bars.map((b) => (b.end <= at ? { ...b, total: 0, errors: 0, slow: 0, avgMs: null } : b));
}

export interface LatencyStats {
  avg: number;
  p95: number;
  max: number;
}

export function latencyStats(entries: CommandEntry[]): LatencyStats | null {
  if (entries.length === 0) return null;
  const sorted = entries.map((e) => e.ms).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    avg: sum / sorted.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted[sorted.length - 1],
  };
}

/** Commands in the trailing 60s window (recent is capped, so this saturates at its length). */
export function commandsPerMinute(entries: CommandEntry[], now: number): number {
  return entries.filter((e) => now - e.t <= 60_000).length;
}

export const LOG_MAX = 1000;

/**
 * Merge the bridge's latest window (newest first) into the page's longer log,
 * de-duplicating by sequence number. Newest first, capped at LOG_MAX.
 */
export function mergeLog(log: CommandEntry[], incoming: CommandEntry[]): CommandEntry[] {
  const newest = log[0]?.n ?? 0;
  const fresh = incoming.filter((e) => e.n > newest);
  if (fresh.length === 0) return log;
  return [...fresh, ...log].slice(0, LOG_MAX);
}

/** One per-second snapshot of the bridge's cumulative counters (taken by the page, not the bridge). */
export interface Sample {
  t: number;
  commands: number;
  errors: number;
  deferMs: number;
}

/** Samples kept for the stat sparklines: 60 intervals = the last minute at 1 Hz. */
export const HISTORY_MAX = 61;

export interface Series {
  commands: number[];
  errors: number[];
  /** Avg handler ms of commands finished in each interval; null when there were none */
  latency: Array<number | null>;
  loop: number[];
}

/** Turn cumulative samples into per-interval sparkline series (one point per gap between samples). */
export function deriveSeries(samples: Sample[], log: CommandEntry[]): Series {
  const series: Series = { commands: [], errors: [], latency: [], loop: [] };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    series.commands.push(Math.max(0, b.commands - a.commands));
    series.errors.push(Math.max(0, b.errors - a.errors));
    const inWindow = log.filter((e) => e.t > a.t && e.t <= b.t);
    series.latency.push(inWindow.length ? inWindow.reduce((s, e) => s + e.ms, 0) / inWindow.length : null);
    series.loop.push(b.deferMs);
  }
  return series;
}
