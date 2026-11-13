import type { CommandEntry } from './commands.js';
import type { OlderPage, SavedLog } from './log.js';
import type { Session } from './sessions.js';
import type { BridgeHistory, LongHistory } from './timeline.js';
import type { KnowledgeFeed } from '../features/plugins/index.js';

/** Settings the page writes to ExtState, echoed back by the bridge. */
export interface BridgeSettings {
  paused: boolean;
  readonly: boolean;
  openOnStart: boolean;
  /** Developer mode: Rebuild & reload instead of release updates. Absent on bridges older than it */
  dev?: boolean;
  /**
   * Start with REAPER: the startup block `reaper-mcp setup` writes into Scripts/__startup.lua runs the
   * bridge at launch unless this is off. Absent on bridges older than it
   */
  autostart?: boolean;
}

export interface BridgeHealth {
  sws: boolean;
  jsfx: boolean;
  missingJsfx?: string[];
  /** The installed mcp_bridge.lua changed since this copy started (setup ran): restart it */
  outdated: boolean;
  /** REAPER's Scripts/__startup.lua holds the block that starts the bridge. Absent on bridges older than it */
  autostart?: boolean;
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
  /** setup wrote mcp_update.conf for a git clone or an npm install (not on Windows) */
  canUpdate: boolean;
  /** Where releases come from: an npm install updates itself, a clone pulls; absent on bridges before 0.84 (clone) */
  updateSource?: 'npm' | 'clone';
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
export function statusRequestUrl(now: number, extraKeys: string[] = [], logWant?: number, logOlder?: string): string {
  // log_want asks the bridge to publish its saved log; it answers on its next loop, echoing the value
  const ask = logWant === undefined ? '' : `;SET/EXTSTATE/MCPBridge/log_want/${logWant}`;
  const older = logOlder === undefined ? '' : `;SET/EXTSTATE/MCPBridge/log_older/${logOlder}`;
  const extra = extraKeys.map((k) => `;GET/EXTSTATE/MCPBridge/${k}`).join('');
  return `/_/SET/EXTSTATE/MCPBridge/ui_seen/${now}${ask}${older};GET/EXTSTATE/MCPBridge/status;GET/EXTSTATE/MCPBridge/history${extra}`;
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

export function parseHistoryReply(body: string): BridgeHistory | null {
  const parsed = parseExtStateKey(body, 'history') as BridgeHistory | null;
  return parsed && typeof parsed === 'object' && Array.isArray(parsed.b) && parsed.size > 0 ? parsed : null;
}

export function parseLongHistoryReply(body: string): LongHistory | null {
  const parsed = parseExtStateKey(body, 'history_long') as LongHistory | null;
  return parsed && typeof parsed === 'object' && Array.isArray(parsed.tiers) ? parsed : null;
}

export function parseLogReply(body: string): SavedLog | null {
  const parsed = parseExtStateKey(body, 'log') as { req?: unknown; entries?: unknown; older?: unknown } | null;
  return parsed && Array.isArray(parsed.entries)
    ? { req: String(parsed.req ?? ''), entries: parsed.entries as CommandEntry[], older: parsed.older === true }
    : null;
}

export function parseOlderReply(body: string): OlderPage | null {
  const parsed = parseExtStateKey(body, 'log_page') as { req?: unknown; entries?: unknown; more?: unknown } | null;
  return parsed && Array.isArray(parsed.entries)
    ? { req: String(parsed.req ?? ''), entries: parsed.entries as CommandEntry[], more: parsed.more === true }
    : null;
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

export type SettingKey = 'cfg_paused' | 'cfg_readonly' | 'cfg_open_on_start' | 'cfg_dev' | 'cfg_autostart';

/**
 * Write one setting through the web interface. Pause is in-memory (clears when REAPER restarts so
 * a forgotten pause can't silently break agents next session); the others persist.
 */
export function settingUrl(key: SettingKey, on: boolean): string {
  const verb = key === 'cfg_paused' ? 'SET/EXTSTATE' : 'SET/EXTSTATEPERSIST';
  return `/_/${verb}/MCPBridge/${key}/${on ? 1 : 0}`;
}
