import type { KnowledgeFeed } from './plugins.js';

/** One command the bridge handled (newest first in BridgeStatus.recent). */
export interface CommandEntry {
  /** Sequence number (1-based), continued across bridge restarts */
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
  /** Sent from this page (a snapshot restore or save), not by an agent */
  src?: 'page';
  /** Request params as JSON, truncated by the bridge (may not parse) */
  p?: string;
  /** Compact result of a measuring command (meters, LUFS, correlation, crest, spectrum bands, a render's waveform) */
  r?: Record<string, unknown>;
}

/** A measuring command's result, typed by what it measured; numbers the bridge couldn't read are left out. */
export type Measurement =
  | { kind: 'meters'; peakL?: number; peakR?: number; rmsL?: number; rmsR?: number }
  | { kind: 'lufs'; integrated?: number; shortTerm?: number; momentary?: number; truePeakL?: number; truePeakR?: number; duration?: number }
  | { kind: 'correlation'; correlation?: number; stereoWidth?: number; midLevel?: number; sideLevel?: number }
  | { kind: 'crest'; crestFactor?: number; peakLevel?: number; rmsLevel?: number }
  | { kind: 'spectrum'; peakDb?: number; rmsDb?: number; fftSize?: number; sampleRate?: number; bands: number[] }
  | { kind: 'waveform'; peakDb?: number; rmsDb?: number; clipped?: number; durationSeconds?: number; channels?: number; hi: number[]; lo: number[] }
  /** Offline analysis (sidecar): BS.1770 loudness, LRA, peaks, sections [start, end, LUFS], band balance (share of
   *  energy in dB, sub..brilliance, null = silent), resonances [Hz, dB above the local spectrum], and a reference */
  | {
      kind: 'offline'; name?: string; lufs?: number; lra?: number; tp?: number; peak?: number; crest?: number; dur?: number; sib?: number;
      sections: [number, number, number][]; bands: (number | null)[]; res: [number, number][];
      ref?: { lufs?: number; delta?: number; bands: (number | null)[] };
    }
  /** Track alignment (sidecar): the delay against a reference track, polarity, and the playOffsetMs / phase that fix it */
  | { kind: 'alignment'; ref?: string; name?: string; delayMs?: number; samples?: number; corr?: number; inv?: number; cur?: number; offset?: number; phase?: number; warn?: number }
  /** Audiobox Aesthetics scores (0-10) and the level the clip was scored at */
  | { kind: 'aesthetics'; name?: string; pq?: number; pc?: number; ce?: number; cu?: number; lufs?: number; dur?: number };

const MEASUREMENTS: Record<string, { kind: Measurement['kind']; fields: string[] }> = {
  read_track_meters: { kind: 'meters', fields: ['peakL', 'peakR', 'rmsL', 'rmsR'] },
  read_track_lufs: { kind: 'lufs', fields: ['integrated', 'shortTerm', 'momentary', 'truePeakL', 'truePeakR', 'duration'] },
  read_track_correlation: { kind: 'correlation', fields: ['correlation', 'stereoWidth', 'midLevel', 'sideLevel'] },
  read_track_crest: { kind: 'crest', fields: ['crestFactor', 'peakLevel', 'rmsLevel'] },
  read_track_spectrum: { kind: 'spectrum', fields: ['peakDb', 'rmsDb', 'fftSize', 'sampleRate'] },
  render_track_to_wav: { kind: 'waveform', fields: ['peakDb', 'rmsDb', 'clipped', 'durationSeconds', 'channels'] },
  // Composed by the server (sidecar) and logged with `_log_result`
  analyze_track_offline: { kind: 'offline', fields: ['lufs', 'lra', 'tp', 'peak', 'crest', 'dur', 'sib'] },
  analyze_audio_file: { kind: 'offline', fields: ['lufs', 'lra', 'tp', 'peak', 'crest', 'dur', 'sib'] },
  measure_track_alignment: { kind: 'alignment', fields: ['delayMs', 'samples', 'corr', 'inv', 'cur', 'offset', 'phase', 'warn'] },
  analyze_track_aesthetics: { kind: 'aesthetics', fields: ['pq', 'pc', 'ce', 'cu', 'lufs', 'dur'] },
};

