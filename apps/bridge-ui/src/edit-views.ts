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
/** Automation item: [position s, length s, pool id, pool name] */
export type AutoItem = [number, number, number, string];
/** One pool's points, times from the item start: [pool id, points] */
export type Pool = [number, EnvPoint[]];
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
/** [position s, length s, fade-in s, fade-out s, 1 = MIDI, 1 = muted, item gain dB (normalize only)] */
export type Item = [number, number, number, number, number, number, number?];
/** What an arrangement edit did: copied items or a section, opened or cut time, or processed items */
export type ArrangeOp = 'copy' | 'section' | 'insert' | 'remove' | 'normalize' | 'reverse' | 'glue';
const ARRANGE_OPS: readonly string[] = ['copy', 'section', 'insert', 'remove', 'normalize', 'reverse', 'glue'];
/** [name, folder depth, "#rrggbb" or "", volume dB, pan −1..1, flags: M mute, S solo, R armed, F folder] */
export type MixRow = [string, number, string, number, number, string];

export interface TimelineState { regions: Region[]; markers: Marker[]; tempo: Tempo[] }
/** One FX slot: [name, flags: B bypassed, O offline, short id, preset ("" = none)] */
export type FxSlot = [string, string, string, string];
/** One track's FX chain; `was` is the chain before a write */
export interface FxChain { t: string; fx: FxSlot[]; was?: FxSlot[] }
/** A route: [kind s send / r receive / h hardware out, the other end, volume dB, pan −1..1, flags: M muted] */
export type Route = ['s' | 'r' | 'h', string, number, number, string];
/** One track's items for an item edit; `was` is the lane before it */
export interface ItemLane { t: string; items: Item[]; was?: Item[] }

/**
 * One modulated FX parameter: name, baseline and value 0..1, and its sources —
 * lfo [shape, speed, strength, phase, direction −1/0/1, 1 = tempo sync],
 * acs (audio control signal) [attack ms, release ms, min dB, max dB, strength, channel, direction],
 * link [source "FX / param", scale, offset]. `off` = modulation turned off; `was` = before a write (false = none).
 */
export interface ModRow {
  p: string; base: number; v: number; off?: number;
  lfo?: [string, number, number, number, number, number];
  acs?: [number, number, number, number, number, number, number];
  link?: [string, number, number];
  was?: ModRow | false;
}
/** A rendered file: [name, duration s (−1 unknown), LUFS-I, true peak, sample peak (−150 unmeasured or silent), waveform maxima, minima] */
export type RenderFile = [string, number, number, number, number, number[], number[]];
/** One version of a render (`v` "" for a plain render), the tracks it muted and its files */
export interface RenderGroup { v: string; m: string[]; f: RenderFile[] }

export type EditView =
  | { kind: 'changes'; rows: ChangeRow[]; more?: number }
  | {
      kind: 'envelope'; env: string; unit: 'dB' | 'pan' | 'mute' | 'cc' | 'raw'; from: number; to: number; pts: EnvPoint[]; was?: EnvPoint[]; count: number;
      /** MIDI CC lanes: times are beats from the item start, and how many other controllers the item has */
      beats?: boolean; otherCcs?: number;
      /** Automation items on the envelope, each pool's points once, the item this call touched, and both before a write */
      ais?: AutoItem[]; pools?: Pool[]; ai?: number; aisMore?: number; wasAis?: AutoItem[]; wasPools?: Pool[];
    }
  | { kind: 'midi'; total: number; beats?: number; ts?: [number, number]; notes: Note[]; more: number; gone?: Note[]; items?: number }
  | { kind: 'midiStats'; total?: number; beats?: number; pitches: PitchStats[]; hist?: number[] }
  | ({
      kind: 'timeline'; items?: Item[]; len: number; was?: TimelineState;
      /** Item edits: one lane per touched track */
      lanes?: ItemLane[];
      /** Time selection [start, end] and edit cursor, now and before a write */
      sel?: [number, number]; cur?: number; wasSel?: [number, number] | null; wasCur?: number;
      /** Arrangement edits: the op, the span it copied from / opened / cut, where it copied to, and tracks without a lane */
      op?: ArrangeOp; span?: [number, number]; to?: [number, number]; moreTracks?: number;
    } & TimelineState)
  | { kind: 'mixer'; tracks: MixRow[]; total: number; from?: number; master?: MixRow; ids?: string[]; was?: { tracks: MixRow[]; ids: string[] } }
  | { kind: 'fxChain'; chains: FxChain[] }
  | { kind: 'routing'; t: string; routes: Route[]; was?: Route[] }
  | { kind: 'plan'; ops: [string, string][]; total: number; dryRun?: boolean }
  | { kind: 'modulation'; fx: string; rows: ModRow[]; total?: number }
  /** FX pins: the track channels (1-based) each input / output pin connects to, now and before a write */
  | { kind: 'pins'; fx: string; ch: number; in: number[][]; out: number[][]; names?: string[]; chWas?: number; inWas?: number[][]; outWas?: number[][] }
  /**
   * Stretch markers on an item, seconds from its start: quantize moves [from, to] over the grid lines with the
   * average offset from the grid before/after (ms); a batch add shows the markers now and before
   */
  | { kind: 'stretch'; len: number; moves?: [number, number][]; more?: number; grid?: number[]; off?: [number, number]; marks?: number[]; was?: number[] }
  | {
      kind: 'render'; fmt: string; src: string; groups: RenderGroup[]; more?: number;
      /** Bit depth or MP3 kbps, the normalize mode and target (dB), and the limiter ceiling (dB, `tp` true peak) */
      bd?: string; kbps?: number; norm?: string; nt?: number; lim?: number; tp?: boolean;
    };

