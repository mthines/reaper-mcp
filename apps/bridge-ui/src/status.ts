import type { KnowledgeFeed } from './plugins.js';

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
  /** Session id of the agent that sent it */
  s?: string;
  /** Request params as JSON, truncated by the bridge (may not parse) */
  p?: string;
}

/** One agent connection (an MCP server process), keyed by Claude Code session id. */
export interface Session {
  id: string;
  /** Project directory the agent runs in */
  dir?: string;
  /** MCP client name, e.g. "claude-code" */
  client?: string;
  first: number;
  last: number;
  commands: number;
  errors: number;
  /** Set when the server said goodbye */
  ended?: boolean;
  /** Display name made unique by labelSessions (page-side, not sent by the bridge) */
  label?: string;
}

/** Settings the page writes to ExtState, echoed back by the bridge. */
export interface BridgeSettings {
  paused: boolean;
  readonly: boolean;
  openOnStart: boolean;
}

export interface BridgeHealth {
  sws: boolean;
  jsfx: boolean;
  missingJsfx?: string[];
  /** The installed mcp_bridge.lua changed since this copy started (setup ran): restart it */
  outdated: boolean;
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
  /** Absent on bridges older than the session feed */
  sessions?: Session[];
  settings?: BridgeSettings;
  health?: BridgeHealth;
  /** Experiment: plugin knowledge vs installed FX (only the demo fills it so far) */
  knowledge?: KnowledgeFeed;
}

/**
 * One web-interface request that pings `ui_seen` (the bridge checks it on start so it doesn't
 * open a second window while this page is open) and reads the status and timeline keys.
 */
export function statusRequestUrl(now: number): string {
  return `/_/SET/EXTSTATE/MCPBridge/ui_seen/${now};GET/EXTSTATE/MCPBridge/status;GET/EXTSTATE/MCPBridge/history`;
}

/**
 * Parse one JSON value from REAPER's web-interface reply lines: `EXTSTATE\tMCPBridge\t<key>\t<value>`.
 * REAPER escapes `\`, tab and newline in the value; JSON.parse is tried on the raw value
 * first so both escaped and unescaped replies work. Null when the key is missing or empty.
 */