/** Every command the drawer draws a result for */
export const MEASURED_COMMANDS = Object.keys(MEASUREMENTS);

const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number');

/** Params as a value when they parse, else the truncated text the bridge sent. */
export function parseParams(p: string | undefined): unknown {
  if (!p) return undefined;
  try {
    return JSON.parse(p);
  } catch {
    return p;
  }
}

const trackOf = (e: CommandEntry) => {
  const p = parseParams(e.p);
  return p && typeof p === 'object' ? (p as Record<string, unknown>).trackIndex : undefined;
};

/**
 * The same measurement on the same track, newest first, `e` included: what its history line plots.
 * Only calls with a result; at most `limit`, centred on `e` so older calls keep their own neighbours.
 */
export function measurementHistory(log: CommandEntry[], e: CommandEntry, limit = 30): CommandEntry[] {
  if (!measurementOf(e)) return [];
  const track = trackOf(e);
  const same = log.filter((x) => x.c === e.c && trackOf(x) === track && measurementOf(x) !== null);
  const at = same.findIndex((x) => x.n === e.n);
  const start = Math.max(0, Math.min(at - Math.floor(limit / 2), same.length - limit));
  return same.slice(start, start + limit);
}

/** The entry's measurement, or null for other commands, failures, and entries logged before the bridge kept results */
export function measurementOf(e: CommandEntry): Measurement | null {
  const spec = MEASUREMENTS[e.c];
  if (!spec || !e.ok || !e.r) return null;
  const out: Record<string, unknown> = { kind: spec.kind };
  for (const f of spec.fields) if (typeof e.r[f] === 'number') out[f] = e.r[f];
  if (spec.kind === 'spectrum') {
    if (!isNumbers(e.r.bands)) return null;
    out.bands = e.r.bands;
  }
  if (spec.kind === 'offline' || spec.kind === 'alignment' || spec.kind === 'aesthetics') {
    for (const f of ['name', 'ref']) if (typeof e.r[f] === 'string') out[f] = e.r[f];
  }
  if (spec.kind === 'offline') {
    const r = e.r;
    if (typeof r.lufs !== 'number') return null;
    const bands = (v: unknown) => (Array.isArray(v) ? v.map((b) => (typeof b === 'number' ? b : null)) : []);
    const triples = (v: unknown, n: number) =>
      Array.isArray(v) ? v.filter((t) => Array.isArray(t) && t.length === n && t.every((x) => typeof x === 'number')) : [];
    out.sections = triples(r.sections, 3);
    out.res = triples(r.res, 2);
    out.bands = bands(r.bands);
    if (r.ref && typeof r.ref === 'object') {
      const ref = r.ref as Record<string, unknown>;
      out.ref = {
        ...(typeof ref.lufs === 'number' ? { lufs: ref.lufs } : {}),
        ...(typeof ref.delta === 'number' ? { delta: ref.delta } : {}),
        bands: bands(ref.bands),
      };
    }
  }
  if (spec.kind === 'waveform') {
    const { hi, lo } = e.r;
    if (!isNumbers(hi) || !isNumbers(lo) || hi.length !== lo.length) return null;
    out.hi = hi;
    out.lo = lo;
  }
  return out as Measurement;
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
  /** Developer mode: Rebuild & reload instead of release updates. Absent on bridges older than it */
  dev?: boolean;
}

export interface BridgeHealth {
  sws: boolean;
  jsfx: boolean;
  missingJsfx?: string[];
  /** The installed mcp_bridge.lua changed since this copy started (setup ran): restart it */
  outdated: boolean;
}

