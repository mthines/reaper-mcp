/**
 * Mix-check tools: how a mix behaves over time, across the stereo field and between tracks.
 *
 * analyze_loudness_curve — short-term / momentary loudness over time, the loudest and
 *                          quietest windows, and the spans over a target (e.g. -14 LUFS).
 * analyze_stereo_bands   — stereo correlation and width per frequency band: a wide or
 *                          out-of-phase low end, a band that cancels in mono.
 * measure_masking        — where 2-8 tracks compete for the same third-octave bands, and
 *                          which one to cut.
 * separate_stems         — split a track or a file into stems (Demucs, opt-in install) and
 *                          optionally insert them as tracks under a folder.
 *
 * A track is rendered first (post-FX, like analyze_track_offline); a file is read directly.
 * The analysis runs in the Python sidecar (`sidecar/mixcheck.py`, `sidecar/separation.py`).
 */

import { z } from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { trace } from '@opentelemetry/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProjectInfo, RenderTrackToWavResult } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { emitLog, getSeparationSpeedHistogram, redactHome } from '../telemetry.js';
import { curveSummary, logToolResult, maskingSummary, stemsSummary, stereoBandsSummary } from '../tool-log.js';
import { MAX_OFFLINE_SECONDS } from './offline.js';

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

/** Range rendered from a track when no endTime is given (seconds). */
const DEFAULT_TRACK_SECONDS = 180;
/** measure_masking renders every track: keep the window short. */
export const MAX_MASKING_SECONDS = 60;
const DEFAULT_MASKING_SECONDS = 20;
export const MAX_MASKING_TRACKS = 8;
/** Separation is slow on a CPU: cap one call. */
export const MAX_SEPARATION_SECONDS = 600;
const renderTimeoutMs = (seconds: number) => 30_000 + seconds * 400;
/** Demucs on a CPU runs at roughly real time; allow 3x that plus the model load. */
const separationTimeoutMs = (seconds: number) => 90_000 + seconds * 3_000;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Obj = Record<string, unknown>;
const text = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const error = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const round1 = (x: number) => Math.round(x * 10) / 10;

async function render(trackIndex: number, startTime: number, endTime: number): Promise<RenderTrackToWavResult> {
  const res = await sendCommand(
    'render_track_to_wav',
    { trackIndex, startTime, endTime, commandId: randomUUID() },
    renderTimeoutMs(endTime - startTime),
  );
  if (!res.success) throw new Error(`Render failed: ${res.error}`);
  return res.data as RenderTrackToWavResult;
}

const removeQuietly = (path: string) => unlink(path).catch(() => {
  // Best-effort: the OS temp dir is cleaned eventually
});

const sourceSchema = {
  trackIndex: z.coerce.number().int().min(-1).optional()
    .describe('Track to analyze, rendered post-FX (-1 = master: the whole mix). Give this or path'),
  path: z.string().min(1).optional()
    .describe('Absolute path of an audio file (WAV/FLAC/AIFF/MP3/OGG) instead of a track, e.g. a reference song'),
  startTime: z.coerce.number().min(0).optional().describe('Start in seconds (default 0)'),
  endTime: z.coerce.number().min(0).optional()
    .describe(`End in seconds (track default: startTime + ${DEFAULT_TRACK_SECONDS}; file default: its end)`),
};

interface Source {
  /** The file the sidecar reads */
  path: string;
  /** Name shown on the page and in the answer */
  name: string;
  /** Project (or file) time the file's second 0 stands for */
  offset: number;
  /** Window inside `path` for the sidecar (a render is already cut) */
  window: { startTime?: number; endTime?: number };
  /** The render to delete afterwards */
  temp?: string;
  trackIndex?: number;
  /** Length of the range, when known before reading the file */
  seconds?: number;
}

/** Render the track, or point at the file; a refusal is a string. */
async function resolveSource(
  args: { trackIndex?: number; path?: string; startTime?: number; endTime?: number },
  maxSeconds: number,
  defaultSeconds = DEFAULT_TRACK_SECONDS,
): Promise<Source | string> {
  const { trackIndex, path, startTime, endTime } = args;
  if ((trackIndex == null) === (path == null)) return 'Give either trackIndex or path';
  if (startTime != null && endTime != null && endTime <= startTime) return 'endTime must be greater than startTime';
  const start = startTime ?? 0;
  if (path != null) {
    if (endTime != null && endTime - start > maxSeconds) return `Range too long: max ${maxSeconds} s per call`;
    return {
      path,
      name: basename(path, extname(path)),
      offset: 0,
      window: { ...(startTime != null ? { startTime } : {}), ...(endTime != null ? { endTime } : {}) },
      ...(endTime != null ? { seconds: endTime - start } : {}),
    };
  }
  const end = endTime ?? start + Math.min(defaultSeconds, maxSeconds);
  if (end - start > maxSeconds) return `Range too long: max ${maxSeconds} s per call`;
  const wav = await render(trackIndex as number, start, end);
  return {
    path: wav.wavPath,
    name: wav.trackName ?? (trackIndex === -1 ? 'Master' : `Track ${(trackIndex as number) + 1}`),
    offset: start,
    window: {},
    temp: wav.wavPath,
    trackIndex,
    seconds: end - start,
  };
}

