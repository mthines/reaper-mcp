/**
 * Composition tools: quantize and transform MIDI, import a MIDI file, detect the key and chords.
 *
 * quantize_midi / transform_midi — one bridge call each (logic in reaper/mcp_midi_lib.lua),
 *   one undo point, drawn on the bridge page as a before → after piano roll.
 * import_midi_file — the file is parsed here (smf.ts), so REAPER's import dialog never
 *   opens, and written in one bridge call.
 * detect_key — a 12-bin pitch-class profile from the track's MIDI notes (in Lua) or its
 *   rendered audio (sidecar chroma), or from an audio file; the key is picked here (key.ts).
 * detect_chords — one profile per bar or beat on the project grid (`_chord_grid`, in Lua: MIDI
 *   notes, or the segments the sidecar averages the rendered chroma over); chords picked here (chords.ts).
 *   With the opt-in chord model (`setup-sidecar --with-chords`, lv-chordia) audio goes to the sidecar's
 *   `chords` method instead, and its segments are mapped onto the same grid (engine "model").
 */

import { z } from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { trace } from '@opentelemetry/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RenderTrackToWavResult } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { getMidiNotesHistogram } from '../telemetry.js';
import { logToolResult } from '../tool-log.js';
import { estimateKey, type KeyEstimate } from '../key.js';
import { chordProfile, chordSpans, mergeSpans, modelPicks, progression, type ChordPick, type ChordSpan, type ModelSegment, type Segment } from '../chords.js';
import { parseSmf } from '../smf.js';
import { MAX_OFFLINE_SECONDS } from './offline.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const error = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/** Largest MIDI file import_midi_file reads. */
export const MAX_MIDI_FILE_BYTES = 5 * 1024 * 1024;
/** Most notes one import writes (mcp_midi_lib.lua checks the same). */
export const MAX_IMPORT_NOTES = 20_000;
/** Range of a track rendered for detect_key when no endTime is given (seconds). */
const DEFAULT_KEY_SECONDS = 60;
const renderTimeoutMs = (seconds: number) => 30_000 + seconds * 400;
/** The chord model runs at 2-5x real time on a CPU */
const chordModelTimeoutMs = (seconds: number) => 60_000 + seconds * 500;

const selectionSchema = {
  trackIndex: z.coerce.number().int().min(0).describe('Track index (0-based)'),
  itemIndex: z.coerce.number().int().min(0).describe('MIDI item index on the track (0-based, from list_midi_items)'),
  notes: z.array(z.coerce.number().int().min(0)).optional()
    .describe('Only these note indexes (from get_midi_notes); default: every note matching pitchMin/pitchMax/channel'),
  pitchMin: z.coerce.number().int().min(0).max(127).optional().describe('Only notes at or above this pitch'),
  pitchMax: z.coerce.number().int().min(0).max(127).optional().describe('Only notes at or below this pitch'),
  channel: z.coerce.number().int().min(0).max(15).optional().describe('Only notes on this MIDI channel (0-15; 9 = GM drums)'),
};

type Selection = { notes?: number[] } & Record<string, unknown>;

/** Nested values travel as JSON strings: the bridge decodes only flat params. */
function flatten(args: Selection, objects: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    out[k] = k === 'notes' || objects.includes(k) ? JSON.stringify(v) : v;
  }
  return out;
}

/** The size of an edit, on the tool's span and on reaper.midi.notes_changed. */
function recordNotes(tool: string, notesChanged: number): void {
  if (!Number.isFinite(notesChanged)) return;
  trace.getActiveSpan()?.setAttribute('reaper.midi.notes_changed', notesChanged);
  getMidiNotesHistogram().record(notesChanged, { 'gen_ai.tool.name': tool });
}

const removeQuietly = (path: string) => unlink(path).catch(() => {
  // Best-effort: the OS temp dir is cleaned eventually
});

/** detect_key: the numbers the page's key view draws */
export function keySummary(name: string | undefined, source: string, k: KeyEstimate): Record<string, unknown> {
  return {
    name,
    src: source,
    key: k.key,
    tonic: k.tonic,
    mode: k.mode,
    r: k.r,
    conf: k.confidence,
    rel: k.relative,
    alt: k.alternatives.map((a) => [a.key, a.r]),
    chroma: k.chroma,
  };
}

