/**
 * Transient tools: find the hits in a track or an audio file, and turn them into
 * automation (e.g. lighting that flashes on the kicks and snares).
 *
 * detect_transients           — onset times with a 0..1 strength, the band that
 *                               dominates each hit (low/mid/high) and a tempo estimate.
 * create_transient_automation — detect, then write one pulse per hit (attack, hold,
 *                               decay) onto an existing track envelope.
 *
 * Detection runs in the Python sidecar (spectral flux per band, no model). A track
 * is rendered first (post-FX, like analyze_track_offline); a file is read directly,
 * so a song that is not in the project yet works too. Writing goes through the
 * bridge's insert_envelope_points, so no handler of its own is needed.
 */

import { z } from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RenderTrackToWavResult } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { logToolResult } from '../tool-log.js';
import { MAX_OFFLINE_SECONDS } from './offline.js';

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

/** Default range rendered from a track when no endTime is given (seconds). */
const DEFAULT_TRACK_SECONDS = 60;
const DEFAULT_LIMIT = 200;
/** Most points one create_transient_automation call writes. */
export const MAX_AUTOMATION_POINTS = 20_000;
/** Gap left between a cut-short pulse and the next hit (seconds). */
const CUT_GAP = 0.0005;
const renderTimeoutMs = (seconds: number) => 30_000 + seconds * 400;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const error = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });
const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

export interface Transient {
  time: number;
  strength: number;
  band: 'low' | 'mid' | 'high';
  peakDb?: number | null;
}

export interface PulseOptions {
  baseValue: number;
  peakValue: number;
  scaleByStrength: boolean;
  attackMs: number;
  holdMs: number;
  decayMs: number;
  /** REAPER point shape of the decay segment (0 linear, 3 fast start ≈ exponential) */
  decayShape: number;
}

export interface EnvelopePoint {
  time: number;
  value: number;
  shape: number;
}

const SHAPE_LINEAR = 0;
const SHAPE_SQUARE = 1;

/**
 * One pulse per hit: base at the attack start, the hit's level at the hit, held,
 * then back to base. The envelope sits at base between pulses (square points, so
 * a hit with no attack jumps up). A hit before the previous pulse has ended cuts
 * it short at its current level: the latest hit wins.
 */
export function pulsePoints(hits: Transient[], o: PulseOptions, rangeStart: number): EnvelopePoint[] {
  const attack = o.attackMs / 1000;
  const hold = o.holdMs / 1000;
  const decay = o.decayMs / 1000;
  const sorted = [...hits].sort((a, b) => a.time - b.time);
  const points: EnvelopePoint[] = [];
  if (sorted.length === 0) return points;
  const first = Math.max(0, Math.min(rangeStart, sorted[0].time - attack - CUT_GAP));
  points.push({ time: round(first), value: o.baseValue, shape: SHAPE_SQUARE });

  sorted.forEach((hit, i) => {
    const level = o.baseValue + (o.peakValue - o.baseValue) * (o.scaleByStrength ? hit.strength : 1);
    const pulse: EnvelopePoint[] = [];
    if (attack > 0) pulse.push({ time: hit.time - attack, value: o.baseValue, shape: SHAPE_LINEAR });
    if (hold > 0) pulse.push({ time: hit.time, value: level, shape: SHAPE_LINEAR });
    pulse.push({ time: hit.time + hold, value: level, shape: decay > 0 ? o.decayShape : SHAPE_SQUARE });
    if (decay > 0) pulse.push({ time: hit.time + hold + decay, value: o.baseValue, shape: SHAPE_SQUARE });

    const next = sorted[i + 1];
    const cut = next ? next.time - attack - CUT_GAP : Infinity;
    const kept = pulse.filter((p) => p.time < cut);
    const last = kept[kept.length - 1];
    if (kept.length < pulse.length && last && last.value !== o.baseValue) {
      // Hold the level reached at the cut until the next hit takes over
      const after = pulse[kept.length];
      const t = (cut - last.time) / (after.time - last.time);
      const value = last.value + (after.value - last.value) * Math.min(1, Math.max(0, t));
      kept.push({ time: cut, value, shape: SHAPE_SQUARE });
    } else if (kept.length < pulse.length && last) {
      last.shape = SHAPE_SQUARE;
    }
    for (const p of kept) points.push({ time: round(p.time), value: round(p.value, 6), shape: p.shape });
  });
  return points;
}

