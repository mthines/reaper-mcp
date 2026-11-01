import type { LoggedCommand } from '@reaper-mcp/protocol';
import { measurementOf, outcomeOf, type CommandEntry, type Measurement } from '../../lib/commands.js';
import { editViewOf, type EditViewData } from '../edit-views/index.js';
import { fmt, zoneOf } from '../measurements/index.js';

/**
 * How the drawer tells a person what the agent did. Every logged command has a plain name (`title`), so the drawer
 * never leads with a raw command; `did` writes the sentence "<agent> …" for one call: what it touched and what
 * changed or was found. When `did` returns null the sentence reads "<agent> ran “<title>” on <target>".
 * Rules for both: the person's words, not the API's (track names and 1-based numbers, dB, seconds as m:ss).
 */
export interface ToolInfo {
  /** What the tool does, as a short verb phrase ("Delete a track"); also read as "tried to delete a track" */
  title: string;
  /** What this call did, past tense, following the agent's name; null when the call carries too little to say */
  did: (e: CommandEntry, ctx: { previous?: CommandEntry; now: number }) => string | null;
}

type Params = Record<string, unknown>;

/** The call's params, or nothing when the bridge truncated them past parsing */
export function paramsOf(e: CommandEntry): Params {
  try {
    const p: unknown = e.p ? JSON.parse(e.p) : {};
    return p && typeof p === 'object' ? (p as Params) : {};
  } catch {
    return {};
  }
}

/** A track as a person names it: its name, "Master", or its 1-based number */
export function trackName(ref: unknown): string | null {
  if (typeof ref === 'number') return ref === -1 ? 'the master' : `track ${ref + 1}`;
  if (typeof ref === 'string' && ref) return ref.toLowerCase() === 'master' ? 'the master' : `“${ref.replace(/^\{|\}$/g, '')}”`;
  return null;
}

/** What the call worked on, from its params: a track, else nothing */
export function targetOf(e: CommandEntry): string | null {
  const p = paramsOf(e);
  return trackName(p.trackIndex ?? p.track);
}

const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const ago = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
const fxName = (n: string) => n.replace(/^[A-Z0-9]+i?:\s*/, '').replace(/\s*\([^()]*\)$/, '') || n;
const louder = (d: number) => (Math.abs(d) < 0.05 ? 'the same as' : `${Math.abs(d).toFixed(1)} dB ${d > 0 ? 'hotter' : 'quieter'} than`);

function readMeters(e: CommandEntry, { previous, now }: { previous?: CommandEntry; now: number }): string | null {
  const m = measurementOf(e);
  if (m?.kind !== 'meters') return null;
  const peak = Math.max(m.peakL ?? -150, m.peakR ?? -150);
  const rms = Math.max(m.rmsL ?? -150, m.rmsR ?? -150);
  const zone = zoneOf(peak);
  const verdict = zone === 'over' ? ' — clipping' : zone === 'hot' ? ' — within 6 dB of clipping' : '';
  const was = previous && measurementOf(previous);
  const wasPeak = was?.kind === 'meters' ? Math.max(was.peakL ?? -150, was.peakR ?? -150) : null;
  const since = wasPeak !== null && previous ? `; peaks ${louder(peak - wasPeak)} ${ago(now - previous.t)} ago` : '';
  return `read the levels on ${targetOf(e) ?? 'a track'}: peaks at ${fmt(peak)} dB, RMS ${fmt(rms)} dB${verdict}${since}`;
}

const sources = (r: { lfo?: unknown; acs?: unknown; link?: unknown }) =>
  [r.lfo && 'an LFO', r.acs && 'an audio follower', r.link && 'a parameter link'].filter(Boolean) as string[];
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function setModulation(e: CommandEntry): string | null {
  const v = editViewOf(e) as Extract<EditViewData, { kind: 'modulation' }> | null;
  const r = v?.kind === 'modulation' ? v.rows[0] : undefined;
  if (!v || !r) return null;
  const where = `${r.p} on ${fxName(v.fx)}${targetOf(e) ? `, ${targetOf(e)}` : ''}`;
  if (r.off) return `turned off the modulation of ${where}`;
  const now = sources(r);
  const before = r.was ? sources(r.was) : [];
  const added = now.filter((s) => !before.includes(s));
  if (added.length && added.length === now.length) return `added ${list(added)} to ${where}`;
  return `changed how ${where} is modulated: now ${list(now) || 'its baseline only'}`;
}

function removeTime(e: CommandEntry): string | null {
  const p = paramsOf(e);
  if (typeof p.start !== 'number' || typeof p.end !== 'number') return null;
  const len = (p.end - p.start).toFixed(1);
  const v = editViewOf(e);
  const tracks = v?.kind === 'timeline' && v.lanes ? v.lanes.length + (v.moreTracks ?? 0) : 0;
  return `cut ${time(p.start)}–${time(p.end)} out of the project, and everything after it moved ${len} s earlier${tracks ? ` on ${tracks} tracks` : ''}`;
}

function deleteTrack(e: CommandEntry): string | null {
  const t = trackName(paramsOf(e).track);
  return t ? `deleted the track ${t}` : null;
}