const KIND_OF: Record<string, EditView['kind']> = {};
const kinds: Array<[EditView['kind'], string[]]> = [
  ['changes', [
    'set_track_property', 'set_multiple_track_properties', 'set_fx_parameter', 'set_multiple_fx_parameters', 'get_fx_parameters',
    'set_automation_mode', 'freeze_tracks', 'unfreeze_tracks', 'apply_fx_to_items',
  ]],
  ['envelope', [
    'insert_envelope_point', 'insert_envelope_points', 'edit_envelope_points', 'delete_envelope_point', 'remove_envelope_points', 'clear_envelope', 'get_envelope_points',
    'list_automation_items', 'insert_automation_item', 'set_automation_item', 'delete_automation_item',
    'get_midi_cc', 'insert_midi_cc', 'delete_midi_cc',
  ]],
  ['midi', ['insert_midi_note', 'insert_midi_notes', 'edit_midi_note', 'edit_midi_notes', 'delete_midi_note', 'get_midi_notes', 'quantize_midi', 'transform_midi', 'import_midi_file']],
  ['midiStats', ['analyze_midi']],
  ['timeline', [
    'add_marker', 'add_region', 'edit_marker', 'edit_region', 'delete_marker', 'delete_region',
    'add_tempo_marker', 'edit_tempo_marker', 'delete_tempo_marker', 'set_project_tempo',
    'list_markers', 'list_regions', 'get_tempo_map', 'list_media_items',
    'move_media_item', 'split_media_item', 'trim_media_item', 'delete_media_item', 'set_media_item_properties',
    'set_media_items_properties', 'set_item_fades', 'insert_audio_file', 'list_midi_items',
    'set_time_selection', 'get_time_selection', 'set_cursor_position',
    'copy_media_items', 'insert_time', 'remove_time', 'copy_section', 'process_items',
  ]],
  ['mixer', ['list_tracks', 'add_track', 'delete_track', 'move_track', 'set_track_folder', 'set_track_info']],
  ['fxChain', [
    'add_fx', 'remove_fx', 'move_fx', 'copy_fx', 'set_fx_enabled', 'set_fx_offline', 'setup_fx_chain', 'load_fx_chain',
    'rename_fx', 'set_fx_preset', 'get_track_properties',
    'list_monitoring_fx', 'add_monitoring_fx', 'set_monitoring_fx', 'remove_monitoring_fx',
  ]],
  ['routing', ['get_track_routing', 'add_send', 'set_send', 'remove_send', 'add_hardware_output']],
  ['plan', ['run_plan']],
  ['modulation', ['get_fx_param_modulation', 'set_fx_param_modulation']],
  ['pins', ['get_fx_pins', 'set_fx_pins']],
  ['stretch', ['add_stretch_markers', 'quantize_audio']],
  ['render', ['render_project', 'render_versions']],
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
const AUTO_ITEM = [num, num, num, str];
function pools(v: unknown): Pool[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p): Pool[] => (Array.isArray(p) && num(p[0]) ? [[p[0], tuples<EnvPoint>(p[1], ENV_POINT)]] : []));
}
const NOTE = [num, num, num, num];
const REGION = [num, num, str, str];
const MARKER = [num, str, str];
const TEMPO = [num, num, num, num];
const MIX_ROW = [str, num, str, num, num, str];
const ITEM = [num, num, num, num, num, num];
const FX_SLOT = [str, str, str, str];
const ROUTE = [(v: unknown) => v === 's' || v === 'r' || v === 'h', str, num, num, str];
const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every(num);
const RENDER_FILE = [str, num, num, num, num, numbers, numbers];
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);
const nums = (v: unknown): v is number[] => Array.isArray(v) && v.every(num);
const channelLists = (v: unknown): number[][] => (Array.isArray(v) ? v.map((p) => (nums(p) ? p : [])) : []);
function modRow(v: unknown, depth = 0): ModRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!str(r.p)) return null;
  const row: ModRow = { p: r.p, base: num(r.base) ? r.base : 0, v: num(r.v) ? r.v : 0 };
  if (r.off === 1) row.off = 1;
  if (Array.isArray(r.lfo) && str(r.lfo[0]) && r.lfo.slice(1, 6).every(num)) row.lfo = r.lfo.slice(0, 6) as ModRow['lfo'];
  if (Array.isArray(r.acs) && r.acs.length >= 7 && r.acs.every(num)) row.acs = r.acs.slice(0, 7) as ModRow['acs'];
  if (Array.isArray(r.link) && str(r.link[0]) && num(r.link[1]) && num(r.link[2])) row.link = [r.link[0], r.link[1], r.link[2]];
  if (depth === 0 && r.was !== undefined) row.was = r.was === false ? false : (modRow(r.was, 1) ?? false);
  return row;
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);