/** Hits per section of the range: how busy each part of the song is. */
function sections(hits: Transient[], start: number, end: number, seconds: number) {
  const out: { start: number; end: number; count: number; meanStrength: number | null }[] = [];
  for (let s = start; s < end; s += seconds) {
    const e = Math.min(end, s + seconds);
    const inside = hits.filter((h) => h.time >= s && h.time < e);
    out.push({
      start: round(s, 2),
      end: round(e, 2),
      count: inside.length,
      meanStrength: inside.length ? round(inside.reduce((a, h) => a + h.strength, 0) / inside.length, 3) : null,
    });
  }
  return out;
}

const removeQuietly = (path: string) => unlink(path).catch(() => {
  // Best-effort: the OS temp dir is cleaned eventually
});

const sourceSchema = {
  trackIndex: z.coerce.number().int().min(-1).optional()
    .describe('Track to analyze, rendered post-FX (-1 = master). Give this or path'),
  path: z.string().min(1).optional()
    .describe('Absolute path of an audio file (WAV/FLAC/AIFF/MP3/OGG) to analyze instead of a track. Read as-is: an item\'s stretch markers, play rate and start offset are NOT applied, so for a warped or stretched item use trackIndex (renders what REAPER plays)'),
  filePosition: z.coerce.number().min(0).optional()
    .describe('With path: project time (seconds) where the file starts, e.g. its item position (default 0), so times come back in project time'),
  startTime: z.coerce.number().min(0).optional()
    .describe('Start of the range in project seconds (default 0, or filePosition for a file)'),
  endTime: z.coerce.number().min(0).optional()
    .describe(`End of the range in project seconds (track default: start + ${DEFAULT_TRACK_SECONDS} s; file default: end of file)`),
  band: z.enum(['full', 'low', 'mid', 'high']).optional().default('full')
    .describe('Band to find hits in: full (all, default), low (<150 Hz: kick, bass), mid (150 Hz-4 kHz: snare, vocals, keys), high (>4 kHz: hats, cymbals)'),
  sensitivity: z.coerce.number().min(0).max(1).optional().default(0.5)
    .describe('0..1 (default 0.5): higher finds softer hits, lower keeps only the big ones'),
  minGapMs: z.coerce.number().min(5).max(2000).optional().default(50)
    .describe('Closest two hits may be, in ms (default 50); raise it (e.g. 250) for fewer, beat-level hits'),
  minStrength: z.coerce.number().min(0).max(1).optional().default(0)
    .describe('Drop hits weaker than this (0..1 relative to the loudest hits; e.g. 0.6 keeps the accents)'),
  bands: z.array(z.enum(['low', 'mid', 'high'])).optional()
    .describe('Keep only hits whose dominant band is one of these (e.g. ["low"] for kick-driven flashes)'),
};

type SourceArgs = {
  trackIndex?: number;
  path?: string;
  filePosition?: number;
  startTime?: number;
  endTime?: number;
  band?: 'full' | 'low' | 'mid' | 'high';
  sensitivity?: number;
  minGapMs?: number;
  minStrength?: number;
  bands?: ('low' | 'mid' | 'high')[];
};

interface Detection {
  source: Record<string, unknown>;
  start: number;
  end: number | null;
  durationSeconds: number;
  tempo: unknown;
  /** Before minStrength / bands */
  detected: number;
  bandCounts: unknown;
  hits: Transient[];
}