/** Most bars/beats one detect_chords call reads (mcp_midi_lib.lua and the sidecar check the same). */
const MAX_SEGMENTS = 4000;

/** What the internal `_chord_grid` command returns */
interface ChordGrid {
  startTime: number;
  endTime: number;
  segments: { start: number; end: number; bar: number; beat: number }[];
  profiles?: number[][];
  bass?: number[];
  notes?: number;
  midiItems?: number;
  itemsNotRead?: number;
}

/** A file's segments in seconds from its start: bars/beats at `bpm`, else fixed windows; null when too many. */
export function fileGrid(length: number, bpm: number | undefined, beatsPerBar: number, per: 'bar' | 'beat', windowSeconds: number):
  { start: number; end: number; bar?: number; beat?: number }[] | null {
  const step = bpm ? (60 / bpm) * (per === 'bar' ? beatsPerBar : 1) : windowSeconds;
  const count = Math.ceil(length / step - 1e-9);
  if (count > MAX_SEGMENTS) return null;
  return Array.from({ length: count }, (_, i) => ({
    start: i * step,
    end: Math.min((i + 1) * step, length),
    ...(bpm ? (per === 'bar' ? { bar: i + 1, beat: 1 } : { bar: Math.floor(i / beatsPerBar) + 1, beat: (i % beatsPerBar) + 1 }) : {}),
  }));
}

/** detect_chords: what the page's chord lane draws (the first 64 spans) */
export function chordsSummary(name: string | undefined, source: string, per: string, key: string,
  range: { startTime: number; endTime: number }, spans: ChordSpan[]): Record<string, unknown> {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    name,
    src: source,
    per,
    key,
    start: r2(range.startTime),
    end: r2(range.endTime),
    ch: spans.slice(0, 64).map((s) => [r2(s.start), r2(s.end), s.chord, s.roman ?? '']),
    ...(spans.length > 64 ? { more: spans.length - 64 } : {}),
  };
}