/** Items, keeping a gain only when it is a number */
function items(v: unknown): Item[] {
  return tuples<Item>(v, ITEM).map((it) => (num(it[6]) ? [...it.slice(0, 6), it[6]] : it.slice(0, 6)) as Item);
}

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
      return rows.length ? { kind, rows, ...(num(r.more) && r.more > 0 ? { more: r.more } : {}) } : null;
    }
    case 'envelope': {
      if (!num(r.from) || !num(r.to) || !Array.isArray(r.pts)) return null;
      const unit = ['dB', 'pan', 'mute', 'cc'].includes(r.unit as string) ? (r.unit as 'dB' | 'pan' | 'mute' | 'cc') : 'raw';
      return {
        kind, unit, env: str(r.env) ? r.env : 'Envelope', from: r.from, to: r.to,
        pts: tuples<EnvPoint>(r.pts, ENV_POINT),
        ...(Array.isArray(r.was) ? { was: tuples<EnvPoint>(r.was, ENV_POINT) } : {}),
        count: num(r.count) ? r.count : (r.pts as unknown[]).length,
        ...(r.beats === 1 || r.beats === true ? { beats: true } : {}),
        ...(num(r.otherCcs) && r.otherCcs > 0 ? { otherCcs: r.otherCcs } : {}),
        ...(Array.isArray(r.ais) ? { ais: tuples<AutoItem>(r.ais, AUTO_ITEM), pools: pools(r.pools) } : {}),
        ...(num(r.ai) ? { ai: r.ai } : {}),
        ...(num(r.aisMore) && r.aisMore > 0 ? { aisMore: r.aisMore } : {}),
        ...(Array.isArray(r.wasAis) ? { wasAis: tuples<AutoItem>(r.wasAis, AUTO_ITEM), wasPools: pools(r.wasPools) } : {}),
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
        ...(num(r.items) && r.items > 0 ? { items: r.items } : {}),
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
      const lanes = Array.isArray(r.lanes)
        ? (r.lanes as unknown[]).flatMap((l): ItemLane[] => {
            if (!l || typeof l !== 'object' || !str((l as ItemLane).t)) return [];
            const lane = l as Record<string, unknown>;
            return [{ t: lane.t as string, items: items(lane.items), ...(Array.isArray(lane.was) ? { was: items(lane.was) } : {}) }];
          })
        : undefined;
      return {
        kind, ...timelineState(r), len: num(r.len) ? r.len : 0,
        ...(Array.isArray(r.items) ? { items: tuples<Item>(r.items, ITEM) } : {}),
        ...(was ? { was } : {}),
        ...(lanes ? { lanes } : {}),
        ...(pair(r.sel) ? { sel: r.sel } : {}),
        ...(num(r.cur) ? { cur: r.cur } : {}),
        // A write that started from no selection says so with null
        ...(pair(r.wasSel) ? { wasSel: r.wasSel } : num(r.wasCur) ? { wasSel: null } : {}),
        ...(num(r.wasCur) ? { wasCur: r.wasCur } : {}),
        ...(str(r.op) && ARRANGE_OPS.includes(r.op) ? { op: r.op as ArrangeOp } : {}),
        ...(pair(r.span) ? { span: r.span } : {}),
        ...(pair(r.to) ? { to: r.to } : {}),
        ...(num(r.moreTracks) && r.moreTracks > 0 ? { moreTracks: r.moreTracks } : {}),
      };
    }
    case 'mixer': {
      const tracks = tuples<MixRow>(r.tracks, MIX_ROW);
      const master = tuples<MixRow>([r.master], MIX_ROW)[0];
      if (!tracks.length && !master) return null;
      const w = r.was && typeof r.was === 'object' ? (r.was as Record<string, unknown>) : undefined;
      const diffable = strings(r.ids) && r.ids.length === tracks.length && w && strings(w.ids);
      return {
        kind, tracks, total: num(r.total) ? r.total : tracks.length, ...(master ? { master } : {}),
        ...(num(r.from) && r.from > 0 ? { from: r.from } : {}),
        ...(diffable ? { ids: r.ids as string[], was: { tracks: tuples<MixRow>(w.tracks, MIX_ROW), ids: w.ids as string[] } } : {}),
      };
    }
    case 'fxChain': {
      if (!Array.isArray(r.chains)) return null;
      const chains = (r.chains as unknown[]).flatMap((c): FxChain[] => {
        if (!c || typeof c !== 'object' || !str((c as FxChain).t)) return [];
        const ch = c as Record<string, unknown>;
        return [{ t: ch.t as string, fx: tuples<FxSlot>(ch.fx, FX_SLOT), ...(Array.isArray(ch.was) ? { was: tuples<FxSlot>(ch.was, FX_SLOT) } : {}) }];
      });
      return chains.length ? { kind, chains } : null;
    }
    case 'routing': {
      if (!str(r.t) || !Array.isArray(r.routes)) return null;
      return { kind, t: r.t, routes: tuples<Route>(r.routes, ROUTE), ...(Array.isArray(r.was) ? { was: tuples<Route>(r.was, ROUTE) } : {}) };
    }
    case 'render': {
      if (!Array.isArray(r.groups)) return null;
      const groups = (r.groups as unknown[]).flatMap((g): RenderGroup[] => {
        if (!g || typeof g !== 'object') return [];
        const x = g as Record<string, unknown>;
        return [{ v: str(x.v) ? x.v : '', m: strings(x.m) ? x.m : [], f: tuples<RenderFile>(x.f, RENDER_FILE) }];
      });
      if (!groups.some((g) => g.f.length)) return null;
      return {
        kind, fmt: str(r.fmt) ? r.fmt : '', src: str(r.src) ? r.src : 'master', groups,
        ...(num(r.more) && r.more > 0 ? { more: r.more } : {}),
        ...(str(r.bd) ? { bd: r.bd } : {}), ...(num(r.kbps) ? { kbps: r.kbps } : {}),
        ...(str(r.norm) ? { norm: r.norm, ...(num(r.nt) ? { nt: r.nt } : {}) } : {}),
        ...(num(r.lim) ? { lim: r.lim, tp: r.tp === true } : {}),
      };
    }
    case 'plan': {
      const ops = tuples<[string, string]>(r.ops, [str, str]);
      if (!ops.length) return null;
      return { kind, ops, total: num(r.total) ? r.total : ops.length, ...(r.dryRun === true ? { dryRun: true } : {}) };
    }
    case 'modulation': {
      const rows = Array.isArray(r.rows) ? (r.rows as unknown[]).map((x) => modRow(x)).filter((x): x is ModRow => !!x) : [];
      return { kind, fx: str(r.fx) ? r.fx : '', rows, ...(num(r.total) ? { total: r.total } : {}) };
    }
    case 'pins': {
      if (!num(r.ch) || !Array.isArray(r.in)) return null;
      return {
        kind, fx: str(r.fx) ? r.fx : '', ch: r.ch, in: channelLists(r.in), out: channelLists(r.out),
        ...(strings(r.names) ? { names: r.names } : {}),
        ...(num(r.chWas) ? { chWas: r.chWas } : {}),
        ...(Array.isArray(r.inWas) ? { inWas: channelLists(r.inWas), outWas: channelLists(r.outWas) } : {}),
      };
    }
    case 'stretch': {
      if (!num(r.len) || r.len <= 0) return null;
      return {
        kind, len: r.len,
        ...(Array.isArray(r.moves) ? { moves: (r.moves as unknown[]).filter(pair) } : {}),
        ...(num(r.more) && r.more > 0 ? { more: r.more } : {}),
        ...(nums(r.grid) ? { grid: r.grid } : {}),
        ...(pair(r.off) ? { off: r.off } : {}),
        ...(nums(r.marks) ? { marks: r.marks } : {}),
        ...(nums(r.was) ? { was: r.was } : {}),
      };
    }
  }
}