/** Render or read the source, detect in the sidecar, return hits in project time (filtered). */
async function detect(args: SourceArgs): Promise<Detection | string> {
  const sidecar = getSidecarClient();
  if (!sidecar.isAvailable()) return SIDECAR_NOT_INSTALLED_MSG;
  const { trackIndex, path } = args;
  if ((trackIndex == null) === (path == null)) return 'Give exactly one of trackIndex or path';
  const options = {
    band: args.band ?? 'full',
    sensitivity: args.sensitivity ?? 0.5,
    minGapMs: args.minGapMs ?? 50,
  };

  let result: Record<string, unknown>;
  let start: number;
  let end: number | null;
  let source: Record<string, unknown>;
  if (path != null) {
    const position = args.filePosition ?? 0;
    start = args.startTime ?? position;
    end = args.endTime ?? null;
    if (start < position) return `startTime ${start} is before the file starts (filePosition ${position})`;
    if (end != null && end <= start) return 'endTime must be greater than startTime';
    result = await sidecar.transients({
      path,
      ...(start > position ? { startTime: start - position } : {}),
      ...(end != null ? { endTime: end - position } : {}),
      ...options,
    });
    // The sidecar's times are seconds into the file
    for (const t of (result['transients'] as Transient[] | undefined) ?? []) t.time = round(t.time + position);
    source = { path, filePosition: position };
  } else {
    start = args.startTime ?? 0;
    end = args.endTime ?? start + DEFAULT_TRACK_SECONDS;
    if (end <= start) return 'endTime must be greater than startTime';
    if (end - start > MAX_OFFLINE_SECONDS) return `Range too long: max ${MAX_OFFLINE_SECONDS} s per call`;
    const res = await sendCommand(
      'render_track_to_wav',
      { trackIndex: trackIndex as number, startTime: start, endTime: end, commandId: randomUUID() },
      renderTimeoutMs(end - start),
    );
    if (!res.success) return `Render failed: ${res.error}`;
    const wav = res.data as RenderTrackToWavResult;
    try {
      result = await sidecar.transients({ path: wav.wavPath, ...options });
    } finally {
      await removeQuietly(wav.wavPath);
    }
    // The render starts at `start`
    for (const t of (result['transients'] as Transient[] | undefined) ?? []) t.time = round(t.time + start);
    source = { trackIndex, trackName: wav.trackName };
  }

  const all = (result['transients'] as Transient[] | undefined) ?? [];
  const keep = new Set(args.bands ?? ['low', 'mid', 'high']);
  const hits = all.filter((t) => t.strength >= (args.minStrength ?? 0) && keep.has(t.band));
  const durationSeconds = Number(result['durationSeconds'] ?? 0);
  return {
    source,
    start,
    end: end ?? round(start + durationSeconds, 3),
    durationSeconds,
    tempo: result['tempo'],
    detected: all.length,
    bandCounts: result['bandCounts'],
    hits,
  };
}