// ── Words for the sentences ──────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const quoted = (s: string) => `“${s}”`;
/** A list param, sent as an array or a JSON string of one ("[…]" when the bridge truncated it) */
const listOf = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
const countOf = (v: unknown, word: string, fallback: string) => {
  const xs = listOf(v);
  return xs ? plural(xs.length, word) : fallback;
};
const names = (v: unknown): string | null => {
  const xs = listOf(v)?.map((x) => trackName(x)).filter((x): x is string => !!x);
  return xs?.length ? list(xs) : null;
};
const on = (e: CommandEntry, fallback = 'a track') => targetOf(e) ?? fallback;
const plugin = (p: Params, key = 'fxIndex') => {
  const name = str(p.fxName);
  if (name) return fxName(name);
  const i = num(p[key]);
  return i === undefined ? 'a plugin' : `plugin ${i + 1}`;
};
const item = (p: Params) => {
  const i = num(p.itemIndex);
  return i === undefined ? 'an item' : `item ${i + 1}`;
};
const at = (v: unknown) => (num(v) === undefined ? '' : ` at ${time(num(v) as number)}`);
const db = (v: unknown) => (num(v) === undefined ? '' : `${fmt(num(v) as number)} dB`);
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (pitch: unknown) => (num(pitch) === undefined ? 'a note' : `${NOTE[(num(pitch) as number) % 12]}${Math.floor((num(pitch) as number) / 12) - 1}`);
/** A grid in beats as a note value: 0.25 → "16th notes" */
const gridName = (g: unknown) => {
  const v = num(g);
  const named: Record<string, string> = { '4': 'whole notes', '2': 'half notes', '1': 'quarter notes', '0.5': '8th notes', '0.25': '16th notes', '0.125': '32nd notes' };
  return v === undefined ? 'the grid' : (named[String(v)] ?? `${v}-beat steps`);
};
const panWords = (v: number) => (Math.abs(v) < 0.005 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`);
const fileName = (path: unknown) => str(path)?.split(/[\\/]/).pop() ?? 'a file';
const between = (a: unknown, b: unknown) => (num(a) !== undefined && num(b) !== undefined ? ` from ${time(num(a) as number)} to ${time(num(b) as number)}` : '');
const lane = (p: Params) => {
  const i = num(p.envelopeIndex);
  return i === undefined ? 'an automation lane' : `automation lane ${i + 1}`;
};

/** A track setting in words: "the volume of track 1 to −4.5 dB" */
function trackSetting(property: unknown, value: unknown): string | null {
  const v = num(value);
  if (v === undefined || typeof property !== 'string') return null;
  switch (property) {
    case 'volume': return `the volume to ${fmt(v)} dB`;
    case 'pan': return `the pan to ${panWords(v)}`;
    case 'mute': return v ? 'it muted' : 'it unmuted';
    case 'solo': return v ? 'it soloed' : 'it unsoloed';
    case 'recordArm': return v ? 'it armed to record' : 'it disarmed';
    case 'phase': return v ? 'its polarity inverted' : 'its polarity normal';
    case 'playOffsetMs': return `its playback offset to ${v} ms`;
    default: return `its ${property} to ${v}`;
  }
}

/** The one row of a settings change the bridge recorded, as "<what> from <before> to <after>" */
function changeRow(e: CommandEntry): string | null {
  const v = editViewOf(e);
  if (v?.kind !== 'changes' || v.rows.length !== 1) return null;
  const r = v.rows[0];
  const text = (x: number | undefined, t: string | undefined) =>
    t ?? (x === undefined ? null : r.s === 'db' ? `${fmt(x)} dB` : r.s === 'pan' ? panWords(x) : r.s === 'bool' ? (x ? 'on' : 'off') : `${Math.round(x * 100)}%`);
  const before = text(r.a, r.at);
  const after = text(r.b, r.bt);
  return after ? `${r.p} on ${quoted(r.t)}${before ? ` from ${before}` : ''} to ${after}` : null;
}

/** What a measurement found, in a phrase; null when the bridge sent no result */
function measured<K extends Measurement['kind']>(e: CommandEntry, kind: K): Extract<Measurement, { kind: K }> | null {
  const m = measurementOf(e);
  return m?.kind === kind ? (m as Extract<Measurement, { kind: K }>) : null;
}
/** A number with a real minus sign, as the readouts print it: −14 */
const signed = (v: number, digits?: number) => (digits === undefined ? String(v) : v.toFixed(digits)).replace('-', '−');
const lufs = (v: number | undefined) => (v === undefined ? null : `${signed(v, 1)} LUFS`);

/** One entry per command the log can show: a new command fails typecheck until it has a title and a sentence */
export const TOOLS: Record<LoggedCommand, ToolInfo> = {
  // Project & tracks
  get_project_info: { title: 'Read the project info', did: () => 'read the project’s tempo, time signature and sample rate' },
  list_tracks: {
    title: 'List the tracks',
    did: (e) => {
      const v = editViewOf(e);
      return v?.kind === 'mixer' ? `listed the ${plural(v.total, 'track')} in the project` : 'listed the tracks in the project';
    },
  },
  get_track_properties: { title: 'Read a track', did: (e) => `read the settings and plugins of ${on(e)}` },
  set_track_property: {
    title: 'Change a track setting',
    did: (e) => {
      const row = changeRow(e);
      if (row) return `set ${row}`;
      const p = paramsOf(e);
      const what = trackSetting(p.property, p.value);
      return what ? `set ${on(e)}: ${what}` : null;
    },
  },
  set_multiple_track_properties: { title: 'Change several tracks', did: (e) => `changed the settings of ${countOf(paramsOf(e).tracks, 'track', changedTracks(e) ?? 'several tracks')} at once` },
  add_track: {
    title: 'Add a track',
    did: (e) => {
      const p = paramsOf(e);
      const pos = num(p.index) === undefined ? '' : ` at position ${(num(p.index) as number) + 1}`;
      return `added ${str(p.name) ? `the track ${quoted(str(p.name) as string)}` : 'a track'}${pos}`;
    },
  },
  delete_track: { title: 'Delete a track', did: deleteTrack },
  move_track: {
    title: 'Move a track',
    did: (e) => {
      const p = paramsOf(e);
      return num(p.toIndex) === undefined ? null : `moved ${on(e)} to position ${(num(p.toIndex) as number) + 1}`;
    },
  },
  set_track_folder: {
    title: 'Change a folder',
    did: (e) => {
      const p = paramsOf(e);
      if (p.mode === 'folder') return `made ${on(e)} a folder${p.collapsed ? ' and collapsed it' : ''}`;
      if (p.mode === 'last') return `made ${on(e)} the last track in its folder`;
      if (p.mode === 'normal') return `made ${on(e)} a normal track, not a folder`;
      return p.collapsed !== undefined ? `${p.collapsed ? 'collapsed' : 'expanded'} the folder ${on(e)}` : null;
    },
  },
  set_track_info: {
    title: 'Rename or recolour a track',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [
        str(p.name) && `renamed ${on(e)} to ${quoted(str(p.name) as string)}`,
        str(p.color) && (p.color === 'none' ? 'cleared its colour' : `coloured it ${p.color}`),
        num(p.channels) !== undefined && `gave it ${p.channels} channels`,
        p.masterSend !== undefined && (p.masterSend ? 'sent it to the master' : 'took it off the master'),
      ].filter(Boolean) as string[];
      if (!parts.length) return null;
      return str(p.name) ? list(parts) : `changed ${on(e)}: ${list(parts)}`;
    },
  },
  set_track_group: {
    title: 'Group tracks',
    did: (e) => {
      const p = paramsOf(e);
      return num(p.group) === undefined ? null : `${p.enable === false ? 'took' : 'put'} ${on(e)} ${p.enable === false ? 'out of' : 'in'} group ${p.group}`;
    },
  },
  // FX
  add_fx: { title: 'Add a plugin', did: (e) => `added ${plugin(paramsOf(e))} to ${on(e)}` },
  remove_fx: { title: 'Remove a plugin', did: (e) => `removed ${chainName(e, 'was') ?? plugin(paramsOf(e))} from ${on(e)}` },
  get_fx_parameters: { title: 'Read a plugin’s settings', did: (e) => `read the settings of ${plugin(paramsOf(e))} on ${on(e)}` },
  analyze_fx: { title: 'Look through a plugin’s settings', did: (e) => `looked through the settings of ${plugin(paramsOf(e))} on ${on(e)}` },
  set_fx_parameter: {
    title: 'Change a plugin setting',
    did: (e) => {
      const row = changeRow(e);
      if (row) return `set ${row}`;
      const p = paramsOf(e);
      return num(p.value) === undefined ? null : `set parameter ${(num(p.paramIndex) ?? 0) + 1} of ${plugin(p)} on ${on(e)} to ${Math.round((num(p.value) as number) * 100)}%`;
    },
  },
  set_fx_enabled: {
    title: 'Bypass or enable a plugin',
    did: (e) => {
      const p = paramsOf(e);
      return `${p.enabled === 0 || p.enabled === false ? 'bypassed' : 'enabled'} ${chainName(e, 'now') ?? plugin(p)} on ${on(e)}`;
    },
  },
  set_fx_offline: {
    title: 'Take a plugin offline or online',
    did: (e) => {
      const p = paramsOf(e);
      return `took ${chainName(e, 'now') ?? plugin(p)} on ${on(e)} ${p.offline ? 'offline (it uses no CPU and keeps its settings)' : 'back online'}`;
    },
  },
  setup_fx_chain: {
    title: 'Build a plugin chain',
    did: (e) => {
      const xs = listOf(paramsOf(e).plugins)?.map((x) => (x && typeof x === 'object' ? str((x as Params).fxName) : undefined)).filter((x): x is string => !!x);
      return xs?.length ? `built a chain of ${plural(xs.length, 'plugin')} on ${on(e)}: ${xs.map(fxName).join(' → ')}` : `built a plugin chain on ${on(e)}`;
    },
  },
  set_multiple_fx_parameters: { title: 'Change several plugin settings', did: (e) => `changed ${countOf(paramsOf(e).updates ?? paramsOf(e).params, 'plugin setting', changedRows(e, 'plugin setting') ?? 'several plugin settings')} at once` },
  // Transport
  play: { title: 'Start playback', did: () => 'started playback' },
  stop: { title: 'Stop playback', did: () => 'stopped playback' },
  record: { title: 'Start recording', did: () => 'started recording on the armed tracks' },
  get_transport_state: { title: 'Read the transport', did: () => 'checked whether REAPER is playing and where the cursor is' },
  set_cursor_position: { title: 'Move the edit cursor', did: (e) => (num(paramsOf(e).position) === undefined ? null : `moved the edit cursor to ${time(num(paramsOf(e).position) as number)}`) },
  // MIDI
  create_midi_item: { title: 'Create a MIDI item', did: (e) => `created an empty MIDI item on ${on(e)}${between(paramsOf(e).startPosition, paramsOf(e).endPosition)}` },
  list_midi_items: { title: 'List MIDI items', did: (e) => `listed the MIDI items on ${on(e)}` },
  get_midi_notes: { title: 'Read MIDI notes', did: (e) => `read the notes in MIDI ${item(paramsOf(e))} on ${on(e)}` },
  analyze_midi: { title: 'Analyse MIDI', did: (e) => `analysed the notes in MIDI ${item(paramsOf(e))} on ${on(e)}: velocities per pitch and repeated hits` },
  insert_midi_note: {
    title: 'Add a MIDI note',
    did: (e) => {
      const p = paramsOf(e);
      return `added ${noteName(p.pitch)}${num(p.velocity) !== undefined ? ` (velocity ${p.velocity})` : ''} to MIDI ${item(p)} on ${on(e)}`;
    },
  },
  insert_midi_notes: { title: 'Add MIDI notes', did: (e) => `added ${countOf(paramsOf(e).notes, 'note', 'notes')} to MIDI ${item(paramsOf(e))} on ${on(e)}` },
  edit_midi_note: { title: 'Edit a MIDI note', did: (e) => `edited note ${(num(paramsOf(e).noteIndex) ?? 0) + 1} in MIDI ${item(paramsOf(e))} on ${on(e)}` },
  edit_midi_notes: { title: 'Edit MIDI notes', did: (e) => `edited ${countOf(paramsOf(e).edits, 'note', 'notes')} in MIDI ${item(paramsOf(e))} on ${on(e)}` },
  delete_midi_note: { title: 'Delete a MIDI note', did: (e) => `deleted note ${(num(paramsOf(e).noteIndex) ?? 0) + 1} from MIDI ${item(paramsOf(e))} on ${on(e)}` },
  get_midi_cc: {
    title: 'Read MIDI CC',
    did: (e) => `read ${num(paramsOf(e).ccNumber) !== undefined ? `CC ${paramsOf(e).ccNumber}` : 'the controller data'} in MIDI ${item(paramsOf(e))} on ${on(e)}`,
  },
  insert_midi_cc: {
    title: 'Add a MIDI CC event',
    did: (e) => {
      const p = paramsOf(e);
      return `added a CC ${p.ccNumber ?? ''} event${num(p.value) !== undefined ? ` (value ${p.value})` : ''} to MIDI ${item(p)} on ${on(e)}`;
    },
  },
  delete_midi_cc: { title: 'Delete a MIDI CC event', did: (e) => `deleted controller event ${(num(paramsOf(e).ccIndex) ?? 0) + 1} from MIDI ${item(paramsOf(e))} on ${on(e)}` },
  get_midi_item_properties: { title: 'Read a MIDI item', did: (e) => `read the position, length and loop setting of MIDI ${item(paramsOf(e))} on ${on(e)}` },
  set_midi_item_properties: {
    title: 'Change a MIDI item',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [
        num(p.position) !== undefined && `moved it to ${time(num(p.position) as number)}`,
        num(p.length) !== undefined && `made it ${num(p.length)} s long`,
        p.mute !== undefined && (p.mute ? 'muted it' : 'unmuted it'),
        p.loopSource !== undefined && (p.loopSource ? 'set it to loop' : 'stopped it looping'),
      ].filter(Boolean) as string[];
      return `changed MIDI ${item(p)} on ${on(e)}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  quantize_midi: {
    title: 'Quantize MIDI',
    did: (e) => {
      const p = paramsOf(e);
      const strength = num(p.strength);
      return `quantized the notes in MIDI ${item(p)} on ${on(e)} to ${gridName(p.grid)}${strength !== undefined && strength < 1 ? ` at ${Math.round(strength * 100)}% strength` : ''}`;
    },
  },
  transform_midi: {
    title: 'Transform MIDI',
    did: (e) => {
      const p = paramsOf(e);
      const t = num(p.transpose);
      const parts = [
        t && `transposed them ${t > 0 ? 'up' : 'down'} ${plural(Math.abs(t), 'semitone')}`,
        p.velocity && 'changed their velocities',
        p.humanize && 'humanized their timing',
        p.length && 'changed their lengths',
      ].filter(Boolean) as string[];
      return `reworked the notes in MIDI ${item(p)} on ${on(e)}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  import_midi_file: { title: 'Import a MIDI file', did: (e) => `imported ${fileName(paramsOf(e).path)} onto ${on(e)}${at(paramsOf(e).position)}` },
  detect_key: {
    title: 'Detect the key',
    did: (e) => {
      const m = measured(e, 'key');
      return m?.key ? `found ${on(e, 'the audio')} is in ${m.key}${m.conf !== undefined ? ` (${Math.round(m.conf * 100)}% sure)` : ''}` : `looked for the key of ${on(e)}`;
    },
  },
  detect_chords: {
    title: 'Detect the chords',
    did: (e) => {
      const m = measured(e, 'chords');
      if (!m) return `looked for the chords of ${on(e)}`;
      const names = [...new Set(m.ch.map((c) => c[2]).filter((c) => c !== 'N'))];
      return `found ${names.length} chord${names.length === 1 ? '' : 's'} in ${on(e, 'the audio')}${m.key ? ` (${m.key})` : ''}: ${names.slice(0, 6).join(' ')}${names.length > 6 ? ' …' : ''}`;
    },
  },
  send_midi_cc: { title: 'Send a live MIDI CC', did: (e) => `sent CC ${paramsOf(e).cc ?? ''} = ${paramsOf(e).value ?? ''} live to ${on(e)}` },
  send_midi_pc: { title: 'Send a program change', did: (e) => `switched ${on(e)} to program ${paramsOf(e).program ?? ''} live` },
  send_midi_note: {
    title: 'Play a live MIDI note',
    did: (e) => {
      const p = paramsOf(e);
      return `played ${noteName(p.pitch)} live on ${on(e)}${num(p.durationMs) !== undefined ? ` for ${p.durationMs} ms` : ''}`;
    },
  },
  // Media items
  list_media_items: { title: 'List items', did: (e) => `listed the items on ${on(e)}` },
  get_media_item_properties: { title: 'Read an item', did: (e) => `read the position, fades, rate and source of ${item(paramsOf(e))} on ${on(e)}` },
  set_media_item_properties: {
    title: 'Change an item',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [
        num(p.position) !== undefined && `moved it to ${time(num(p.position) as number)}`,
        num(p.length) !== undefined && `made it ${num(p.length)} s long`,
        num(p.volume) !== undefined && `set its gain to ${db(p.volume)}`,
        p.mute !== undefined && (p.mute ? 'muted it' : 'unmuted it'),
        (num(p.fadeInLength) !== undefined || num(p.fadeOutLength) !== undefined) && 'changed its fades',
        num(p.playRate) !== undefined && `set its play rate to ${p.playRate}×`,
      ].filter(Boolean) as string[];
      return `changed ${item(p)} on ${on(e)}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  set_media_items_properties: { title: 'Change several items', did: (e) => `changed ${countOf(paramsOf(e).items, 'item', 'several items')} at once` },
  split_media_item: { title: 'Split an item', did: (e) => `split ${item(paramsOf(e))} on ${on(e)} in two${at(paramsOf(e).position)}` },
  delete_media_item: { title: 'Delete an item', did: (e) => `deleted ${item(paramsOf(e))} from ${on(e)}` },
  move_media_item: {
    title: 'Move an item',
    did: (e) => {
      const p = paramsOf(e);
      const to = [num(p.newPosition) !== undefined && `to ${time(num(p.newPosition) as number)}`, num(p.newTrackIndex) !== undefined && `onto ${trackName(p.newTrackIndex)}`].filter(Boolean);
      return `moved ${item(p)} on ${on(e)}${to.length ? ` ${to.join(' ')}` : ''}`;
    },
  },
  trim_media_item: {
    title: 'Trim an item',
    did: (e) => {
      const p = paramsOf(e);
      const edge = (v: unknown, where: string) => {
        const s = num(v);
        return s ? `${s > 0 ? 'trimmed' : 'extended'} ${Math.abs(s)} s ${s > 0 ? 'off' : 'onto'} the ${where}` : null;
      };
      const parts = [edge(p.trimStart, 'start'), edge(p.trimEnd, 'end')].filter(Boolean) as string[];
      return parts.length ? `${list(parts)} of ${item(p)} on ${on(e)}` : `trimmed ${item(p)} on ${on(e)}`;
    },
  },
  add_stretch_marker: { title: 'Add a stretch marker', did: (e) => `added a stretch marker to ${item(paramsOf(e))} on ${on(e)}, ${num(paramsOf(e).position) ?? 0} s in` },
  get_stretch_markers: { title: 'Read stretch markers', did: (e) => `read the stretch markers of ${item(paramsOf(e))} on ${on(e)}` },
  delete_stretch_marker: { title: 'Delete a stretch marker', did: (e) => `deleted stretch marker ${(num(paramsOf(e).markerIndex) ?? 0) + 1} from ${item(paramsOf(e))} on ${on(e)}` },
  // Arrangement
  copy_media_items: {
    title: 'Copy items',
    did: (e) => {
      const p = paramsOf(e);
      const times = num(p.times);
      return `copied ${countOf(p.items, 'item', 'the items')}${times && times > 1 ? `, ${times} times end to end` : ''}${at(p.position)}`;
    },
  },
  insert_time: {
    title: 'Insert time',
    did: (e) => {
      const p = paramsOf(e);
      return num(p.length) === undefined ? null : `opened ${num(p.length)} s of empty space${at(p.position)}, and everything after it moved later`;
    },
  },
  remove_time: { title: 'Remove time', did: removeTime },
  copy_section: {
    title: 'Copy a section',
    did: (e) => {
      const p = paramsOf(e);
      const from = num(p.regionIndex) !== undefined ? `region ${(num(p.regionIndex) as number) + 1}` : between(p.start, p.end).replace(/^ from/, '').trim() || 'a section';
      return `copied ${from}, items and automation,${at(p.position) || ' elsewhere'}${p.insert ? ', opening time for it' : ''}`;
    },
  },
  process_items: {
    title: 'Normalize, reverse or glue items',
    did: (e) => {
      const p = paramsOf(e);
      const n = countOf(p.items, 'item', 'items');
      if (p.operation === 'normalize') return `normalized ${n}${num(p.target) !== undefined ? ` to ${db(p.target)}` : ''}`;
      if (p.operation === 'reverse') return `reversed ${n}`;
      if (p.operation === 'glue') return `glued ${n} into one`;
      return null;
    },
  },
  // Selection
  get_selected_tracks: { title: 'Read the track selection', did: () => 'checked which tracks are selected' },
  set_selected_tracks: { title: 'Select tracks', did: (e) => `${paramsOf(e).mode === 'add' ? 'added' : 'selected'} ${names(paramsOf(e).tracks) ?? 'tracks'}${paramsOf(e).mode === 'add' ? ' to the selection' : ''}` },
  set_selected_items: { title: 'Select items', did: (e) => `selected ${countOf(paramsOf(e).items, 'item', 'items')}` },
  get_time_selection: { title: 'Read the time selection', did: () => 'checked the time selection' },
  set_time_selection: { title: 'Set the time selection', did: (e) => `selected the time${between(paramsOf(e).start, paramsOf(e).end)}` },
  // Markers & regions
  list_markers: { title: 'List markers', did: () => 'listed the markers' },
  list_regions: { title: 'List regions', did: () => 'listed the regions' },
  add_marker: { title: 'Add a marker', did: (e) => `added ${str(paramsOf(e).name) ? `the marker ${quoted(str(paramsOf(e).name) as string)}` : 'a marker'}${at(paramsOf(e).position)}` },
  add_region: { title: 'Add a region', did: (e) => `added ${str(paramsOf(e).name) ? `the region ${quoted(str(paramsOf(e).name) as string)}` : 'a region'}${between(paramsOf(e).start, paramsOf(e).end)}` },
  delete_marker: { title: 'Delete a marker', did: (e) => `deleted marker ${(num(paramsOf(e).markerIndex) ?? 0) + 1}` },
  delete_region: { title: 'Delete a region', did: (e) => `deleted region ${(num(paramsOf(e).regionIndex) ?? 0) + 1}` },
  edit_marker: {
    title: 'Edit a marker',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [str(p.name) && `renamed it ${quoted(str(p.name) as string)}`, num(p.position) !== undefined && `moved it to ${time(num(p.position) as number)}`, p.color !== undefined && 'recoloured it'].filter(Boolean) as string[];
      return `changed marker ${(num(p.markerIndex) ?? 0) + 1}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  edit_region: {
    title: 'Edit a region',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [str(p.name) && `renamed it ${quoted(str(p.name) as string)}`, (num(p.start) !== undefined || num(p.end) !== undefined) && 'moved its edges', p.color !== undefined && 'recoloured it'].filter(Boolean) as string[];
      return `changed region ${(num(p.regionIndex) ?? 0) + 1}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  // Tempo
  get_tempo_map: { title: 'Read the tempo map', did: () => 'read the tempo and time signature changes' },
  add_tempo_marker: {
    title: 'Add a tempo change',
    did: (e) => {
      const p = paramsOf(e);
      const sig = num(p.timeSigNumerator) ? ` in ${p.timeSigNumerator}/${p.timeSigDenominator ?? 4}` : '';
      return `changed the tempo to ${p.bpm ?? '?'} BPM${sig}${at(p.position)}`;
    },
  },
  edit_tempo_marker: { title: 'Edit a tempo change', did: (e) => `changed tempo marker ${(num(paramsOf(e).index) ?? 0) + 1}${num(paramsOf(e).bpm) !== undefined ? ` to ${paramsOf(e).bpm} BPM` : ''}` },
  delete_tempo_marker: { title: 'Delete a tempo change', did: (e) => `deleted tempo marker ${(num(paramsOf(e).index) ?? 0) + 1}` },
  set_project_tempo: { title: 'Set the tempo', did: (e) => (num(paramsOf(e).bpm) === undefined ? null : `set the song’s tempo to ${paramsOf(e).bpm} BPM`) },
  // Automation
  create_track_envelope: {
    title: 'Show an automation lane',
    did: (e) => {
      const p = paramsOf(e);
      const name = str(p.envelopeName) ?? (num(p.paramIndex) !== undefined ? `parameter ${(num(p.paramIndex) as number) + 1} of ${plugin(p)}` : 'an');
      return `showed the ${name} automation lane on ${on(e)}`;
    },
  },
  get_track_envelopes: { title: 'List automation lanes', did: (e) => `listed the automation lanes on ${on(e)}` },
  get_envelope_points: { title: 'Read automation', did: (e) => `read the points of ${envelopeName(e) ?? lane(paramsOf(e))} on ${on(e)}` },
  insert_envelope_point: {
    title: 'Add an automation point',
    did: (e) => {
      const p = paramsOf(e);
      const value = num(p.db) !== undefined ? ` (${db(p.db)})` : num(p.value) !== undefined ? ` (value ${p.value})` : '';
      return `added a point${value}${at(p.time)} to ${envelopeName(e) ?? lane(p)} on ${on(e)}`;
    },
  },
  insert_envelope_points: { title: 'Write automation', did: (e) => `wrote ${countOf(paramsOf(e).points, 'point', 'new points')} into ${envelopeName(e) ?? lane(paramsOf(e))} on ${on(e)}` },
  edit_envelope_points: { title: 'Edit automation', did: (e) => `moved or reshaped ${countOf(paramsOf(e).points, 'point', 'the points')} in ${envelopeName(e) ?? lane(paramsOf(e))} on ${on(e)}` },
  delete_envelope_point: { title: 'Delete an automation point', did: (e) => `deleted point ${(num(paramsOf(e).pointIndex) ?? 0) + 1} from ${envelopeName(e) ?? lane(paramsOf(e))} on ${on(e)}` },
  clear_envelope: { title: 'Clear an automation lane', did: (e) => `deleted every point in ${envelopeName(e) ?? lane(paramsOf(e))} on ${on(e)}` },
  remove_envelope_points: { title: 'Erase automation', did: (e) => `erased ${envelopeName(e) ?? 'the automation'} on ${on(e)}${between(paramsOf(e).timeStart, paramsOf(e).timeEnd)}` },
  set_envelope_properties: {
    title: 'Arm or show an automation lane',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [
        p.armed !== undefined && (p.armed ? 'armed it' : 'disarmed it'),
        p.visible !== undefined && (p.visible ? 'showed it' : 'hid it'),
        p.active !== undefined && (p.active ? 'turned it on' : 'turned it off'),
      ].filter(Boolean) as string[];
      return `changed ${lane(p)} on ${on(e)}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  list_automation_items: { title: 'List automation items', did: (e) => `listed the automation items in ${lane(paramsOf(e))} on ${on(e)}` },
  insert_automation_item: {
    title: 'Add an automation item',
    did: (e) => {
      const p = paramsOf(e);
      const pooled = num(p.poolId) !== undefined ? ` sharing pool ${p.poolId}` : '';
      return `added an automation item${pooled}${at(p.position)}${num(p.length) !== undefined ? `, ${p.length} s long,` : ''} to ${on(e)}`;
    },
  },
  set_automation_item: { title: 'Change an automation item', did: (e) => `changed automation item ${(num(paramsOf(e).automationItemIndex) ?? 0) + 1} on ${on(e)}` },
  delete_automation_item: {
    title: 'Delete an automation item',
    did: (e) => `deleted automation item ${(num(paramsOf(e).automationItemIndex) ?? 0) + 1} on ${on(e)}${paramsOf(e).preservePoints ? ', keeping its points' : ''}`,
  },
  // Plugins & presets
  list_available_fx: { title: 'List installed plugins', did: (e) => `listed the installed ${str(paramsOf(e).category) ? `${paramsOf(e).category} ` : ''}plugins` },
  search_fx: { title: 'Search plugins', did: (e) => `searched the installed plugins for ${quoted(str(paramsOf(e).query) ?? '')}` },
  get_fx_preset_list: { title: 'List a plugin’s presets', did: (e) => `listed the presets of ${plugin(paramsOf(e))} on ${on(e)}` },
  set_fx_preset: { title: 'Load a preset', did: (e) => `loaded the preset ${quoted(str(paramsOf(e).presetName) ?? '')} on ${chainName(e, 'now') ?? plugin(paramsOf(e))}, ${on(e)}` },
  // Snapshots
  snapshot_save: { title: 'Save a mix snapshot', did: (e) => `saved the mix as the snapshot ${quoted(str(paramsOf(e).name) ?? '')}` },
  snapshot_restore: { title: 'Load a mix snapshot', did: (e) => `loaded the mix snapshot ${quoted(str(paramsOf(e).name) ?? '')}: volumes, pans, sends and plugin settings` },
  snapshot_list: { title: 'List mix snapshots', did: () => 'listed the saved mix snapshots' },
  snapshot_delete: { title: 'Delete a mix snapshot', did: (e) => `deleted the mix snapshot ${quoted(str(paramsOf(e).name) ?? '')}` },
  snapshot_edit: {
    title: 'Rename a mix snapshot',
    did: (e) => {
      const p = paramsOf(e);
      return str(p.newName) ? `renamed the snapshot ${quoted(str(p.name) ?? '')} to ${quoted(str(p.newName) as string)}` : `changed the description of the snapshot ${quoted(str(p.name) ?? '')}`;
    },
  },
  // Routing
  get_track_routing: { title: 'Read a track’s routing', did: (e) => `read the sends, receives and outputs of ${on(e)}` },
  add_send: {
    title: 'Add a send',
    did: (e) => {
      const p = paramsOf(e);
      return `sent ${trackName(p.from) ?? 'a track'} to ${trackName(p.to) ?? 'a track'}${num(p.volume) !== undefined ? ` at ${db(p.volume)}` : ''}`;
    },
  },
  set_send: {
    title: 'Change a send',
    did: (e) => {
      const p = paramsOf(e);
      const kind = p.category === 'receive' ? 'receive' : p.category === 'hardware' ? 'hardware output' : 'send';
      const level = routeLevel(e, kind === 'send' ? 's' : kind === 'receive' ? 'r' : 'h');
      if (level) return `turned the ${kind} ${kind === 'receive' ? 'from' : 'to'} ${quoted(level.other)} on ${on(e)} ${level.change}`;
      return `changed ${kind} ${(num(p.index) ?? 0) + 1} on ${on(e)}${num(p.volume) !== undefined ? `: level ${db(p.volume)}` : ''}`;
    },
  },
  remove_send: {
    title: 'Remove a send',
    did: (e) => {
      const p = paramsOf(e);
      const kind = p.category === 'receive' ? 'receive' : p.category === 'hardware' ? 'hardware output' : 'send';
      return `removed ${kind} ${(num(p.index) ?? 0) + 1} from ${on(e)}`;
    },
  },
  add_hardware_output: { title: 'Route to a hardware output', did: (e) => `routed ${on(e)} to hardware output ${paramsOf(e).outputChannel ?? 1}${paramsOf(e).mono ? ' (mono)' : ''}` },
  // Metering & analysis
  read_track_meters: { title: 'Read the levels', did: readMeters },
  read_track_spectrum: {
    title: 'Read the spectrum',
    did: (e) => {
      const m = measured(e, 'spectrum');
      return `read the frequency spectrum of ${on(e)}${m?.rmsDb !== undefined ? ` (RMS ${fmt(m.rmsDb)} dB)` : ''}`;
    },
  },
  read_track_lufs: {
    title: 'Measure loudness',
    did: (e) => {
      const m = measured(e, 'lufs');
      const target = num(paramsOf(e).targetLufs);
      const i = m?.integrated;
      if (i === undefined) return `measured the loudness of ${on(e)}`;
      const off = target === undefined ? '' : Math.abs(i - target) < 0.5 ? `, on the ${signed(target)} LUFS target` : `, ${Math.abs(i - target).toFixed(1)} LU ${i > target ? 'over' : 'under'} the ${signed(target)} LUFS target`;
      return `measured ${on(e)} at ${lufs(i)} integrated${off}`;
    },
  },
  read_track_correlation: {
    title: 'Measure stereo correlation',
    did: (e) => {
      const c = measured(e, 'correlation')?.correlation;
      if (c === undefined) return `measured the stereo image of ${on(e)}`;
      const verdict = c < 0 ? ' — out of phase, it will thin out in mono' : c > 0.9 ? ' — nearly mono' : '';
      return `measured the stereo image of ${on(e)}: correlation ${signed(c, 2)}${verdict}`;
    },
  },
  read_track_crest: {
    title: 'Measure dynamics',
    did: (e) => {
      const c = measured(e, 'crest')?.crestFactor;
      return c === undefined ? `measured the dynamics of ${on(e)}` : `measured the dynamics of ${on(e)}: peaks ${c.toFixed(1)} dB above the average (crest factor)`;
    },
  },
  remove_mcp_meters: { title: 'Remove the agent’s meters', did: (e) => `removed the meters it had added to ${countOf(paramsOf(e).trackIndices, 'track', 'the tracks')}` },
  render_track_to_wav: { title: 'Render a clip to listen to', did: (e) => `rendered ${on(e)}${between(paramsOf(e).startTime, paramsOf(e).endTime)} to a file to analyse` },
  analyze_track_aesthetics: {
    title: 'Score the sound quality',
    did: (e) => {
      const m = measured(e, 'aesthetics');
      return m?.pq === undefined ? `scored the sound of ${on(e)}` : `scored the sound of ${on(e)}: production quality ${m.pq.toFixed(1)} / 10`;
    },
  },
  analyze_track_offline: {
    title: 'Analyse a track offline',
    did: (e) => {
      const m = measured(e, 'offline');
      const parts = [lufs(m?.lufs), m?.lra !== undefined && `loudness range ${m.lra.toFixed(1)} LU`, m?.tp !== undefined && `true peak ${fmt(m.tp)} dBTP`].filter(Boolean) as string[];
      return `rendered and analysed ${on(e)}${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  analyze_audio_file: {
    title: 'Analyse an audio file',
    did: (e) => {
      const m = measured(e, 'offline');
      return `analysed ${fileName(paramsOf(e).path)}${m?.lufs !== undefined ? `: ${lufs(m.lufs)} integrated` : ''}`;
    },
  },
  measure_track_alignment: {
    title: 'Check two tracks’ timing and phase',
    did: (e) => {
      const m = measured(e, 'alignment');
      const p = paramsOf(e);
      const pair = `${on(e)} against ${trackName(p.referenceTrack) ?? 'the reference'}`;
      if (m?.delayMs === undefined) return `compared the timing of ${pair}`;
      const late = Math.abs(m.delayMs) < 0.05 ? 'in time with' : `${Math.abs(m.delayMs).toFixed(1)} ms ${m.delayMs > 0 ? 'late' : 'early'} against`;
      return `found ${on(e)} ${late} ${trackName(p.referenceTrack) ?? 'the reference'}${m.inv ? ', with its polarity inverted' : ''}`;
    },
  },
  detect_transients: {
    title: 'Find the hits',
    did: (e) => {
      const p = paramsOf(e);
      return `found the ${str(p.band) ? `${p.band} ` : ''}hits in ${str(p.path) ? fileName(p.path) : on(e)}${between(p.startTime, p.endTime)}`;
    },
  },
  create_transient_automation: {
    title: 'Write automation from the hits',
    did: (e) => {
      const p = paramsOf(e);
      return `${p.dryRun ? 'worked out' : 'wrote'} one automation pulse per ${str(p.band) ? `${p.band} ` : ''}hit of ${on(e)} onto ${trackName(p.targetTrack) ?? 'the target lane'}${between(p.startTime, p.endTime)}`;
    },
  },
  analyze_loudness_curve: {
    title: 'Chart loudness over time',
    did: (e) => {
      const m = measured(e, 'curve');
      const over = m?.overS ? `; ${Math.round(m.overS)} s over the ${m.target === undefined ? '' : signed(m.target)} LUFS target` : '';
      return `charted the loudness of ${on(e)} over time${m?.lufs !== undefined ? `: ${lufs(m.lufs)} integrated` : ''}${over}`;
    },
  },
  analyze_stereo_bands: {
    title: 'Check stereo by band',
    did: (e) => {
      const m = measured(e, 'stereo');
      return `checked the stereo image of ${on(e)} band by band${m?.flags.length ? `: ${m.flags.join('; ')}` : m ? ': nothing out of phase' : ''}`;
    },
  },
  measure_masking: {
    title: 'Find tracks masking each other',
    did: (e) => {
      const m = measured(e, 'masking');
      const worst = m?.pairs[0];
      return `compared ${countOf(paramsOf(e).tracks, 'track', 'tracks')} for frequencies they fight over${worst ? `: ${quoted(worst[0])} and ${quoted(worst[1])} clash the most` : ''}`;
    },
  },
  separate_stems: {
    title: 'Split audio into stems',
    did: (e) => {
      const m = measured(e, 'stems');
      const stems = m?.stems.length ? `${m.stems.map((s) => s[0]).join(', ')}` : 'stems';
      return `split ${on(e)} into ${stems}${m?.inserted ? `, on ${plural(m.inserted, 'new track')} in a muted folder` : ''}`;
    },
  },
  insert_stem_tracks: { title: 'Add stem tracks', did: (e) => `added ${countOf(paramsOf(e).files, 'stem track', 'the stem tracks')}${str(paramsOf(e).folderName) ? ` in the folder ${quoted(str(paramsOf(e).folderName) as string)}` : ''}` },
  // Plans, actions & project
  run_plan: {
    title: 'Run a plan of edits',
    did: (e) => {
      const p = paramsOf(e);
      const v = editViewOf(e);
      const n = v?.kind === 'plan' ? plural(v.total, 'edit') : countOf(p.ops, 'edit', 'several edits');
      return p.dryRun ? `checked a plan of ${n} without changing anything` : `made ${n} in one go, as one undo step`;
    },
  },
  search_actions: { title: 'Search REAPER actions', did: (e) => `searched REAPER’s actions for ${quoted(str(paramsOf(e).query) ?? '')}` },
  get_action: { title: 'Read a REAPER action', did: (e) => `looked up the REAPER action ${quoted(String(paramsOf(e).action ?? ''))}` },
  run_action: { title: 'Run a REAPER action', did: (e) => `ran the REAPER action ${quoted(String(paramsOf(e).action ?? ''))}` },
  undo_project: { title: 'Undo', did: () => 'undid the last change' },
  redo_project: { title: 'Redo', did: () => 'redid the last undone change' },
  save_project: { title: 'Save the project', did: (e) => (str(paramsOf(e).path) ? `saved a copy of the project as ${fileName(paramsOf(e).path)}` : 'saved the project') },
  get_render_settings: { title: 'Read the render settings', did: () => 'read the render settings' },
  set_render_settings: {
    title: 'Change the render settings',
    did: (e) => {
      const p = paramsOf(e);
      const fmtName = str(p.format)?.toUpperCase();
      return `set renders to ${num(p.bitDepth) ? `${p.bitDepth}-bit ` : ''}${fmtName ?? 'new settings'}${str(p.bounds) ? `, ${BOUNDS[String(p.bounds)] ?? String(p.bounds).replace(/_/g, ' ')}` : ''}`;
    },
  },
  render_project: {
    title: 'Render the project',
    did: (e) => {
      const v = editViewOf(e);
      const files = v?.kind === 'render' ? v.groups.reduce((n, g) => n + g.f.length, 0) : 0;
      return files ? `rendered the project to ${plural(files, 'file')}` : 'rendered the project';
    },
  },
  render_versions: { title: 'Render versions', did: (e) => {
      const v = editViewOf(e);
      return `rendered ${countOf(paramsOf(e).versions, 'version', v?.kind === 'render' ? plural(v.groups.length, 'version') : 'several versions')} of the mix`;
    },
  },
  get_project_settings: { title: 'Read the project settings', did: () => 'read the project settings' },
  set_project_settings: {
    title: 'Change the project settings',
    did: (e) => {
      const p = paramsOf(e);
      const parts = [
        num(p.sampleRate) !== undefined && `sample rate ${p.sampleRate} Hz`,
        str(p.title) && `title ${quoted(str(p.title) as string)}`,
        str(p.author) && `author ${quoted(str(p.author) as string)}`,
        p.repeat !== undefined && `repeat ${p.repeat ? 'on' : 'off'}`,
        p.metronome !== undefined && `metronome ${p.metronome ? 'on' : 'off'}`,
      ].filter(Boolean) as string[];
      return `changed the project settings${parts.length ? `: ${list(parts)}` : ''}`;
    },
  },
  // Items & takes
  insert_audio_file: { title: 'Import an audio file', did: (e) => `imported ${fileName(paramsOf(e).filePath)} onto ${on(e)}${at(paramsOf(e).position)}` },
  list_takes: { title: 'List takes', did: (e) => `listed the takes of ${item(paramsOf(e))} on ${on(e)}` },
  set_active_take: { title: 'Switch the take', did: (e) => `switched ${item(paramsOf(e))} on ${on(e)} to take ${(num(paramsOf(e).takeIndex) ?? 0) + 1}` },
  get_take_fx: { title: 'Read a take’s plugins', did: (e) => `read the plugins on ${item(paramsOf(e))}, ${on(e)}` },
  add_take_fx: { title: 'Add a plugin to a take', did: (e) => `added ${plugin(paramsOf(e))} to ${item(paramsOf(e))} on ${on(e)}` },
  remove_take_fx: { title: 'Remove a plugin from a take', did: (e) => `removed ${plugin(paramsOf(e))} from ${item(paramsOf(e))} on ${on(e)}` },
  set_take_fx_parameter: { title: 'Change a take plugin setting', did: (e) => `changed a setting of ${plugin(paramsOf(e))} on ${item(paramsOf(e))}, ${on(e)}` },
  get_item_appearance: { title: 'Read an item’s colour and fades', did: (e) => `read the colour and fades of ${item(paramsOf(e))} on ${on(e)}` },
  set_item_color: { title: 'Colour an item', did: (e) => (paramsOf(e).color === 'none' ? `reset the colour of ${item(paramsOf(e))} on ${on(e)}` : `coloured ${item(paramsOf(e))} on ${on(e)} ${paramsOf(e).color ?? ''}`.trim()) },
  set_item_fades: { title: 'Set an item’s fades', did: (e) => `set the fades of ${item(paramsOf(e))} on ${on(e)}` },
  // Plugin housekeeping
  move_fx: {
    title: 'Move a plugin',
    did: (e) => {
      const p = paramsOf(e);
      const other = num(p.toTrackIndex) !== undefined && p.toTrackIndex !== p.trackIndex;
      return `moved ${chainName(e, 'was') ?? plugin(p)} ${other ? `from ${on(e)} to ${trackName(p.toTrackIndex)}` : `within ${on(e)}'s chain`}`;
    },
  },
  copy_fx: {
    title: 'Copy a plugin',
    did: (e) => {
      const p = paramsOf(e);
      return `copied ${plugin(p)} with its settings from ${on(e)}${num(p.toTrackIndex) !== undefined ? ` to ${trackName(p.toTrackIndex)}` : ''}`;
    },
  },
  rename_fx: { title: 'Rename a plugin', did: (e) => (str(paramsOf(e).name) ? `renamed ${plugin(paramsOf(e))} on ${on(e)} to ${quoted(str(paramsOf(e).name) as string)}` : `gave ${plugin(paramsOf(e))} on ${on(e)} its own name back`) },
  save_fx_chain: { title: 'Save a plugin chain', did: (e) => `saved the plugins on ${on(e)} as the chain ${quoted(str(paramsOf(e).name) ?? '')}` },
  load_fx_chain: { title: 'Load a plugin chain', did: (e) => `loaded the chain ${quoted(str(paramsOf(e).name) ?? '')} onto ${on(e)}, ${paramsOf(e).mode === 'replace' ? 'replacing its plugins' : 'after its plugins'}` },
  list_fx_chains: { title: 'List saved plugin chains', did: () => 'listed the saved plugin chains' },
  save_track_template: { title: 'Save a track template', did: (e) => `saved ${on(e)} as the track template ${quoted(str(paramsOf(e).name) ?? '')}` },
  insert_track_template: { title: 'Add tracks from a template', did: (e) => `added the track template ${quoted(str(paramsOf(e).name) ?? '')}` },
  list_track_templates: { title: 'List track templates', did: () => 'listed the saved track templates' },
  // Recording
  get_record_setup: { title: 'Read the record setup', did: () => 'checked the record setup: armed tracks, inputs, monitoring and punch' },
  set_track_record: {
    title: 'Set up tracks to record',
    did: (e) => {
      const xs = listOf(paramsOf(e).tracks);
      const first = xs?.[0] && typeof xs[0] === 'object' ? trackName((xs[0] as Params).track) : null;
      return xs?.length === 1 && first ? `set up ${first} to record` : `set up ${countOf(paramsOf(e).tracks, 'track', 'tracks')} to record`;
    },
  },
  set_record_mode: {
    title: 'Change the record mode',
    did: (e) => {
      const p = paramsOf(e);
      if (p.mode === 'time_selection') return `set recording to punch in${between(p.punchStart, p.punchEnd)}`;
      if (p.mode === 'selected_items') return 'set recording to punch in on the selected items';
      if (p.mode === 'normal') return 'set recording back to normal, no punch';
      return 'changed the record settings';
    },
  },
  get_track_lanes: { title: 'Read a track’s lanes', did: (e) => `read the take lanes of ${on(e)}` },
  set_track_lanes: { title: 'Change a track’s lanes', did: (e) => `changed the take lanes of ${on(e)}` },
  comp_lanes: { title: 'Comp takes', did: (e) => `comped ${on(e)} from ${countOf(paramsOf(e).ranges, 'part', 'parts')} of its takes, on a new comp lane` },
  // Mixing depth
  set_automation_mode: {
    title: 'Change the automation mode',
    did: (e) => {
      const p = paramsOf(e);
      if (str(p.globalOverride)) return `set every track's automation to ${String(p.globalOverride).replace('_', ' ')}`;
      return `set ${names(p.tracks) ?? 'tracks'} to ${str(p.mode) ? String(p.mode).replace('_', ' ') : 'a new'} automation`;
    },
  },
  get_fx_param_modulation: { title: 'Read a plugin’s modulation', did: (e) => `checked which settings of ${plugin(paramsOf(e))} on ${on(e)} are modulated` },
  set_fx_param_modulation: { title: 'Modulate a plugin setting', did: setModulation },
  get_fx_pins: { title: 'Read a plugin’s pins', did: (e) => `read how ${plugin(paramsOf(e))} on ${on(e)} is wired to the track's channels` },
  set_fx_pins: { title: 'Wire a plugin’s pins', did: (e) => `rewired ${plugin(paramsOf(e))} on ${on(e)} to the track's channels` },
  list_monitoring_fx: { title: 'List monitoring plugins', did: () => 'listed the monitoring plugins (heard in your monitors, never rendered)' },
  add_monitoring_fx: { title: 'Add a monitoring plugin', did: (e) => `added ${plugin(paramsOf(e))} to the monitoring chain (heard in your monitors, never rendered)` },
  set_monitoring_fx: {
    title: 'Change a monitoring plugin',
    did: (e) => {
      const p = paramsOf(e);
      const state = p.enabled === false ? 'bypassed' : p.enabled === true ? 'enabled' : p.offline ? 'took offline' : 'changed';
      return `${state} monitoring plugin ${(num(p.fxIndex) ?? 0) + 1}`;
    },
  },
  remove_monitoring_fx: { title: 'Remove a monitoring plugin', did: (e) => `removed monitoring plugin ${(num(paramsOf(e).fxIndex) ?? 0) + 1}` },
  freeze_tracks: { title: 'Freeze tracks', did: (e) => `froze ${names(paramsOf(e).tracks) ?? 'tracks'}${str(paramsOf(e).mode) ? ` to ${paramsOf(e).mode}` : ''}, rendering their plugins to save CPU` },
  unfreeze_tracks: { title: 'Unfreeze tracks', did: (e) => `unfroze ${names(paramsOf(e).tracks) ?? 'tracks'}, bringing the plugins back live` },
  apply_fx_to_items: { title: 'Render plugins into items', did: (e) => `rendered the plugins into ${countOf(paramsOf(e).items, 'item', 'items')} as a new take (the old take stays)` },
  add_stretch_markers: { title: 'Add stretch markers', did: (e) => `added ${countOf(paramsOf(e).markers, 'stretch marker', 'stretch markers')} to ${item(paramsOf(e))} on ${on(e)}` },
  quantize_audio: { title: 'Quantize audio', did: (e) => `pulled the hits in ${item(paramsOf(e))} on ${on(e)} toward ${gridName(paramsOf(e).grid)} with stretch markers` },
};

const BOUNDS: Record<string, string> = { project: 'the whole project', time_selection: 'the time selection', regions: 'each region', selected_regions: 'the selected regions', custom: 'a custom range' };

/** How many tracks / rows a settings change touched, from what the bridge recorded */
function changedTracks(e: CommandEntry): string | null {
  const v = editViewOf(e);
  return v?.kind === 'changes' ? plural(new Set(v.rows.map((r) => r.t)).size, 'track') : null;
}
function changedRows(e: CommandEntry, word: string): string | null {
  const v = editViewOf(e);
  return v?.kind === 'changes' ? plural(v.rows.length + (v.more ?? 0), word) : null;
}

/** A send's other end and its level change, from the routing the bridge recorded: "up/down from −6.0 to −9.0 dB" */
function routeLevel(e: CommandEntry, kind: 's' | 'r' | 'h'): { other: string; change: string } | null {
  const v = editViewOf(e);
  const i = num(paramsOf(e).index);
  if (v?.kind !== 'routing' || i === undefined) return null;
  const now = v.routes.filter((r) => r[0] === kind)[i];
  const was = v.was?.filter((r) => r[0] === kind)[i];
  if (!now) return null;
  if (!was || Math.abs(was[2] - now[2]) < 0.05) return { other: now[1], change: `to ${fmt(now[2])} dB` };
  return { other: now[1], change: `${now[2] > was[2] ? 'up' : 'down'} from ${fmt(was[2])} to ${fmt(now[2])} dB` };
}

/** A plugin's name from the chain the bridge recorded: at `fxIndex` in the chain before the call, or after it */
function chainName(e: CommandEntry, when: 'was' | 'now'): string | null {
  const v = editViewOf(e);
  const i = num(paramsOf(e).fxIndex);
  if (v?.kind !== 'fxChain' || i === undefined) return null;
  const chain = v.chains[0];
  const slot = (when === 'was' ? chain?.was : chain?.fx)?.[i];
  return slot ? fxName(slot[0]) : null;
}

/** The envelope's own name ("Volume") when the bridge recorded it */
function envelopeName(e: CommandEntry): string | null {
  const v = editViewOf(e);
  return v?.kind === 'envelope' && v.env ? `the ${v.env} automation` : null;
}

/** The command's plain name; a command this page doesn't know (a newer bridge) reads as its own words */
export function toolTitle(c: string): string {
  const known = (TOOLS as Record<string, ToolInfo | undefined>)[c];
  if (known) return known.title;
  const words = c.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The drawer's first line, from the agent's side: who did what to what. A failed call says what was tried; the
 * error itself shows below it.
 */
export function summaryOf(e: CommandEntry, agent: string, ctx: { previous?: CommandEntry; now: number }): string {
  const title = toolTitle(e.c);
  const target = targetOf(e);
  const on = target ? ` on ${target}` : '';
  if (!e.ok) return `${agent} tried to ${lowerFirst(title)}${on}, ${outcomeOf(e) === 'refused' ? 'and REAPER refused' : 'and it failed'}.`;
  const did = (TOOLS as Record<string, ToolInfo | undefined>)[e.c]?.did?.(e, ctx);
  return `${agent} ${did ?? `ran “${lowerFirst(title)}”${on}`}.`;
}