export function registerCompositionTools(server: McpServer): void {
  server.tool(
    'quantize_midi',
    'Quantize the notes of a MIDI item to the project grid (beats, not the item start): grid in beats (1 = quarter, ' +
    '0.5 = 8th, 0.25 = 16th, 1/3 = 8th triplet), strength 0..1 (partial moves keep feel), swing 0..0.9 (pushes every ' +
    'second grid line later), window 0..1 (only notes within that fraction of half the gap to the next line move; with swing the gaps are uneven, so the reach is (1 + swing) times half a step), lengths ' +
    '"keep" (default, notes move whole) or "quantize" (ends snap too). Acts on all notes or a selection (indexes, ' +
    'pitch range, channel). One undo point; a refused call changes nothing. Returns how many notes moved and the ' +
    'average and largest shift in beats.',
    {
      ...selectionSchema,
      grid: z.coerce.number().positive().max(16).describe('Grid in beats: 1 = quarter, 0.5 = 8th, 0.25 = 16th, 0.333 = 8th triplet'),
      strength: z.coerce.number().min(0).max(1).optional().describe('How far notes move toward the grid, 0..1 (default 1)'),
      swing: z.coerce.number().min(0).max(0.9).optional().describe('Off-beat delay as a fraction of a grid step, 0..0.9 (default 0)'),
      window: z.coerce.number().gt(0).max(1).optional().describe('Only move notes within this fraction of half the gap between lines, (1 + swing) half steps with swing (default 1 = all)'),
      lengths: z.enum(['keep', 'quantize']).optional().describe('keep (default): notes keep their length; quantize: note ends snap too'),
    },
    async (args) => {
      const res = await sendCommand('quantize_midi', flatten(args));
      if (!res.success) return error(`Error: ${res.error}`);
      recordNotes('quantize_midi', Number((res.data as { moved?: number }).moved));
      return text(res.data);
    },
  );

  server.tool(
    'transform_midi',
    'Transform the notes of a MIDI item in one undo point: transpose (semitones, refused if any note would leave ' +
    '0-127), velocity (set, scale, add, then clamp to min/max), humanize (random timing in beats and velocity, ' +
    'reproducible with seed), length (set in beats, scale, or legato = each note runs to the next selected note on its ' +
    'channel). Acts on all notes or a selection (indexes, pitch range, channel). Returns how many notes it acted on, ' +
    'velocities before/after and the humanize seed.',
    {
      ...selectionSchema,
      transpose: z.coerce.number().int().min(-48).max(48).optional().describe('Semitones up (+) or down (-)'),
      velocity: z.object({
        set: z.coerce.number().int().min(1).max(127).optional().describe('Every velocity becomes this'),
        scale: z.coerce.number().min(0).max(4).optional().describe('Multiply velocities (0.8 = softer, 1.2 = harder)'),
        add: z.coerce.number().int().min(-126).max(126).optional().describe('Add to velocities'),
        min: z.coerce.number().int().min(1).max(127).optional().describe('Clamp: lowest velocity (default 1)'),
        max: z.coerce.number().int().min(1).max(127).optional().describe('Clamp: highest velocity (default 127)'),
      }).optional(),
      humanize: z.object({
        timingBeats: z.coerce.number().min(0).max(0.25).optional().describe('Random start shift up to ± this many beats (0.02 ≈ subtle)'),
        velocity: z.coerce.number().int().min(0).max(64).optional().describe('Random velocity change up to ± this'),
        seed: z.coerce.number().int().optional().describe('Seed: the same seed gives the same result (default 1)'),
      }).optional(),
      length: z.object({
        set: z.coerce.number().positive().max(64).optional().describe('Every note this many beats long'),
        scale: z.coerce.number().positive().max(8).optional().describe('Multiply lengths (0.5 = staccato)'),
        legato: z.boolean().optional().describe('Each note runs to the start of the next selected note on its channel (unselected notes are not counted)'),
      }).optional(),
    },
    async (args) => {
      const res = await sendCommand('transform_midi', flatten(args, ['velocity', 'humanize', 'length']));
      if (!res.success) return error(`Error: ${res.error}`);
      recordNotes('transform_midi', Number((res.data as { notes?: number }).notes));
      return text(res.data);
    },
  );

  server.tool(
    'import_midi_file',
    'Import a Standard MIDI File (.mid/.midi, type 0 or 1, up to 5 MB and 20000 notes) as MIDI items, without ' +
    'REAPER\'s import dialog: notes and controllers of every file track merged into one item on trackIndex, or ' +
    'with newTracks each file track on a new track named after it, inserted at trackIndex. Placed at position ' +
    '(seconds) on the project grid; the file\'s tempo is reported, not applied (set it with set_project_tempo). ' +
    'Pitch bend, program changes, aftertouch and sysex are not imported; file.notImported counts them. ' +
    'One undo point.',
    {
      path: z.string().min(1).describe('Absolute path of the .mid/.midi file'),
      trackIndex: z.coerce.number().int().min(0).default(0)
        .describe('Track to put the item on, or with newTracks where the new tracks are inserted'),
      newTracks: z.boolean().optional().describe('One new named track per file track (default: merge onto trackIndex)'),
      position: z.coerce.number().min(0).default(0).describe('Project time in seconds where the file starts (default 0)'),
    },
    async (args) => {
      const ext = extname(args.path).toLowerCase();
      if (ext !== '.mid' && ext !== '.midi') return error(`Not a MIDI file: ${basename(args.path)} (expected .mid or .midi)`);
      let bytes: Buffer;
      try {
        const info = await stat(args.path);
        if (info.size > MAX_MIDI_FILE_BYTES) return error(`File too large: ${info.size} bytes (max ${MAX_MIDI_FILE_BYTES})`);
        bytes = await readFile(args.path);
      } catch (err) {
        return error(`Cannot read ${args.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
      let smf;
      try {
        smf = parseSmf(new Uint8Array(bytes));
      } catch (err) {
        return error(`Cannot import ${basename(args.path)}: ${err instanceof Error ? err.message : String(err)} — nothing changed`);
      }
      const total = smf.tracks.reduce((n, t) => n + t.notes.length, 0);
      if (smf.tracks.length === 0) return error(`${basename(args.path)} holds no notes or controllers — nothing changed`);
      if (total > MAX_IMPORT_NOTES) return error(`${basename(args.path)} has ${total} notes; at most ${MAX_IMPORT_NOTES} per import — nothing changed`);
      const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
      const tracks = smf.tracks.map((t) => ({
        name: t.name,
        notes: t.notes.map((n) => [r6(n.start), r6(n.length), n.channel, n.pitch, n.velocity]),
        cc: t.cc.map((c) => [r6(c.time), c.channel, c.cc, c.value]),
      }));
      const res = await sendCommand('import_midi_file', {
        trackIndex: args.trackIndex,
        newTracks: args.newTracks ?? false,
        position: args.position,
        lengthQN: Math.max(smf.lengthQN, 1 / smf.ppq),
        name: basename(args.path),
        tracks: JSON.stringify(tracks),
      }, 60_000);
      if (!res.success) return error(`Error: ${res.error}`);
      recordNotes('import_midi_file', total);
      return text({
        ...(res.data as object),
        file: {
          name: basename(args.path),
          format: smf.format,
          ppq: smf.ppq,
          tracks: smf.tracks.length,
          notes: total,
          tempo: smf.tempo,
          tempoChanges: smf.tempoChanges,
          timeSignature: smf.timeSignature,
          // Pitch bend, program changes, aftertouch and sysex are not imported: say how many were left out
          ...(Object.keys(smf.skipped).length ? { notImported: smf.skipped } : {}),
        },
        ...(smf.tempo !== null ? { note: 'The file tempo was not applied; set it with set_project_tempo if wanted.' } : {}),
      });
    },
  );

  server.tool(
    'detect_key',
    'Detect the musical key (e.g. "A minor") of a track or an audio file: from a track\'s MIDI notes (note time ' +
    'weighted by velocity, drums on channel 10 ignored) or, for audio, from its rendered chroma (Python sidecar). ' +
    'Returns the key, confidence 0..1 (how far it stands out from the next candidate that is not its relative ' +
    'key, scaled down for a flat profile and by how well the key fits — its correlation), the relative key, the top 3 alternatives with their correlation, and the 12-bin chroma (C first). ' +
    'Use it before writing parts, choosing a pitch-correction scale or a harmonizer key.',
    {
      trackIndex: z.coerce.number().int().min(-1).optional().describe('Track to analyze (-1 = master). Give this or path'),
      path: z.string().min(1).optional().describe('Absolute path of an audio file to analyze instead (sidecar)'),
      itemIndex: z.coerce.number().int().min(0).optional()
        .describe('Only the time this media item covers on trackIndex (from list_media_items); instead of startTime/endTime. Audio renders the whole track over it'),
      source: z.enum(['auto', 'midi', 'audio']).optional().default('auto')
        .describe('For a track: midi (its MIDI notes), audio (render it), auto (default: MIDI notes when it has any, else audio)'),
      startTime: z.coerce.number().min(0).optional().describe('Start of the range in seconds (project time for a track, file time for a file; default 0)'),
      endTime: z.coerce.number().min(0).optional()
        .describe(`End of the range in seconds (track audio default: start + ${DEFAULT_KEY_SECONDS} s; MIDI and file default: the end)`),
    },
    async (args) => {
      const startedAt = Date.now();
      const fail = (message: string) => {
        logToolResult('detect_key', args, startedAt, null, message);
        return error(message);
      };
      try {
        const { trackIndex, path } = args;
        if ((trackIndex == null) === (path == null)) return fail('Give exactly one of trackIndex or path');
        if (args.itemIndex != null) {
          if (trackIndex == null || trackIndex < 0) return fail('itemIndex needs a trackIndex of 0 or more (the master holds no items)');
          if (args.startTime != null || args.endTime != null) return fail('Give itemIndex or startTime/endTime, not both');
          const range = await sendCommand('_item_range' as Parameters<typeof sendCommand>[0], { trackIndex, itemIndex: args.itemIndex });
          if (!range.success) return fail(`Error: ${range.error}`);
          const r = range.data as { startTime: number; endTime: number };
          args.startTime = r.startTime;
          args.endTime = r.endTime;
        }
        const start = args.startTime ?? 0;
        if (args.endTime != null && args.endTime <= start) return fail('endTime must be greater than startTime');
        if (trackIndex === -1 && args.source === 'midi') return fail('The master track holds no MIDI notes: give a track index, or source "audio"');
        let profile: number[] | null = null;
        let source: 'midi' | 'audio' | 'file';
        let name: string | undefined;
        let extra: Record<string, unknown> = {};

        if (path == null && args.source !== 'audio' && (trackIndex as number) >= 0) {
          // Internal command: not a tool, so not a CommandType (like tool-log's _log_result)
          const res = await sendCommand('_midi_pitch_profile' as Parameters<typeof sendCommand>[0], {
            trackIndex: trackIndex as number,
            startTime: start,
            ...(args.endTime != null ? { endTime: args.endTime } : {}),
          });
          if (!res.success) return fail(`Error: ${res.error}`);
          const p = res.data as { chroma: number[]; notes: number; midiItems: number; audioItems: number; itemsNotRead?: number };
          if (p.notes > 0) {
            profile = p.chroma;
            extra = { notes: p.notes, midiItems: p.midiItems, ...(p.itemsNotRead ? { itemsNotRead: p.itemsNotRead } : {}) };
          } else if (args.source === 'midi') {
            return fail(`Track ${trackIndex} has no MIDI notes in the range (drums on channel 10 are ignored)`);
          }
        }
        if (profile) {
          source = 'midi';
        } else {
          const sidecar = getSidecarClient();
          if (!sidecar.isAvailable()) {
            return fail('Audio key detection needs the Python sidecar. Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar');
          }
          if (path != null) {
            const c = await sidecar.chroma({ path, ...(start > 0 ? { startTime: start } : {}), ...(args.endTime != null ? { endTime: args.endTime } : {}) });
            profile = c.chroma;
            source = 'file';
            name = basename(path);
            extra = { durationSeconds: c.durationSeconds };
          } else {
            const end = args.endTime ?? start + DEFAULT_KEY_SECONDS;
            if (end - start > MAX_OFFLINE_SECONDS) return fail(`Range too long: max ${MAX_OFFLINE_SECONDS} s per call`);
            const res = await sendCommand(
              'render_track_to_wav',
              { trackIndex: trackIndex as number, startTime: start, endTime: end, commandId: randomUUID() },
              renderTimeoutMs(end - start),
            );
            if (!res.success) return fail(`Render failed: ${res.error}`);
            const wav = res.data as RenderTrackToWavResult;
            try {
              const c = await sidecar.chroma({ path: wav.wavPath });
              profile = c.chroma;
              extra = { durationSeconds: c.durationSeconds };
            } finally {
              await removeQuietly(wav.wavPath);
            }
            source = 'audio';
            name = wav.trackName;
          }
        }

        const k = estimateKey(profile);
        if (!k) return fail('No pitched content found in the range (silence, or only drums/noise)');
        const span = trace.getActiveSpan();
        span?.setAttribute('reaper.key.source', source);
        span?.setAttribute('reaper.key.confidence', k.confidence);
        logToolResult('detect_key', args, startedAt, keySummary(name, source, k));
        return text({
          ...(trackIndex != null ? { trackIndex } : { path }),
          ...(name ? { name } : {}),
          source,
          ...k,
          ...extra,
          ...(k.confidence < 0.25 ? { hint: 'Low confidence: the music may be modal, atonal, change key, or the range too short. Try a longer or other section.' } : {}),
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'detect_chords',
    'Detect the chords of a track, one media item or an audio file, one per bar (default) or beat: from MIDI notes ' +
    '(drums on channel 10 ignored; the lowest held note gives slash chords like C/E) or from rendered audio (Python ' +
    'sidecar chroma). Track bars and beats follow the project tempo map; a file uses `bpm` (bar 1 at startTime) or ' +
    'fixed windows. Returns the key, the progression ("Am F C G"), and chord spans (equal neighbours merged): ' +
    'start/end seconds, bar.beat, chord, root, quality (maj, min, 7, maj7, m7, sus2, sus4, dim, aug; the model also dim7, m7b5, 6, m6, 9, maj9, m9, mMaj7, 5, 11, 13), ' +
    'roman numeral in the key, bassMidi (a MIDI note for a bass line, E1-D#2) and a 0..1 fit; "N" = no chord. Paginated (offset/limit). ' +
    'Audio uses the chord model (lv-chordia, slash chords and sevenths from a full mix) when installed (setup-sidecar --with-chords), ' +
    'else chroma templates; `engine` picks. ' +
    'Use it before writing a bass line or other parts to existing guitars, keys or vocals.',
    {
      trackIndex: z.coerce.number().int().min(-1).optional().describe('Track to analyze (-1 = master, audio only). Give this or path'),
      path: z.string().min(1).optional().describe('Absolute path of an audio file to analyze instead (sidecar)'),
      itemIndex: z.coerce.number().int().min(0).optional()
        .describe('Only the time this media item covers on trackIndex (from list_media_items); instead of startTime/endTime. Audio renders the whole track over it'),
      source: z.enum(['auto', 'midi', 'audio']).optional().default('auto')
        .describe('For a track: midi (its MIDI notes), audio (render it), auto (default: MIDI notes when it has any, else audio)'),
      per: z.enum(['bar', 'beat']).optional().default('bar').describe('One chord per bar (default) or per beat'),
      engine: z.enum(['auto', 'model', 'template']).optional().default('auto')
        .describe('Audio: model (the chord model, setup-sidecar --with-chords; also renders a MIDI track), template (chroma templates), auto (default: the model when installed). MIDI notes always use templates'),
      startTime: z.coerce.number().min(0).optional().describe('Start of the range in seconds (project time for a track, file time for a file; default 0)'),
      endTime: z.coerce.number().min(0).optional()
        .describe(`End of the range in seconds (default: where the track's last item ends, the project end on the master, the file's end; max ${MAX_OFFLINE_SECONDS} s for audio)`),
      bpm: z.coerce.number().min(30).max(300).optional().describe('File only: its tempo, so segments are bars/beats from startTime'),
      beatsPerBar: z.coerce.number().int().min(1).max(16).optional().default(4).describe('File only, with bpm: beats per bar (default 4)'),
      windowSeconds: z.coerce.number().min(0.25).max(16).optional().default(2).describe('File only, without bpm: one chord per this many seconds (default 2)'),
      offset: z.coerce.number().int().min(0).optional().default(0).describe('First chord span to return (pagination)'),
      limit: z.coerce.number().int().min(1).max(256).optional().default(64).describe('Most chord spans to return (default 64, max 256)'),
    },
    async (args) => {
      const startedAt = Date.now();
      const fail = (message: string) => {
        logToolResult('detect_chords', args, startedAt, null, message);
        return error(message);
      };
      try {
        const { trackIndex, path } = args;
        const per = args.per ?? 'bar';
        const offset = args.offset ?? 0;
        const limit = args.limit ?? 64;
        const windowSeconds = args.windowSeconds ?? 2;
        if ((trackIndex == null) === (path == null)) return fail('Give exactly one of trackIndex or path');
        if (args.itemIndex != null) {
          if (trackIndex == null || trackIndex < 0) return fail('itemIndex needs a trackIndex of 0 or more (the master holds no items)');
          if (args.startTime != null || args.endTime != null) return fail('Give itemIndex or startTime/endTime, not both');
        }
        if (args.endTime != null && args.endTime <= (args.startTime ?? 0)) return fail('endTime must be greater than startTime');
        if (trackIndex === -1 && args.source === 'midi') return fail('The master track holds no MIDI notes: give a track index, or source "audio"');
        const engineArg = args.engine ?? 'auto';
        if (engineArg === 'model' && args.source === 'midi') return fail('engine "model" reads audio: use source "audio" (or "auto"), or engine "template" for MIDI notes');

        let segments: Segment[] = [];
        let profile: number[] = [];
        let source: 'midi' | 'audio' | 'file';
        let name: string | undefined;
        let range: { startTime: number; endTime: number };
        let extra: Record<string, unknown> = {};
        let picks: ChordPick[] | null = null;
        let engine: 'model' | 'template' = 'template';
        let modelMissing = false;
        const sidecar = getSidecarClient();
        const needSidecar = () => fail('Audio chord detection needs the Python sidecar. Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar');
        /** Whether audio goes to the chord model; a string is the error for engine "model" without it. */
        const useModel = async (): Promise<boolean | string> => {
          if (engineArg === 'template') return false;
          const status = await Promise.resolve().then(() => sidecar.chordsStatus()).catch(() => ({ installed: false, message: 'The chord model is not installed. Run: reaper-mcp setup-sidecar --with-chords' }));
          if (status.installed) return true;
          if (engineArg === 'model') return status.message;
          modelMissing = true;
          return false;
        };
        /** The model's chords for a file range, as picks on the grid (seconds from `fileStart`) and a key profile. */
        const runModel = async (file: string, fileStart: number, fileEnd: number | undefined, grid: { start: number; end: number }[], seconds: number) => {
          const res = await sidecar.chords(
            { path: file, ...(fileStart > 0 ? { startTime: fileStart } : {}), ...(fileEnd != null ? { endTime: fileEnd } : {}) },
            chordModelTimeoutMs(seconds),
          );
          const model: ModelSegment[] = res.segments.map((m) => ({ ...m, start: m.start - fileStart, end: m.end - fileStart }));
          engine = 'model';
          extra = { ...extra, modelSeconds: res.seconds };
          return { picks: modelPicks(grid, model), profile: chordProfile(model), duration: res.durationSeconds };
        };

        if (path != null) {
          if (!sidecar.isAvailable()) return needSidecar();
          const start = args.startTime ?? 0;
          const end = args.endTime ?? start + MAX_OFFLINE_SECONDS;
          if (end - start > MAX_OFFLINE_SECONDS) return fail(`Range too long: max ${MAX_OFFLINE_SECONDS} s per call`);
          const grid = fileGrid(end - start, args.bpm, args.beatsPerBar ?? 4, per, windowSeconds);
          if (!grid) return fail(`More than ${MAX_SEGMENTS} segments: use a shorter range, per "bar" or a longer windowSeconds`);
          const model = await useModel();
          if (typeof model === 'string') return fail(model);
          if (model) {
            const m = await runModel(path, start, args.endTime, grid, end - start);
            const dur = m.duration;
            const kept = grid.map((g, i) => ({ g, p: m.picks[i] })).filter(({ g }) => g.start < dur - 1e-6);
            segments = kept.map(({ g }) => ({ ...g, start: start + g.start, end: start + Math.min(g.end, dur), profile: [] }));
            picks = kept.map(({ p }) => p);
            profile = m.profile;
            source = 'file';
            name = basename(path);
            range = { startTime: start, endTime: start + dur };
          } else {
          const c = await sidecar.chroma({
            path, ...(start > 0 ? { startTime: start } : {}), ...(args.endTime != null ? { endTime: args.endTime } : {}),
            segments: grid.map((g) => [g.start, g.end]),
          });
          const dur = c.durationSeconds;
          segments = grid.filter((g) => g.start < dur - 1e-6).map((g, i) => ({
            ...g, start: start + g.start, end: start + Math.min(g.end, dur), profile: c.segments?.[i] ?? [],
          }));
          profile = c.chroma;
          source = 'file';
          name = basename(path);
          range = { startTime: start, endTime: start + dur };
          }
        } else {
          const useMidi = args.source !== 'audio' && engineArg !== 'model' && (trackIndex as number) >= 0;
          const res = await sendCommand('_chord_grid' as Parameters<typeof sendCommand>[0], {
            trackIndex: trackIndex as number,
            per,
            midi: useMidi,
            ...(args.itemIndex != null ? { itemIndex: args.itemIndex } : {}),
            ...(args.startTime != null ? { startTime: args.startTime } : {}),
            ...(args.endTime != null ? { endTime: args.endTime } : {}),
          });
          if (!res.success) return fail(`Error: ${res.error}`);
          const g = res.data as ChordGrid;
          range = { startTime: g.startTime, endTime: g.endTime };
          if (useMidi && (g.notes ?? 0) > 0 && g.profiles) {
            segments = g.segments.map((s, i) => ({ ...s, profile: g.profiles?.[i] ?? [], bass: g.bass?.[i] }));
            profile = Array.from({ length: 12 }, (_, k) => segments.reduce((a, s) => a + (s.profile[k] ?? 0), 0));
            source = 'midi';
            extra = { notes: g.notes, midiItems: g.midiItems, ...(g.itemsNotRead ? { itemsNotRead: g.itemsNotRead } : {}) };
          } else {
            if (args.source === 'midi') return fail(`Track ${trackIndex} has no MIDI notes in the range (drums on channel 10 are ignored)`);
            if (!sidecar.isAvailable()) return needSidecar();
            const { startTime: start, endTime: end } = range;
            if (end - start > MAX_OFFLINE_SECONDS) return fail(`Range too long: max ${MAX_OFFLINE_SECONDS} s per call (give startTime/endTime)`);
            const model = await useModel();
            if (typeof model === 'string') return fail(model);
            const r = await sendCommand(
              'render_track_to_wav',
              { trackIndex: trackIndex as number, startTime: start, endTime: end, commandId: randomUUID() },
              renderTimeoutMs(end - start),
            );
            if (!r.success) return fail(`Render failed: ${r.error}`);
            const wav = r.data as RenderTrackToWavResult;
            try {
              const relative = g.segments.map((s) => ({ start: s.start - start, end: s.end - start }));
              if (model) {
                const m = await runModel(wav.wavPath, 0, undefined, relative, end - start);
                segments = g.segments.map((s) => ({ ...s, profile: [] }));
                picks = m.picks;
                profile = m.profile;
              } else {
                const c = await sidecar.chroma({ path: wav.wavPath, segments: relative.map((s) => [s.start, s.end]) });
                segments = g.segments.map((s, i) => ({ ...s, profile: c.segments?.[i] ?? [] }));
                profile = c.chroma;
              }
            } finally {
              await removeQuietly(wav.wavPath);
            }
            source = 'audio';
            name = wav.trackName;
          }
        }

        const key = estimateKey(profile);
        if (!key) return fail('No pitched content found in the range (silence, or only drums/noise)');
        const spans = picks ? mergeSpans(segments, picks, key) : chordSpans(segments, key);
        const page = spans.slice(offset, offset + limit);
        const chords = spans.filter((s) => s.chord !== 'N');
        const fit = chords.length ? chords.reduce((a, s) => a + s.score * s.length, 0) / chords.reduce((a, s) => a + s.length, 0) : 0;
        trace.getActiveSpan()?.setAttribute('reaper.chords.source', source);
        trace.getActiveSpan()?.setAttribute('reaper.chords.count', spans.length);
        trace.getActiveSpan()?.setAttribute('reaper.chords.engine', engine);
        logToolResult('detect_chords', args, startedAt, chordsSummary(name, source, per, key.key, range, spans));
        return text({
          ...(trackIndex != null ? { trackIndex } : { path }),
          ...(args.itemIndex != null ? { itemIndex: args.itemIndex } : {}),
          ...(name ? { name } : {}),
          source,
          engine,
          per: path != null && args.bpm == null ? `${windowSeconds} s` : per,
          ...range,
          key: { key: key.key, confidence: key.confidence, relative: key.relative },
          progression: progression(spans),
          total: spans.length,
          offset,
          hasMore: offset + page.length < spans.length,
          chords: page,
          ...extra,
          ...(modelMissing ? { modelHint: 'Audio read with chroma templates. For full mixes, sevenths and inversions install the chord model: reaper-mcp setup-sidecar --with-chords (~135 MB)' } : {}),
          ...(engine === 'template' && fit > 0 && fit < 0.75 ? { hint: 'Loose fit: the part may be a melody or riff more than chords, or drums/noise are in the mix. On a mix, try separate_stems first, or per "bar".' } : {}),
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