/** Sockets REAPER's web server still holds after their client hung up; it stops answering near `limit`. */
export interface BridgeWebSockets {
  stuck: number;
  limit: number;
}

/** When to warn that REAPER's web server is filling up: from half the limit, urgently from 80%. */
export function webSocketLevel(web: BridgeWebSockets | undefined): 'ok' | 'filling' | 'full' {
  if (!web || !(web.limit > 0)) return 'ok';
  const share = web.stuck / web.limit;
  return share >= 0.8 ? 'full' : share >= 0.5 ? 'filling' : 'ok';
}

/** A self-update run by the bridge (scripts/update.sh); gone once the bridge restarts into the new version. */
export interface BridgeUpdate {
  /** update: pull the latest version; rebuild: build the working tree as it is (developer mode) */
  kind?: 'update' | 'rebuild';
  state: 'running' | 'failed' | 'done';
  startedAt: number;
  /** Last lines of the update log; an empty Lua table can arrive as `{}` */
  log: string[] | Record<string, never>;
}

/** One-click actions the page may request; `token` must accompany every request (see controlUrl). */
export interface BridgeControl {
  token: string;
  /** REAPER 7.03+ (set_action_options): the bridge can restart itself */
  canRestart: boolean;
  /** setup wrote mcp_update.conf for a git clone (not on Windows) */
  canUpdate: boolean;
  /** Developer mode: the clone has source files newer than the last install */
  changed?: boolean;
  update?: BridgeUpdate;
  /** The bridge lists, restores and saves snapshots for the page (ExtState snap_seen / snap_req / snapshots) */
  snapshots?: boolean;
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
  /** Absent on Windows, without a web interface, and until the first count (30 s after the bridge starts) */
  web?: BridgeWebSockets;
  /** Absent on bridges older than one-click update */
  control?: BridgeControl;
  /** Demo only: the live page builds this from ExtState `installed` and LoreKit (useKnowledge) */
  knowledge?: KnowledgeFeed;
}

/**
 * One web-interface request that pings `ui_seen` (the bridge checks it on start so it doesn't
 * open a second window while this page is open) and reads the status and timeline keys.
 */
export function statusRequestUrl(now: number, extraKeys: string[] = [], logWant?: number): string {
  // log_want asks the bridge to publish its saved log; it answers on its next loop, echoing the value
  const ask = logWant === undefined ? '' : `;SET/EXTSTATE/MCPBridge/log_want/${logWant}`;
  const extra = extraKeys.map((k) => `;GET/EXTSTATE/MCPBridge/${k}`).join('');
  return `/_/SET/EXTSTATE/MCPBridge/ui_seen/${now}${ask};GET/EXTSTATE/MCPBridge/status;GET/EXTSTATE/MCPBridge/history${extra}`;
}

/**
 * Parse one JSON value from REAPER's web-interface reply lines: `EXTSTATE\tMCPBridge\t<key>\t<value>`.
 * REAPER escapes `\`, tab and newline in the value; JSON.parse is tried on the raw value
 * first so both escaped and unescaped replies work. Null when the key is missing or empty.
 */