/**
 * Gains a normalize changed, as [after, before] dB: normalize never moves an item, so its
 * before is the one at the same position and length; items whose gain stayed are left out.
 */
export function normalizedGains(lanes: ItemLane[]): Array<[number, number]> {
  return lanes.flatMap((l) =>
    l.items.flatMap((it): Array<[number, number]> => {
      const was = (l.was ?? []).find((w) => w[0] === it[0] && w[1] === it[1]);
      return it[6] !== undefined && was?.[6] !== undefined && was[6] !== it[6] ? [[it[6], was[6]]] : [];
    }),
  );
}

/** What changed on the timeline: the marks (or items) this call added, moved or renamed, and the ones it removed */
export function timelineDiff<T extends Region | Marker | Tempo | Item>(now: T[], was: T[] | undefined): { added: Set<T>; removed: T[] } {
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

/** Width of a marker label in px: 10.5px mono is ~6.4px a character, capped like the CSS (`max-width: 80px`) */
export const markerLabelWidth = (text: string) => Math.min(80, text.length * 6.4) + 6;

/**
 * Which marker labels fit on a lane `width` px wide without overlapping, as indexes into `marks`
 * (`[x 0..1, label]`). Labels go left to right; one that would run into the label before it is
 * left out (its line stays, the name shows on hover). `first` indexes (e.g. what this call changed)
 * are placed before the rest, so they keep their label.
 */
export function fittingLabels(marks: Array<[number, string]>, width: number, first: Set<number> = new Set()): Set<number> {
  const placed: Array<[number, number]> = [];
  const shown = new Set<number>();
  const order = marks.map((_, i) => i).sort((a, b) => Number(first.has(b)) - Number(first.has(a)) || marks[a][0] - marks[b][0]);
  for (const i of order) {
    const left = marks[i][0] * width;
    const right = Math.min(width, left + markerLabelWidth(marks[i][1]));
    if (placed.some(([l, r]) => left < r && right > l)) continue;
    placed.push([left, right]);
    shown.add(i);
  }
  return shown;
}

export type SlotChange = 'new' | 'moved' | 'changed';

/**
 * Before → after for lists whose entries keep an identity (FX by GUID, tracks by GUID, routes by their ends):
 * what each entry now is to the call (new, moved relative to the others, or changed in place) and what it removed.
 */
export function listDiff<T>(now: T[], was: T[] | undefined, id: (t: T, i: number) => string, same: (a: T, b: T) => boolean): { change: Map<number, SlotChange>; removed: Array<[number, T]> } {
  const change = new Map<number, SlotChange>();
  if (!was) return { change, removed: [] };
  const nowIds = now.map(id);
  const wasIds = was.map(id);
  const before = new Map(wasIds.map((k, i) => [k, i]));
  const kept = new Set(nowIds.filter((k) => before.has(k)));
  // Order of the entries in both lists, before and after: one whose neighbours changed moved
  const keptNow = nowIds.filter((k) => kept.has(k));
  const keptWas = wasIds.filter((k) => kept.has(k));
  const lis = longestKeptRun(keptWas.map((k) => keptNow.indexOf(k)));
  nowIds.forEach((k, i) => {
    const b = before.get(k);
    if (b === undefined) change.set(i, 'new');
    else if (!lis.has(keptNow.indexOf(k))) change.set(i, 'moved');
    else if (!same(now[i], was[b])) change.set(i, 'changed');
  });
  return { change, removed: was.flatMap((t, i): Array<[number, T]> => (kept.has(wasIds[i]) ? [] : [[i, t]])) };
}

/** The values of the longest increasing run in `seq`: the entries that stayed in order (the rest moved) */
function longestKeptRun(seq: number[]): Set<number> {
  const best: number[][] = [];
  for (const v of seq) {
    let run: number[] = [];
    for (const r of best) if (r[r.length - 1] < v && r.length > run.length) run = r;
    best.push([...run, v]);
  }
  return new Set(best.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]));
}

/** A route's identity: its kind and other end, counted when a track sends twice to the same place */
export function routeIds(routes: Route[]): string[] {
  const seen = new Map<string, number>();
  return routes.map((r) => {
    const k = `${r[0]}:${r[1]}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}#${n}`;
  });
}
