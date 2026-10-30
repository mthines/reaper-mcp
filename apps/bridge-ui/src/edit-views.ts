import type { CommandEntry } from './status.js';

/**
 * What an edit changed, or what a listing showed, as the bridge keeps it on the log entry (`r`, built by
 * reaper/mcp_edit_views_lib.lua). Writes carry the state before the edit, so the drawer can draw both.
 * Lists are capped by the bridge; `more` / `total` say how much was left out.
 */

/** One before → after value: `s` is the scale (db, pan −1..1, bool 0/1, norm 0..1 with the plugin's own text) */
export interface ChangeRow { t: string; p: string; s: 'db' | 'pan' | 'bool' | 'norm'; a?: number; b?: number; at?: string; bt?: string }
/** Envelope point: [time s, value in the envelope's unit, shape] */
export type EnvPoint = [number, number, number];
/** MIDI note: [pitch, start beats, length beats, velocity, 1 = new or changed by this call] */
export type Note = [number, number, number, number, number];
/** Per-pitch velocity stats: [pitch, count, min, max, average, longest machine-gun run (0 = none)] */
export type PitchStats = [number, number, number, number, number, number];
/** [start s, end s, name, "#rrggbb" or "", number] */
export type Region = [number, number, string, string, number];
/** [position s, name, "#rrggbb" or "", number] */
export type Marker = [number, string, string, number];
/** [position s, BPM, numerator, denominator (−1 = unchanged), 1 = linear ramp] */
export type Tempo = [number, number, number, number, number];
/** [position s, length s, fade-in s, fade-out s, 1 = MIDI, 1 = muted] */
export type Item = [number, number, number, number, number, number];
/** [name, folder depth, "#rrggbb" or "", volume dB, pan −1..1, flags: M mute, S solo, R armed, F folder] */
export type MixRow = [string, number, string, number, number, string];

export interface TimelineState { regions: Region[]; markers: Marker[]; tempo: Tempo[] }

export type EditView =
  | { kind: 'changes'; rows: ChangeRow[] }
  | { kind: 'envelope'; env: string; unit: 'dB' | 'pan' | 'mute' | 'raw'; from: number; to: number; pts: EnvPoint[]; was?: EnvPoint[]; count: number }
  | { kind: 'midi'; total: number; beats?: number; ts?: [number, number]; notes: Note[]; more: number; gone?: Note[] }
  | { kind: 'midiStats'; total?: number; beats?: number; pitches: PitchStats[]; hist?: number[] }
  | ({ kind: 'timeline'; items?: Item[]; len: number; was?: TimelineState } & TimelineState)
  | { kind: 'mixer'; tracks: MixRow[]; total: number; master?: MixRow }
  | { kind: 'plan'; ops: [string, string][]; total: number; dryRun?: boolean };

const KIND_OF: Record<string, EditView['kind']> = {};
const kinds: Array<[EditView['kind'], string[]]> = [
  ['changes', ['set_track_property', 'set_multiple_track_properties', 'set_fx_parameter', 'set_multiple_fx_parameters']],
  ['envelope', ['insert_envelope_point', 'insert_envelope_points', 'delete_envelope_point', 'remove_envelope_points', 'clear_envelope', 'get_envelope_points']],
  ['midi', ['insert_midi_note', 'insert_midi_notes', 'edit_midi_note', 'edit_midi_notes', 'delete_midi_note', 'get_midi_notes']],
  ['midiStats', ['analyze_midi']],
  ['timeline', [
    'add_marker', 'add_region', 'edit_marker', 'edit_region', 'delete_marker', 'delete_region',
    'add_tempo_marker', 'edit_tempo_marker', 'delete_tempo_marker', 'set_project_tempo',
    'list_markers', 'list_regions', 'get_tempo_map', 'list_media_items',
  ]],
  ['mixer', ['list_tracks']],
  ['plan', ['run_plan']],
];
for (const [kind, commands] of kinds) for (const c of commands) KIND_OF[c] = kind;

/** Every command the drawer draws an edit view for */
export const EDIT_VIEW_COMMANDS = Object.keys(KIND_OF);
/** The view kind a command draws, if any */
export const editKindOf = (command: string): EditView['kind'] | undefined => KIND_OF[command];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
/** The entries of `v` that match `shape` (one guard per position), dropping malformed ones */
function tuples<T>(v: unknown, shape: Array<(x: unknown) => boolean>): T[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t) => Array.isArray(t) && t.length >= shape.length && shape.every((ok, i) => ok(t[i]))) as T[];
}
const ENV_POINT = [num, num, num];
const NOTE = [num, num, num, num];
const REGION = [num, num, str, str];
const MARKER = [num, str, str];
const TEMPO = [num, num, num, num];
const MIX_ROW = [str, num, str, num, num, str];

function timelineState(r: Record<string, unknown>): TimelineState {
  return {
    regions: tuples<Region>(r.regions, REGION),
    markers: tuples<Marker>(r.markers, MARKER),
    tempo: tuples<Tempo>(r.tempo, TEMPO),
  };
}