function parseExtStateKey(body: string, key: string): unknown {
  const prefix = `EXTSTATE\tMCPBridge\t${key}\t`;
  const line = body.split('\n').find((l) => l.startsWith(prefix));
  const value = line?.slice(prefix.length);
  if (!value) return null;
  for (const candidate of [value, unescapeReaper(value)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function parseExtStateReply(body: string): BridgeStatus | null {
  const parsed = parseExtStateKey(body, 'status') as BridgeStatus | null;
  return parsed && typeof parsed === 'object' && Array.isArray(parsed.recent) ? parsed : null;
}

/** Command timeline published by the bridge: sparse buckets, `[bucketId, total, errors, slow, sumMs]`. */
export interface BridgeHistory {
  v: number;
  /** Bucket size in ms; bucket start = bucketId * size */
  size: number;
  b: Array<[number, number, number, number, number]>;
}

export function parseHistoryReply(body: string): BridgeHistory | null {
  const parsed = parseExtStateKey(body, 'history') as BridgeHistory | null;
  return parsed && typeof parsed === 'object' && Array.isArray(parsed.b) && parsed.size > 0 ? parsed : null;
}

export interface TimeBar {
  start: number;
  end: number;
  total: number;
  errors: number;
  slow: number;
  /** Average handler ms, null when the bar is empty */
  avgMs: number | null;
}

/** Group the bridge's buckets into `bars` equal bars covering the last `rangeMs`. */
export function bucketize(history: BridgeHistory | null, rangeMs: number, bars: number, now: number): TimeBar[] {
  const barMs = rangeMs / bars;
  // Align to bar boundaries so bars don't shift every second; the last bar holds "now"
  const start = Math.ceil(now / barMs) * barMs - rangeMs;
  const size = history?.size ?? 1;
  const sums = Array.from({ length: bars }, (_, i) => ({ start: start + i * barMs, end: start + (i + 1) * barMs, total: 0, errors: 0, slow: 0, ms: 0 }));
  for (const [id, total, errors, slow, ms] of history?.b ?? []) {
    const i = Math.floor((id * size - start) / barMs);
    if (i < 0 || i >= bars) continue;
    sums[i].total += total;
    sums[i].errors += errors;
    sums[i].slow += slow;
    sums[i].ms += ms;
  }
  return sums.map(({ ms, ...bar }) => ({ ...bar, avgMs: bar.total ? ms / bar.total : null }));
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

export type SettingKey = 'cfg_paused' | 'cfg_readonly' | 'cfg_open_on_start';

/**
 * Write one setting through the web interface. Pause is in-memory (clears when REAPER restarts so
 * a forgotten pause can't silently break agents next session); the others persist.
 */
export function settingUrl(key: SettingKey, on: boolean): string {
  const verb = key === 'cfg_paused' ? 'SET/EXTSTATE' : 'SET/EXTSTATEPERSIST';
  return `/_/${verb}/MCPBridge/${key}/${on ? 1 : 0}`;
}

/** Sessions ping every 20s; two missed pings (or a goodbye) means the agent is gone. */
export function isConnected(session: Session, now: number): boolean {
  return !session.ended && now - session.last < 45_000;
}

const pathParts = (dir: string | undefined) => (dir ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);

/** "song-a" from "/work/song-a" (or its unique label), falling back to a short id. */
export function sessionName(session: Pick<Session, 'id' | 'dir' | 'label'>): string {
  return session.label || pathParts(session.dir).pop() || session.id.replace(/^pid-/, 'pid ').slice(0, 8);
}

/**
 * Give every session a distinct label: the folder name, then parent/folder when two folders share a
 * name, then "#1", "#2" (by start time) for agents running in the same folder.
 */
export function labelSessions(sessions: Session[]): Session[] {
  const base = (x: Session) => sessionName({ id: x.id, dir: x.dir });
  const labels = new Map(sessions.map((x) => [x.id, base(x)]));
  const groups = (fn: (x: Session) => string) => {
    const by = new Map<string, Session[]>();
    for (const x of sessions) by.set(fn(x), [...(by.get(fn(x)) ?? []), x]);
    return [...by.values()].filter((g) => g.length > 1);
  };
  for (const group of groups((x) => labels.get(x.id) as string)) {
    for (const x of group) {
      const parts = pathParts(x.dir);
      if (new Set(group.map((y) => y.dir)).size > 1 && parts.length > 1) labels.set(x.id, parts.slice(-2).join('/'));
    }
  }
  for (const group of groups((x) => labels.get(x.id) as string)) {
    [...group].sort((a, b) => a.first - b.first).forEach((x, i) => labels.set(x.id, `${labels.get(x.id)} #${i + 1}`));
  }
  return sessions.map((x) => ({ ...x, label: labels.get(x.id) }));
}

/** Stable color slot (0-5) per session so its dot keeps its color across reloads. */
export function sessionHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 6;
}

export type CommandKind = 'read' | 'write' | 'transport';

const READ_PREFIXES = ['get_', 'list_', 'read_', 'analyze_', 'search_', 'measure_'];
const TRANSPORT = new Set(['play', 'stop', 'record', 'set_cursor_position', 'set_time_selection']);

/** Rough intent of a command: inspects the project, changes it, or drives transport. Mirrors the bridge's read-only allowlist. */
export function commandKind(c: string): CommandKind {
  if (TRANSPORT.has(c)) return 'transport';
  if (READ_PREFIXES.some((p) => c.startsWith(p)) || c === 'snapshot_list' || c === 'render_track_to_wav') return 'read';
  return 'write';
}

export interface ToolGroup {
  c: string;
  kind: CommandKind;
  count: number;
  errors: number;
  avg: number;
  p95: number;
  max: number;
  /** Newest call's timestamp */
  last: number;
  /** Most recent error message, if any */
  lastError?: string;
}

export type ToolSort = 'count' | 'errors' | 'slowest' | 'recent';

/** Aggregate the log per command type. `entries` is newest first, as the log keeps it. */
export function groupByTool(entries: CommandEntry[], sort: ToolSort = 'count'): ToolGroup[] {
  const groups = new Map<string, { entries: CommandEntry[]; errors: number; lastError?: string }>();
  for (const e of entries) {
    const g = groups.get(e.c) ?? { entries: [], errors: 0 };
    g.entries.push(e);
    if (!e.ok) {
      g.errors += 1;
      g.lastError ??= e.e;
    }
    groups.set(e.c, g);
  }
  const rows: ToolGroup[] = [...groups].map(([c, g]) => {
    const lat = latencyStats(g.entries) as LatencyStats;
    return { c, kind: commandKind(c), count: g.entries.length, errors: g.errors, avg: lat.avg, p95: lat.p95, max: lat.max, last: g.entries[0].t, lastError: g.lastError };
  });
  const by: Record<ToolSort, (a: ToolGroup, b: ToolGroup) => number> = {
    count: (a, b) => b.count - a.count,
    errors: (a, b) => b.errors - a.errors || b.count - a.count,
    slowest: (a, b) => b.p95 - a.p95,
    recent: (a, b) => b.last - a.last,
  };
  return rows.sort((a, b) => by[sort](a, b) || a.c.localeCompare(b.c));
}

/** Pretty-print captured params; the bridge truncates long ones, so fall back to the raw text. */
export function formatParams(p: string | undefined): string | null {
  if (!p) return null;
  try {
    return JSON.stringify(JSON.parse(p), null, 2);
  } catch {
    return `${p}…`;
  }
}
