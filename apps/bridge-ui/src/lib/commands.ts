import { type LatencyStats, latencyStats } from './log.js';

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
  | { kind: 'aesthetics'; name?: string; pq?: number; pc?: number; ce?: number; cu?: number; lufs?: number; dur?: number }
  /** Detected key: 12-bin chroma (C first, largest 1), the key, its correlation, confidence 0..1, relative key and
   *  the next candidates [key, r]; src is midi (notes), audio (rendered track) or file */
  | {
      kind: 'key'; name?: string; src?: string; key?: string; tonic?: string; mode?: string; rel?: string; r?: number; conf?: number;
      chroma: number[]; alt: [string, number][];
    }
  /** Detected chords: spans [start, end, chord, roman numeral ('' = none)] over the range, the key, one per bar or beat
   *  (per), how many spans past the first 64 were left out (more); src as for key */
  | { kind: 'chords'; name?: string; src?: string; key?: string; per?: string; start?: number; end?: number; more?: number; ch: [number, number, string, string][] }
  /** Loudness over time (sidecar): the short-term (or momentary, `term: 'm'`) curve from `start` every `step` s, and
   *  spans [start, end, LUFS] of the loudest / quietest window and of every stretch over `target` */
  | {
      kind: 'curve'; name?: string; lufs?: number; tp?: number; lra?: number; plr?: number; maxM?: number; target?: number;
      /** Seconds the short-term loudness spent over the target, as the tool counts them */
      overS?: number;
      start: number; step?: number; term?: string; curve: number[];
      loud: [number, number, number | null] | null; quiet: [number, number, number | null] | null; over: [number, number, number | null][];
    }
  /** Stereo correlation per band (sidecar): [band, correlation, worst, out-of-phase share, side-to-mid dB], and flags */
  | { kind: 'stereo'; name?: string; dur?: number; bands: [string, number | null, number | null, number | null, number | null][]; flags: string[] }
  /** Masking between tracks (sidecar): band centres, the most masked pairs [a, b, overall, score per band], conflicts
   *  [a, b, Hz, score, suggestion] */
  | { kind: 'masking'; tracks: string[]; hz: number[]; pairs: [string, string, number, number[]][]; conflicts: [string, string, number | null, number | null, string][] }
  /** Stem separation (sidecar, Demucs): each stem [name, LUFS, peak dBFS], speed, and the tracks it inserted */
  | { kind: 'stems'; name?: string; model?: string; device?: string; secs?: number; proc?: number; inserted?: number; folder?: string; muted?: number; stems: [string, number | null, number | null][] };

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
  detect_key: { kind: 'key', fields: ['r', 'conf'] },
  detect_chords: { kind: 'chords', fields: ['start', 'end', 'more'] },
  analyze_loudness_curve: { kind: 'curve', fields: ['lufs', 'tp', 'lra', 'plr', 'maxM', 'target', 'overS', 'start', 'step'] },
  analyze_stereo_bands: { kind: 'stereo', fields: ['dur'] },
  measure_masking: { kind: 'masking', fields: [] },
  separate_stems: { kind: 'stems', fields: ['secs', 'proc', 'inserted', 'muted'] },
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
  if (spec.kind === 'offline' || spec.kind === 'alignment' || spec.kind === 'aesthetics' || spec.kind === 'curve' || spec.kind === 'stereo' || spec.kind === 'stems') {
    for (const f of ['name', 'ref', 'term', 'model', 'device', 'folder']) if (typeof e.r[f] === 'string') out[f] = e.r[f];
  }
  const r = e.r;
  const numOrNull = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is unknown[] => Array.isArray(x)) : []);
  const span = (v: unknown): [number, number, number | null] | null =>
    Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1], numOrNull(v[2])] : null;
  if (spec.kind === 'curve') {
    if (!isNumbers(r.curve)) return null;
    out.curve = r.curve;
    out.start = typeof r.start === 'number' ? r.start : 0;
    out.loud = span(r.loud);
    out.quiet = span(r.quiet);
    out.over = rows(r.over).map(span).filter((x) => x !== null);
  }
  if (spec.kind === 'stereo') {
    const bands = rows(r.bands).filter((b) => typeof b[0] === 'string').map((b) => [b[0], ...b.slice(1, 5).map(numOrNull)]);
    if (bands.length === 0) return null;
    out.bands = bands;
    out.flags = Array.isArray(r.flags) ? r.flags.filter((f) => typeof f === 'string') : [];
  }
  if (spec.kind === 'masking') {
    if (!isNumbers(r.hz) || !Array.isArray(r.tracks)) return null;
    out.tracks = r.tracks.map(String);
    out.hz = r.hz;
    out.pairs = rows(r.pairs).filter((p) => Array.isArray(p[3])).map((p) => [String(p[0]), String(p[1]), numOrNull(p[2]) ?? 0, (p[3] as unknown[]).map((x) => numOrNull(x) ?? 0)]);
    out.conflicts = rows(r.conflicts).map((c) => [String(c[0]), String(c[1]), numOrNull(c[2]), numOrNull(c[3]), typeof c[4] === 'string' ? c[4] : '']);
  }
  if (spec.kind === 'stems') {
    out.stems = rows(r.stems).filter((x) => typeof x[0] === 'string').map((x) => [x[0], numOrNull(x[1]), numOrNull(x[2])]);
    if ((out.stems as unknown[]).length === 0) return null;
  }
  if (spec.kind === 'offline') {
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
  if (spec.kind === 'key') {
    const { chroma, alt } = e.r;
    if (!Array.isArray(chroma) || chroma.length !== 12 || !chroma.every((x) => typeof x === 'number')) return null;
    for (const f of ['name', 'src', 'key', 'tonic', 'mode', 'rel']) if (typeof e.r[f] === 'string') out[f] = e.r[f];
    if (typeof out.key !== 'string') return null;
    out.chroma = chroma;
    out.alt = Array.isArray(alt) ? alt.filter((a): a is [string, number] => Array.isArray(a) && typeof a[0] === 'string' && typeof a[1] === 'number') : [];
  }
  if (spec.kind === 'chords') {
    for (const f of ['name', 'src', 'key', 'per']) if (typeof r[f] === 'string') out[f] = r[f];
    out.ch = rows(r.ch)
      .filter((c) => typeof c[0] === 'number' && typeof c[1] === 'number' && typeof c[2] === 'string')
      .map((c) => [c[0], c[1], c[2], typeof c[3] === 'string' ? c[3] : '']);
    if ((out.ch as unknown[]).length === 0) return null;
  }
  if (spec.kind === 'waveform') {
    const { hi, lo } = e.r;
    if (!isNumbers(hi) || !isNumbers(lo) || hi.length !== lo.length) return null;
    out.hi = hi;
    out.lo = lo;
  }
  return out as Measurement;
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
  'freeze_tracks',
  'unfreeze_tracks',
  'apply_fx_to_items',
  'quantize_audio',
  'analyze_track_offline',
  'analyze_audio_file',
  'measure_track_alignment',
  'detect_transients',
  'create_transient_automation',
  'process_items',
  'analyze_track_aesthetics',
  'detect_key',
  'detect_chords',
  'analyze_loudness_curve',
  'analyze_stereo_bands',
  'measure_masking',
  'separate_stems',
  'insert_stem_tracks',
  'import_midi_file',
  'render_project',
  'render_track_to_wav',
  'render_versions',
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
  'snapshot_edit',
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
