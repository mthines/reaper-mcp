import { parseExtStateKey } from '../../lib/status.js';

/**
 * Snapshots view: the bridge's mixer snapshots, restored and saved from the page.
 * Bridge side: reaper/mcp_snapshots_ui_lib.lua (ExtState snap_seen, snap_req, snapshots) — change both together.
 */

/** One saved snapshot, as listed by the bridge */
export interface SnapshotInfo {
  name: string;
  description: string;
  /** Epoch ms when it was saved */
  timestamp: number;
  /** Tracks captured (missing for a file the bridge couldn't count) */
  trackCount?: number;
  /** Only some tracks were captured (snapshot_save with trackIndices) */
  scoped: boolean;
  /** Exact track state chunks (every plugin's internal state) instead of parameter values */
  fullChunk: boolean;
}

export type SnapshotOp = 'restore' | 'save' | 'delete' | 'edit';

/** A row of the Snapshots view being renamed, or asked to confirm its delete */
export type RowMode = { name: string; mode: 'edit' | 'delete' };

/** The bridge's answer to the page's latest request */
export interface SnapshotResult {
  id: string;
  op: SnapshotOp;
  name: string;
  ok: boolean;
  error?: string;
  warnings?: string[];
  tracksRestored?: number;
}

/** Shape published to ExtState MCPBridge/snapshots */
export interface SnapshotsFeed {
  v: number;
  /** Next to the saved project, or the global bridge folder for an unsaved project */
  storage: 'project' | 'global';
  /** Last restored snapshot (also what the next/prev snapshot actions continue from) */
  current?: string;
  snapshots: SnapshotInfo[];
  result?: SnapshotResult;
}

/** The longest name and description the bridge keeps (bytes, UTF-8) */
export const NAME_MAX = 128;
export const DESCRIPTION_MAX = 500;

/** While the view is open: tell the bridge to watch the folder, and read its list */
export function snapshotsPollUrl(now: number): string {
  return `/_/SET/EXTSTATE/MCPBridge/snap_seen/${now};GET/EXTSTATE/MCPBridge/snapshots`;
}

function hex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cut to at most `max` UTF-8 bytes without splitting a character */
function clip(text: string, max: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    bytes += new TextEncoder().encode(ch).length;
    if (bytes > max) break;
    out += ch;
  }
  return out;
}

/**
 * Restore, save, delete or edit one snapshot. `token` is the bridge's per-run control token
 * (status.control.token); the fields travel hex-encoded, so no character needs URL or `;` escaping.
 * An edit sends the name, the new name and the description (empty clears it).
 */
export function snapshotRequestUrl(op: SnapshotOp, id: string, token: string, name: string, description = '', newName = ''): string {
  const desc = op === 'save' || op === 'edit' ? clip(description.trim(), DESCRIPTION_MAX) : '';
  const fields = [clip(name.trim(), NAME_MAX)];
  if (op === 'edit') fields.push(clip(newName.trim(), NAME_MAX), desc);
  else if (desc) fields.push(desc);
  return `/_/SET/EXTSTATE/MCPBridge/snap_req/${id}-${token}-${op}-${fields.map(hex).join('-')}`;
}