/** The entry's edit view, or null for other commands, failures, and entries logged before the bridge kept them */
export function editViewOf(e: CommandEntry): EditView | null {
  const kind = KIND_OF[e.c];
  const r = e.r;
  if (!kind || !e.ok || !r) return null;
  switch (kind) {
    case 'changes': {
      if (!Array.isArray(r.rows)) return null;
      const rows = (r.rows as unknown[]).filter(
        (x): x is ChangeRow => !!x && typeof x === 'object' && str((x as ChangeRow).t) && str((x as ChangeRow).p) && ['db', 'pan', 'bool', 'norm'].includes((x as ChangeRow).s),
      );
      return rows.length ? { kind, rows } : null;
    }
    case 'envelope': {
      if (!num(r.from) || !num(r.to) || !Array.isArray(r.pts)) return null;
      const unit = ['dB', 'pan', 'mute'].includes(r.unit as string) ? (r.unit as 'dB' | 'pan' | 'mute') : 'raw';
      return {
        kind, unit, env: str(r.env) ? r.env : 'Envelope', from: r.from, to: r.to,
        pts: tuples<EnvPoint>(r.pts, ENV_POINT),
        ...(Array.isArray(r.was) ? { was: tuples<EnvPoint>(r.was, ENV_POINT) } : {}),
        count: num(r.count) ? r.count : (r.pts as unknown[]).length,
      };
    }
    case 'midi': {
      if (!Array.isArray(r.notes)) return null;
      const notes = tuples<Note>(r.notes, NOTE).map((n) => [n[0], n[1], n[2], n[3], n[4] === 1 ? 1 : 0] as Note);
      const ts = Array.isArray(r.ts) && num(r.ts[0]) && num(r.ts[1]) && r.ts[0] > 0 && r.ts[1] > 0 ? ([r.ts[0], r.ts[1]] as [number, number]) : undefined;
      return {
        kind, notes, ts,
        total: num(r.total) ? r.total : notes.length,
        beats: num(r.beats) && r.beats > 0 ? r.beats : undefined,
        more: num(r.more) ? r.more : 0,
        ...(Array.isArray(r.gone) ? { gone: tuples<Note>(r.gone, NOTE).map((n) => [n[0], n[1], n[2], n[3], 0] as Note) } : {}),
      };
    }
    case 'midiStats': {
      const pitches = tuples<PitchStats>(r.pitches, [num, num, num, num, num]).map((p) => [p[0], p[1], p[2], p[3], p[4], num(p[5]) ? p[5] : 0] as PitchStats);
      if (!pitches.length) return null;
      const hist = Array.isArray(r.hist) && r.hist.every(num) ? (r.hist as number[]) : undefined;
      return { kind, pitches, hist, total: num(r.total) ? r.total : undefined, beats: num(r.beats) ? r.beats : undefined };
    }
    case 'timeline': {
      if (!Array.isArray(r.tempo)) return null;
      const was = r.was && typeof r.was === 'object' ? timelineState(r.was as Record<string, unknown>) : undefined;
      return {
        kind, ...timelineState(r), len: num(r.len) ? r.len : 0,
        ...(Array.isArray(r.items) ? { items: tuples<Item>(r.items, [num, num, num, num, num, num]) } : {}),
        ...(was ? { was } : {}),
      };
    }
    case 'mixer': {
      const tracks = tuples<MixRow>(r.tracks, MIX_ROW);
      const master = tuples<MixRow>([r.master], MIX_ROW)[0];
      if (!tracks.length && !master) return null;
      return { kind, tracks, total: num(r.total) ? r.total : tracks.length, ...(master ? { master } : {}) };
    }
    case 'plan': {
      const ops = tuples<[string, string]>(r.ops, [str, str]);
      if (!ops.length) return null;
      return { kind, ops, total: num(r.total) ? r.total : ops.length, ...(r.dryRun === true ? { dryRun: true } : {}) };
    }
  }
}

/** What changed on the timeline: the marks this call added (or moved/renamed), and the ones it removed */
export function timelineDiff<T extends Region | Marker | Tempo>(now: T[], was: T[] | undefined): { added: Set<T>; removed: T[] } {
  if (!was) return { added: new Set(), removed: [] };
  const key = (t: T) => JSON.stringify(t);
  const before = new Set(was.map(key));
  const after = new Set(now.map(key));
  return { added: new Set(now.filter((t) => !before.has(key(t)))), removed: was.filter((t) => !after.has(key(t))) };
}

/** Envelope points this call added or moved (not in the curve before) */
export function newPoints(pts: EnvPoint[], was: EnvPoint[] | undefined): Set<EnvPoint> {
  if (!was) return new Set();
  const before = new Set(was.map((p) => `${p[0]}:${p[1]}`));
  return new Set(pts.filter((p) => !before.has(`${p[0]}:${p[1]}`)));
}
