/** One command the bridge handled (newest first in BridgeStatus.recent). */
export interface CommandEntry {
  /** Sequence number since bridge start (1-based) */
  n: number;
  /** Epoch ms when the handler finished */
  t: number;
  /** Command type, e.g. "set_fx_parameter" */
  c: string;
  /** Handler duration in ms */
  ms: number;
  ok: boolean;
  /** Error message when ok is false */
  e?: string;
}

/** Shape published by mcp_bridge.lua to ExtState MCPBridge/status. */
export interface BridgeStatus {
  v: number;
  ts: number;
  startedAt: number;
  reaperVersion: string;
  project: string;
  bridgeDir: string;
  commands: number;
  errors: number;
  deferMs: number;
  recent: CommandEntry[];
}

/**
 * One web-interface request that both reads the status and pings `ui_seen`, which the
 * bridge checks on start so it doesn't open a second window while this page is open.
 */
export function statusRequestUrl(now: number): string {
  return `/_/SET/EXTSTATE/MCPBridge/ui_seen/${now};GET/EXTSTATE/MCPBridge/status`;
}

/**
 * Parse REAPER's web-interface reply: `EXTSTATE\tMCPBridge\tstatus\t<value>`.
 * REAPER escapes `\`, tab and newline in the value; JSON.parse is tried on the
 * raw value first so both escaped and unescaped replies work.
 * Returns null when the key is missing or empty (bridge not running).
 */
export function parseExtStateReply(body: string): BridgeStatus | null {
  const line = body.split('\n').find((l) => l.startsWith('EXTSTATE\t'));
  if (!line) return null;
  const value = line.split('\t').slice(3).join('\t');
  if (!value) return null;
  for (const candidate of [value, unescapeReaper(value)]) {
    try {
      const parsed = JSON.parse(candidate) as BridgeStatus;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.recent)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function unescapeReaper(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));
}

export type Liveness = 'live' | 'stale' | 'offline';

/** The bridge republishes at least every 1s; no new `ts` for 3s means it's stuck or stopped. */
export function liveness(status: BridgeStatus | null, lastChangeAt: number, now: number): Liveness {
  if (!status) return 'offline';
  return now - lastChangeAt > 3000 ? 'stale' : 'live';
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

export const LOG_MAX = 500;

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

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function formatAgo(ms: number): string {
  if (ms < 1500) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
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