export function parseExtStateKey(body: string, key: string): unknown {
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

type Bucket = [number, number, number, number, number];

/** The day/week timeline (ExtState `history_long`): 1m buckets for 24h and 10m buckets for 7d. */
export interface LongHistory {
  v: number;
  tiers: Array<{ size: number; b: Bucket[] }>;
}

export function parseLongHistoryReply(body: string): LongHistory | null {
  const parsed = parseExtStateKey(body, 'history_long') as LongHistory | null;
  return parsed && typeof parsed === 'object' && Array.isArray(parsed.tiers) ? parsed : null;
}

/** The bridge's saved command log (ExtState `log`), kept across restarts. */
export interface SavedLog {
  /** The `log_want` request this answers */
  req: string;
  /** Newest first */
  entries: CommandEntry[];
}

export function parseLogReply(body: string): SavedLog | null {
  const parsed = parseExtStateKey(body, 'log') as { req?: unknown; entries?: unknown } | null;
  return parsed && Array.isArray(parsed.entries) ? { req: String(parsed.req ?? ''), entries: parsed.entries as CommandEntry[] } : null;
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

/** How far back each bucket size reaches; mirrors HISTORY_TIERS in reaper/mcp_bridge.lua. */
const TIER_SPAN_MS: Record<number, number> = { 10_000: 3_600_000, 60_000: 86_400_000, 600_000: 7 * 86_400_000 };

/** Every timeline tier the bridge publishes, finest first. */
export function historyTiers(history: BridgeHistory | null, long: LongHistory | null): BridgeHistory[] {
  const tiers: BridgeHistory[] = history ? [history] : [];
  for (const t of long?.tiers ?? []) tiers.push({ v: long?.v ?? 1, size: t.size, b: t.b });
  return tiers.sort((a, b) => a.size - b.size);
}

/**
 * Bars for a range from the finest tier that both reaches back over the whole range and fits whole
 * buckets into a bar (10s buckets for an hour, 1m for a day, 10m for a week).
 */
export function timelineBars(tiers: BridgeHistory[], rangeMs: number, bars: number, now: number): TimeBar[] {
  const barMs = rangeMs / bars;
  const fits = tiers.filter((t) => t.size <= barMs && barMs % t.size === 0);
  const tier = fits.find((t) => (TIER_SPAN_MS[t.size] ?? 0) >= rangeMs) ?? fits[fits.length - 1] ?? null;
  return bucketize(tier, rangeMs, bars, now);
}

/** A time span picked on the chart: [start, end) in epoch ms. */
export interface Span {
  start: number;
  end: number;
}

/** The span covered by bars `from`..`to` (either order, inclusive). */
export function spanOfBars(bars: TimeBar[], from: number, to: number): Span {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { start: bars[a].start, end: bars[b].end };
}

/** The entries inside the span; all of them when there is no span. */
export function inSpan<T extends { t: number }>(entries: T[], span: Span | null): T[] {
  return span ? entries.filter((e) => e.t >= span.start && e.t < span.end) : entries;
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
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/** Calendar day of `t` relative to `now` (local time): "Today", "Yesterday", else a short date (year only when it differs). */
export function formatDay(t: number, now: number): string {
  const day = new Date(t);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(day.getFullYear() !== today.getFullYear() ? { year: '2-digit' } : {}),
  });
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

export type SettingKey = 'cfg_paused' | 'cfg_readonly' | 'cfg_open_on_start' | 'cfg_dev';

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

/** An agent that has only pinged (connected, no tool calls yet) is noise next to the ones working. */
export function hasToolCalls(session: Pick<Session, 'commands'>): boolean {
  return session.commands > 0;
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

export const SLOW_MS = 100;
export const VERY_SLOW_MS = 500;

/**
 * Error prefixes that mean the system failed (a handler crash, an unknown command, a handler that
 * caught its own broken assumption). Every other failure is a refused request ("Track 9 not found"):
 * expected, shown as a warning, never counted as an error or notified. Mirrors record_command in
 * mcp_bridge.lua (which counts errors for the timeline) and classifyBridgeError in the server.
 */
export const SYSTEM_ERROR_PREFIXES = ['Handler error:', 'Unknown command type', 'Internal error:'];

export type Outcome = 'ok' | 'error' | 'refused';

export function outcomeOf(e: Pick<CommandEntry, 'ok' | 'e'>): Outcome {
  if (e.ok) return 'ok';
  return SYSTEM_ERROR_PREFIXES.some((p) => e.e?.startsWith(p)) ? 'error' : 'refused';
}

/**
 * Commands whose duration is the work itself: renders, plugin instantiation (a sampler can take
 * seconds to load), project/chunk IO, and proxies that run arbitrary work. Never rated slow.
 * Mirrors LONG_RUNNING in mcp_bridge.lua, which keeps them out of the timeline's slow count.
 */
export const LONG_RUNNING = new Set([
  'analyze_track_offline',
  'analyze_audio_file',
  'measure_track_alignment',
  'analyze_track_aesthetics',
  'render_project',
  'render_track_to_wav',
  'run_plan',
  'run_action',
  'save_project',
  'undo_project',
  'redo_project',
  'add_fx',
  'add_take_fx',
  'setup_fx_chain',
  'copy_fx',
  'move_fx',
  'set_fx_offline',
  'set_fx_preset',
  'get_fx_preset_list',
  'list_available_fx',
  'load_fx_chain',
  'insert_track_template',
  'insert_audio_file',
  'snapshot_save',
  'snapshot_restore',
]);

export type Speed = 'fast' | 'slow' | 'very-slow' | 'long';

/** How a duration reads for this command: long-running commands are expected to take time. */
export function speedOf(c: string, ms: number): Speed {
  if (LONG_RUNNING.has(c)) return 'long';
  return ms >= VERY_SLOW_MS ? 'very-slow' : ms >= SLOW_MS ? 'slow' : 'fast';
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
    if (outcomeOf(e) === 'error') {
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

/**
 * One search term: plain text matches the command name, error or params anywhere; `key:value` matches a
 * param exactly (`trackIndex:6` is not track 16). A value with spaces is quoted: `fxName:"VST3: Pro-Q 3"`.
 */
export interface QueryTerm {
  key?: string;
  value: string;
}

/** Whitespace-separated terms, all of which must match */
export function parseQuery(query: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  for (const m of query.matchAll(/(\w+):"([^"]*)"?|(\w+):(\S+)|"([^"]*)"?|(\S+)/g)) {
    if (m[1] !== undefined) terms.push({ key: m[1], value: m[2].toLowerCase() });
    else if (m[3] !== undefined) terms.push({ key: m[3], value: m[4].toLowerCase() });
    else {
      const v = (m[5] ?? m[6]).toLowerCase();
      if (v) terms.push({ value: v });
    }
  }
  return terms;
}

export function matchesQuery(e: CommandEntry, terms: QueryTerm[]): boolean {
  if (terms.length === 0) return true;
  let params: Record<string, unknown> | null | undefined;
  return terms.every((t) => {
    if (t.key === undefined) return e.c.toLowerCase().includes(t.value) || !!e.e?.toLowerCase().includes(t.value) || !!e.p?.toLowerCase().includes(t.value);
    if (params === undefined) {
      const p = parseParams(e.p);
      params = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
    }
    const v = params?.[t.key];
    return v !== undefined && v !== null && typeof v !== 'object' && String(v).toLowerCase() === t.value;
  });
}

/** The term that filters to a param, quoted when the value has spaces */
export function paramTerm(key: string, value: unknown): string {
  const v = String(value);
  return /[\s"]/.test(v) ? `${key}:"${v.replace(/"/g, '')}"` : `${key}:${v}`;
}

/**
 * What a text selection in the formatted params filters by: inside one `"key": value` line, that param
 * (wherever on the line the selection is); otherwise the selected words.
 */
export function termFromSelection(text: string, start: number, end: number): string | null {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const selected = text.slice(from, to).trim();
  if (!selected) return null;
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const nl = text.indexOf('\n', from);
  const lineEnd = nl === -1 ? text.length : nl;
  if (to <= lineEnd) {
    const kv = /^\s*"(\w+)":\s*(.+?),?\s*$/.exec(text.slice(lineStart, lineEnd));
    if (kv && !/^[[{]/.test(kv[2])) {
      try {
        return paramTerm(kv[1], JSON.parse(kv[2]));
      } catch {
        // not a plain JSON value: fall back to the text
      }
    }
  }
  // Any other text: its words, each a plain term
  return selected.replace(/["{}]/g, ' ').split(/\s+/).filter(Boolean).join(' ') || null;
}