/** Move a {start, end} span from file time to project time. */
function shift(span: unknown, by: number): void {
  if (!by || !span || typeof span !== 'object') return;
  const s = span as { start?: number; end?: number };
  if (typeof s.start === 'number') s.start = round1(s.start + by);
  if (typeof s.end === 'number') s.end = round1(s.end + by);
}

/** The project's media folder (where REAPER records), or ~/.reaper-mcp/stems. */
async function defaultStemsRoot(): Promise<string> {
  const res = await sendCommand('get_project_info', {}, 5_000).catch(() => null);
  const dir = res?.success ? (res.data as ProjectInfo).path : '';
  return dir ? join(dir, 'Stems') : join(homedir(), '.reaper-mcp', 'stems');
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const safeName = (name: string) => name.replace(/[^\w .-]+/g, '_').trim() || 'stems';
const titleCase = (stem: string) => stem.charAt(0).toUpperCase() + stem.slice(1);

export function registerMixcheckTools(server: McpServer): void {
  server.tool(
    'analyze_loudness_curve',
    'Loudness over time of a track (or the master, -1) or an audio file: short-term (3 s) and momentary (400 ms) ' +
    'LUFS as curves (at most 240 points each, every point the loudest moment of its slice), integrated LUFS, true ' +
    'peak, LRA, PLR (true peak minus integrated), the loudest and quietest 3 s windows, and with targetLufs the spans ' +
    'whose short-term loudness goes over target + toleranceLu. Use it to see where a master gets too loud or a ' +
    'section drops away, before and after a change. Rendered once, no playback. Requires the Python sidecar.',
    {
      ...sourceSchema,
      targetLufs: z.coerce.number().min(-40).max(0).optional()
        .describe('Report the spans whose short-term loudness is above this (e.g. -14 for streaming)'),
      toleranceLu: z.coerce.number().min(0).max(6).optional().default(1)
        .describe('LU above targetLufs before a span counts (default 1)'),
    },
    async (args) => {
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      let src: Source | string;
      try {
        src = await resolveSource(args, MAX_OFFLINE_SECONDS);
      } catch (err) {
        return error(messageOf(err));
      }
      if (typeof src === 'string') return error(src);
      try {
        const result = await sidecar.loudnessCurve({
          path: src.path,
          ...src.window,
          ...(args.targetLufs != null ? { targetLufs: args.targetLufs, toleranceLu: args.toleranceLu } : {}),
        });
        shift(result['loudest'], src.offset);
        shift(result['quietest'], src.offset);
        for (const span of (result['overTarget'] as unknown[] | undefined) ?? []) shift(span, src.offset);
        const data: Obj = {
          ...(src.trackIndex != null ? { trackIndex: src.trackIndex, trackName: src.name } : { path: args.path }),
          ...result,
          startTime: src.offset + Number(result['startTime'] ?? 0),
        };
        if (args.targetLufs != null) data['targetLufs'] = args.targetLufs;
        trace.getActiveSpan()?.setAttribute('reaper.loudness.over_target_seconds', Number(result['overTargetSeconds'] ?? 0));
        logToolResult('analyze_loudness_curve', args, startedAt, curveSummary(src.name, data));
        return text(data);
      } catch (err) {
        logToolResult('analyze_loudness_curve', args, startedAt, null, messageOf(err));
        return error(messageOf(err));
      } finally {
        if (src.temp) await removeQuietly(src.temp);
      }
    },
  );

  server.tool(
    'analyze_stereo_bands',
    'Stereo correlation per frequency band (low <120 Hz, lowMid 120-500 Hz, mid 0.5-2 kHz, high 2-8 kHz, air >8 kHz) of a track, the master (-1) ' +
    'or a stereo file: overall and worst correlation (+1 mono, 0 wide, below 0 cancels in mono), the share of time ' +
    'out of phase, side-to-mid level (dB, width), a short correlation series per band, and flags for a wide or ' +
    'out-of-phase low end or any band that cancels in mono. Rendered once, no playback. Requires the Python sidecar.',
    sourceSchema,
    async (args) => {
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      let src: Source | string;
      try {
        src = await resolveSource(args, MAX_OFFLINE_SECONDS);
      } catch (err) {
        return error(messageOf(err));
      }
      if (typeof src === 'string') return error(src);
      try {
        const result = await sidecar.stereoBands({ path: src.path, ...src.window });
        const data: Obj = {
          ...(src.trackIndex != null ? { trackIndex: src.trackIndex, trackName: src.name } : { path: args.path }),
          ...result,
          startTime: src.offset + Number(result['startTime'] ?? 0),
        };
        const flags = (result['flags'] as string[] | undefined) ?? [];
        trace.getActiveSpan()?.setAttribute('reaper.stereo.flag_count', flags.length);
        logToolResult('analyze_stereo_bands', args, startedAt, stereoBandsSummary(src.name, data));
        return text(data);
      } catch (err) {
        logToolResult('analyze_stereo_bands', args, startedAt, null, messageOf(err));
        return error(messageOf(err));
      } finally {
        if (src.temp) await removeQuietly(src.temp);
      }
    },
  );

  server.tool(
    'measure_masking',
    'Find where 2-8 tracks compete for the same frequencies: renders each track over the same range (post-FX) and ' +
    'compares their K-weighted third-octave levels (40 Hz-16 kHz). A band scores high when both tracks are loud there ' +
    'and within a few dB of each other. Returns every pair\'s overall score with its worst bands, and the top ' +
    'conflicts (score >= 0.2) with a suggestion: which track to cut around which frequency (the one the band matters ' +
    `less to). Pick a section where they all play (max ${MAX_MASKING_SECONDS} s). Requires the Python sidecar.`,
    {
      tracks: z.array(z.coerce.number().int().min(0)).min(2).max(MAX_MASKING_TRACKS)
        .describe(`Zero-based indexes of 2-${MAX_MASKING_TRACKS} tracks to compare (e.g. kick, bass, keys)`),
      startTime: z.coerce.number().min(0).describe('Start of the range in seconds'),
      durationSeconds: z.coerce.number().min(1).max(MAX_MASKING_SECONDS).optional().default(DEFAULT_MASKING_SECONDS)
        .describe(`Length in seconds (default ${DEFAULT_MASKING_SECONDS}, max ${MAX_MASKING_SECONDS})`),
    },
    async (args) => {
      const { tracks, startTime, durationSeconds } = args;
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      if (new Set(tracks).size !== tracks.length) return error('tracks must not repeat a track');
      const end = startTime + (durationSeconds ?? DEFAULT_MASKING_SECONDS);
      const rendered: RenderTrackToWavResult[] = [];
      try {
        // REAPER renders one at a time (synchronous action)
        for (const t of tracks) rendered.push(await render(t, startTime, end));
        const names = rendered.map((r, i) => r.trackName || `Track ${tracks[i] + 1}`);
        // Two tracks with one name would be indistinguishable in the answer
        const unique = names.map((n, i) => (names.indexOf(n) === i ? n : `${n} (${tracks[i] + 1})`));
        const result = await sidecar.masking({ tracks: rendered.map((r, i) => ({ name: unique[i], path: r.wavPath })) });
        const hz = (result['bandsHz'] as number[] | undefined) ?? [];
        const pairs = ((result['pairs'] as Obj[] | undefined) ?? []).map((p) => {
          const scores = (p['scores'] as number[] | undefined) ?? [];
          const worst = scores.map((s, k) => ({ hz: hz[k], score: s }))
            .filter((b) => b.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
          return { a: p['a'], b: p['b'], overall: p['overall'], worstBands: worst };
        }).sort((x, y) => Number(y.overall) - Number(x.overall));
        const conflicts = (result['conflicts'] as Obj[] | undefined) ?? [];
        const data = {
          tracks: tracks.map((t, i) => ({ trackIndex: t, name: unique[i] })),
          startTime,
          endTime: end,
          pairs,
          conflicts,
          ...(conflicts.length === 0 ? { note: 'No band where two of these tracks are both loud and within a few dB: nothing masks.' } : {}),
        };
        const span = trace.getActiveSpan();
        span?.setAttribute('reaper.masking.track_count', tracks.length);
        span?.setAttribute('reaper.masking.conflict_count', conflicts.length);
        logToolResult('measure_masking', args, startedAt, maskingSummary(result));
        return text(data);
      } catch (err) {
        logToolResult('measure_masking', args, startedAt, null, messageOf(err));
        return error(messageOf(err));
      } finally {
        await Promise.all(rendered.map((r) => removeQuietly(r.wavPath)));
      }
    },
  );

  server.tool(
    'separate_stems',
    'Split a track (rendered post-FX, -1 = master) or an audio file into stems with Demucs: htdemucs gives drums, ' +
    'bass, other, vocals; htdemucs_6s adds guitar and piano. Writes one 32-bit float WAV per stem to outDir (default: ' +
    'a new folder under the project\'s Stems folder) and returns each stem\'s path, LUFS and peak. With insertTracks, ' +
    'adds them as tracks under a new folder in one undo point, lined up with the source (a track: after it, at ' +
    'startTime; a file: at filePosition + startTime). Slow: about real time on a CPU, several times faster on Apple ' +
    `silicon or CUDA (max ${MAX_SEPARATION_SECONDS} s per call). Needs \`reaper-mcp setup-sidecar --with-separation\`.`,
    {
      ...sourceSchema,
      model: z.enum(['htdemucs', 'htdemucs_6s']).optional().default('htdemucs')
        .describe('htdemucs (4 stems, default) or htdemucs_6s (adds guitar and piano)'),
      stems: z.array(z.enum(['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'])).min(1).optional()
        .describe('Write only these stems (default: all the model gives)'),
      outDir: z.string().min(1).optional().describe('Absolute folder for the stem WAVs (created if missing)'),
      insertTracks: z.boolean().optional().default(false)
        .describe('Insert the stems as tracks under a new folder track'),
      filePosition: z.coerce.number().min(0).optional()
        .describe('With path and insertTracks: project time where the file starts (default 0)'),
    },
    async (args) => {
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      if (args.model === 'htdemucs' && args.stems?.some((s) => s === 'guitar' || s === 'piano')) {
        return error('htdemucs has no guitar or piano stem: use model htdemucs_6s');
      }
      let src: Source | string;
      try {
        src = await resolveSource(args, MAX_SEPARATION_SECONDS, 60);
      } catch (err) {
        return error(messageOf(err));
      }
      if (typeof src === 'string') return error(src);
      try {
        const outDir = args.outDir ?? join(await defaultStemsRoot(), `${safeName(src.name)}-${stamp()}`);
        const result = await sidecar.separate(
          { path: src.path, outDir, model: args.model, maxSeconds: MAX_SEPARATION_SECONDS, ...(args.stems ? { stems: args.stems } : {}), ...src.window },
          separationTimeoutMs(src.seconds ?? MAX_SEPARATION_SECONDS),
        );
        const stems = (result['stems'] as { stem: string; path: string }[] | undefined) ?? [];
        const audio = Number(result['seconds'] ?? 0);
        const processing = Number(result['processingSeconds'] ?? 0);
        if (audio > 0 && processing > 0) {
          getSeparationSpeedHistogram().record(audio / processing, {
            'reaper.separation.device': String(result['device'] ?? 'unknown'),
            'reaper.separation.model': args.model ?? 'htdemucs',
          });
        }
        if (typeof result['fallbackFrom'] === 'string') {
          emitLog('warn', `separate_stems: ${result['fallbackFrom']} failed, ran on CPU: ${redactHome(String(result['fallbackError'] ?? ''))}`, {
            'reaper.separation.device': 'cpu_fallback',
          });
        }
        const span = trace.getActiveSpan();
        span?.setAttribute('reaper.separation.stem_count', stems.length);
        span?.setAttribute('reaper.separation.device', String(result['device'] ?? 'unknown'));

        let inserted: Obj | undefined;
        let insertError: string | undefined;
        if (args.insertTracks && stems.length > 0) {
          const position = src.temp ? src.offset : (args.filePosition ?? 0) + (args.startTime ?? 0);
          const res = await sendCommand('insert_stem_tracks', {
            files: JSON.stringify(stems.map((s) => ({ name: titleCase(s.stem), path: s.path }))),
            position,
            folderName: `${src.name} stems`,
            ...(src.trackIndex != null && src.trackIndex >= 0 ? { afterTrack: src.trackIndex } : {}),
          }, 30_000);
          if (res.success) inserted = res.data as Obj;
          else insertError = `Stems written, but inserting them failed: ${res.error}`;
        }
        const data: Obj = {
          ...(src.trackIndex != null ? { trackIndex: src.trackIndex, trackName: src.name } : { path: args.path }),
          ...result,
          ...(inserted ? { inserted } : {}),
          ...(insertError ? { warning: insertError } : {}),
        };
        logToolResult('separate_stems', args, startedAt, stemsSummary(src.name, data));
        return text(data);
      } catch (err) {
        logToolResult('separate_stems', args, startedAt, null, messageOf(err));
        return error(messageOf(err));
      } finally {
        if (src.temp) await removeQuietly(src.temp);
      }
    },
  );
}