/** Why a name can't be saved, or null */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the snapshot a name';
  if (new TextEncoder().encode(n).length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters`;
  return null;
}

/**
 * The file a name is saved to on the bridge (snapshot_path() in mcp_bridge.lua): characters other than
 * letters, digits, `-_.` and spaces become `_`, and runs of spaces one `_`. Two names with the same file
 * replace each other, so the page asks first.
 */
export function snapshotFile(name: string): string {
  // Lua works on bytes: each byte of a non-ASCII character becomes its own `_`
  const bytes = Array.from(new TextEncoder().encode(name.trim()), (b) => {
    const c = String.fromCharCode(b);
    return b < 128 && /[A-Za-z0-9\-_.\s]/.test(c) ? c : '_';
  });
  return bytes.join('').replace(/\s+/g, '_');
}

/**
 * The name a save without one gets: the local date and time, as the quick-save action names its snapshots
 * (time_name() in mcp_snapshot_lib.lua), with " 2", " 3"… when a snapshot already saves to that file.
 */
export function timeSnapshotName(snapshots: SnapshotInfo[], date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  let name = base;
  for (let n = 2; replacedBy(snapshots, name); n++) name = `${base} ${n}`;
  return name;
}

/** The saved snapshot a new name would replace, if any */
export function replacedBy(snapshots: SnapshotInfo[], name: string): SnapshotInfo | null {
  const file = snapshotFile(name);
  return snapshots.find((s) => snapshotFile(s.name) === file) ?? null;
}

function isSnapshot(x: unknown): x is SnapshotInfo {
  const s = x as SnapshotInfo;
  return typeof x === 'object' && x !== null && typeof s.name === 'string' && typeof s.timestamp === 'number';
}

function asResult(x: unknown): SnapshotResult | undefined {
  const r = x as SnapshotResult;
  if (typeof x !== 'object' || x === null || typeof r.id !== 'string' || (r.op !== 'restore' && r.op !== 'save')) return undefined;
  return {
    ...r,
    ok: r.ok === true,
    // An empty Lua table arrives as `[]` or `{}`
    warnings: Array.isArray(r.warnings) && r.warnings.length > 0 ? r.warnings.filter((w) => typeof w === 'string') : undefined,
  };
}

/** Parse the bridge's reply to snapshotsPollUrl(); null when it hasn't published a list yet */
export function parseSnapshotsReply(body: string): SnapshotsFeed | null {
  const raw = parseExtStateKey(body, 'snapshots') as Partial<SnapshotsFeed> | null;
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const list = Array.isArray(raw.snapshots) ? raw.snapshots.filter(isSnapshot) : [];
  return {
    v: 1,
    storage: raw.storage === 'global' ? 'global' : 'project',
    current: typeof raw.current === 'string' ? raw.current : undefined,
    snapshots: list.map((s) => ({
      name: s.name,
      description: typeof s.description === 'string' ? s.description : '',
      timestamp: s.timestamp,
      trackCount: typeof s.trackCount === 'number' ? s.trackCount : undefined,
      scoped: s.scoped === true,
      fullChunk: s.fullChunk === true,
    })),
    result: asResult(raw.result),
  };
}

/** What the page shows for a request it sent: still waiting, or the bridge's answer */
export type RequestState = { id: string; op: SnapshotOp; name: string; at: number } & (
  | { state: 'pending' }
  | { state: 'done'; result: SnapshotResult }
  | { state: 'lost' }
);

/** No answer after this long: the bridge didn't take the request (stopped, or an older bridge) */
export const REQUEST_TIMEOUT_MS = 8_000;

/** Fold the latest feed into the request the page is waiting on */
export function settle(req: RequestState | null, feed: SnapshotsFeed | null, now: number): RequestState | null {
  if (!req || req.state !== 'pending') return req;
  if (feed?.result?.id === req.id) return { ...req, state: 'done', result: feed.result };
  if (now - req.at > REQUEST_TIMEOUT_MS) return { ...req, state: 'lost' };
  return req;
}

/** Example snapshots for `?demo` and the stories */
export function demoSnapshots(now: number): SnapshotsFeed {
  const min = 60_000;
  return {
    v: 1,
    storage: 'project',
    current: 'mix-B',
    snapshots: [
      { name: 'mix-C', description: 'Vocal up 1 dB, darker reverb', timestamp: now - 4 * min, trackCount: 24, scoped: false, fullChunk: false },
      { name: 'mix-B', description: 'Wider chorus guitars, Helix on snapshot 3', timestamp: now - 18 * min, trackCount: 3, scoped: true, fullChunk: true },
      { name: 'mix-A', description: '', timestamp: now - 62 * min, trackCount: 24, scoped: false, fullChunk: false },
      { name: 'before-bus-comp', description: 'Pre mix-bus compression', timestamp: now - 26 * 60 * min, trackCount: 22, scoped: false, fullChunk: false },
    ],
  };
}

/** Restore and save change the project: the bridge refuses them while read-only or paused */
export function blockedBy(settings: { readonly?: boolean; paused?: boolean } | null): string | null {
  if (settings?.paused) return 'Paused: resume the bridge to restore or save snapshots';
  if (settings?.readonly) return 'Read-only: turn it off in Settings to restore or save snapshots';
  return null;
}