export function registerTransientTools(server: McpServer): void {
  server.tool(
    'detect_transients',
    'Find the transients (hits/onsets) in a track (rendered post-FX, -1 = master) or an audio file on disk: each hit\'s ' +
    'time in project seconds, strength (0..1, relative to the loudest hits), dominant band (low = kick/bass, ' +
    'mid = snare/vocals/keys, high = hats/cymbals) and peakDb, plus a tempo estimate, hit counts per band and, ' +
    'with sectionSeconds, how busy each part is. Hits are paginated (offset/limit). Use it to sync lighting, video ' +
    'cuts, markers or MIDI to a song; create_transient_automation writes the hits as envelope pulses directly. ' +
    'A file is read as-is (no stretch markers or play rate): for an item warped to the grid, pass its track instead. ' +
    'Requires the Python sidecar.',
    {
      ...sourceSchema,
      sectionSeconds: z.coerce.number().min(1).max(120).optional()
        .describe('Also report hit count and mean strength per section of this length (e.g. 8)'),
      offset: z.coerce.number().int().min(0).optional().default(0).describe('First hit to return (default 0)'),
      limit: z.coerce.number().int().min(0).max(2000).optional().default(DEFAULT_LIMIT)
        .describe(`Most hits to return (default ${DEFAULT_LIMIT}; 0 = summary only)`),
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const d = await detect(args);
        if (typeof d === 'string') {
          logToolResult('detect_transients', args, startedAt, null, d);
          return error(d);
        }
        const offset = args.offset ?? 0;
        const limit = args.limit ?? DEFAULT_LIMIT;
        const page = d.hits.slice(offset, offset + limit);
        logToolResult('detect_transients', args, startedAt, null);
        return text({
          ...d.source,
          startTime: d.start,
          endTime: d.end,
          band: args.band ?? 'full',
          tempo: d.tempo,
          detected: d.detected,
          bandCounts: d.bandCounts,
          total: d.hits.length,
          ...(args.sectionSeconds && d.end != null ? { sections: sections(d.hits, d.start, d.end, args.sectionSeconds) } : {}),
          offset,
          hasMore: offset + page.length < d.hits.length,
          transients: page,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logToolResult('detect_transients', args, startedAt, null, message);
        return error(message);
      }
    },
  );

  server.tool(
    'create_transient_automation',
    'Detect the transients of a track or audio file (same options as detect_transients) and write one pulse per hit ' +
    'onto an existing envelope of a target track — e.g. a lighting/DMX plugin parameter that should flash on every ' +
    'kick. Each pulse rises from baseValue to the hit level (peakValue, scaled by strength unless ' +
    'scaleByStrength is false) over attackMs, holds holdMs, and falls back over decayMs; a hit before the previous ' +
    'pulse has ended cuts it short. Values are raw envelope values (FX parameters 0..1, Pan -1..1). Create the ' +
    'envelope first with create_track_envelope (it returns envelopeIndex). By default the envelope\'s points in the ' +
    'range are replaced (replaceExisting). dryRun returns the points without writing. Use bands/minStrength/minGapMs ' +
    'to choose what the lights follow (e.g. bands ["low"], minStrength 0.6 for the kick accents). Requires the Python sidecar.',
    {
      ...sourceSchema,
      targetTrack: z.coerce.number().int().min(-1).describe('Track that holds the envelope to write (-1 = master)'),
      envelopeIndex: z.coerce.number().int().min(0).describe('Envelope on targetTrack (from create_track_envelope / get_track_envelopes)'),
      baseValue: z.coerce.number().optional().default(0).describe('Value between hits (default 0)'),
      peakValue: z.coerce.number().optional().default(1).describe('Value of the strongest hit (default 1)'),
      scaleByStrength: z.boolean().optional().default(true)
        .describe('Scale each pulse by the hit\'s strength (default true); false = every pulse reaches peakValue'),
      attackMs: z.coerce.number().min(0).max(2000).optional().default(0).describe('Rise time before each hit in ms (default 0 = instant)'),
      holdMs: z.coerce.number().min(0).max(5000).optional().default(30).describe('Time at the hit level in ms (default 30)'),
      decayMs: z.coerce.number().min(0).max(10000).optional().default(200).describe('Fall time back to baseValue in ms (default 200; 0 = cut off)'),
      decayCurve: z.enum(['linear', 'exponential']).optional().default('exponential')
        .describe('Shape of the fall: exponential (fast then slow, like a flash fading; default) or linear'),
      replaceExisting: z.boolean().optional().default(true)
        .describe('Delete the envelope\'s points in the range (plus the last pulse\'s tail) before writing (default true)'),
      dryRun: z.boolean().optional().default(false).describe('Return the points without writing them'),
    },
    async (args) => {
      const startedAt = Date.now();
      const log = (r: string | null) => logToolResult('create_transient_automation', args, startedAt, null, r ?? undefined);
      try {
        const d = await detect(args);
        if (typeof d === 'string') {
          log(d);
          return error(d);
        }
        const options: PulseOptions = {
          baseValue: args.baseValue ?? 0,
          peakValue: args.peakValue ?? 1,
          scaleByStrength: args.scaleByStrength ?? true,
          attackMs: args.attackMs ?? 0,
          holdMs: args.holdMs ?? 30,
          decayMs: args.decayMs ?? 200,
          decayShape: (args.decayCurve ?? 'exponential') === 'exponential' ? 3 : 0,
        };
        const points = pulsePoints(d.hits, options, d.start);
        const summary = {
          ...d.source,
          startTime: d.start,
          endTime: d.end,
          tempo: d.tempo,
          detected: d.detected,
          hits: d.hits.length,
          targetTrack: args.targetTrack,
          envelopeIndex: args.envelopeIndex,
        };
        if (d.hits.length === 0) {
          const msg = `No hits left to write (${d.detected} detected): lower minStrength, widen bands or raise sensitivity`;
          log(msg);
          return error(msg);
        }
        if (points.length > MAX_AUTOMATION_POINTS) {
          const msg = `${points.length} points is more than ${MAX_AUTOMATION_POINTS}: raise minStrength or minGapMs, or split the range`;
          log(msg);
          return error(msg);
        }
        if (args.dryRun) {
          log(null);
          return text({ ...summary, dryRun: true, pointCount: points.length, points });
        }

        const target = { trackIndex: args.targetTrack, envelopeIndex: args.envelopeIndex };
        let deletedPoints = 0;
        let reused = 0;
        if (args.replaceExisting ?? true) {
          const tail = (options.holdMs + options.decayMs) / 1000;
          const removeStart = Math.min(d.start, points[0].time) - 0.001;
          const removeEnd = Math.max(d.end ?? d.start, points[points.length - 1].time) + tail + 0.001;
          const removed = await sendCommand('remove_envelope_points', {
            ...target, timeStart: removeStart, timeEnd: removeEnd,
          });
          if (!removed.success) {
            log(String(removed.error));
            return error(`Could not clear the range: ${removed.error}`);
          }
          const r = removed.data as { deletedPoints?: number; totalPoints?: number };
          deletedPoints = Number(r?.deletedPoints ?? 0);
          // REAPER never deletes an envelope's last point (seen live: 410 points in range -> 1 left). A point
          // left in the range becomes the first pulse point instead of sitting beside it with its old value.
          if (r?.totalPoints === 1) {
            const left = await sendCommand('get_envelope_points', { ...target, offset: 0, limit: 1 });
            const point = (left.data as { points?: { time: number }[] } | undefined)?.points?.[0];
            if (left.success && point && point.time >= removeStart && point.time < removeEnd) {
              const [first] = points.splice(0, 1);
              const edited = await sendCommand('edit_envelope_points', { ...target, points: JSON.stringify([{ index: 0, ...first }]) });
              if (!edited.success) {
                log(String(edited.error));
                return error(`Could not write the points: ${edited.error}`);
              }
              deletedPoints += 1;
              reused = 1;
            }
          }
        }
        const inserted = await sendCommand('insert_envelope_points', { ...target, points: JSON.stringify(points) }, 60_000);
        if (!inserted.success) {
          log(String(inserted.error));
          return error(`Could not write the points: ${inserted.error}`);
        }
        log(null);
        const data = inserted.data as { insertedPoints?: number; totalPoints?: number };
        return text({
          ...summary,
          deletedPoints,
          insertedPoints: (data.insertedPoints ?? points.length) + reused,
          totalPoints: data.totalPoints,
          firstHits: d.hits.slice(0, 8),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(message);
        return error(message);
      }
    },
  );
}
