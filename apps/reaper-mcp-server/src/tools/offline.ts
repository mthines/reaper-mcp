/**
 * Offline (render-based) analysis tools.
 *
 * analyze_track_offline   — render a track or the master once, then loudness
 *                           (BS.1770 / EBU R128), spectrum and an optional
 *                           reference comparison in the Python sidecar.
 * analyze_audio_file      — the same analysis for a file on disk (a reference
 *                           track, a bounce, a stem). No REAPER involved.
 * measure_track_alignment — render two tracks over the same range and
 *                           cross-correlate them: delay and polarity.
 *
 * Unlike the real-time meters these need no playback, work on folder tracks and
 * the master, and see the whole range at once. They need the sidecar
 * (setup-sidecar); no model is loaded for them.
 */

import { z } from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RenderTrackToWavResult } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { alignmentSummary, logToolResult, offlineSummary } from '../tool-log.js';

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

/** Max range analyze_track_offline renders in one call (seconds). */
export const MAX_OFFLINE_SECONDS = 900;
/** Default range analyze_track_offline renders when no endTime is given (seconds). */
const DEFAULT_OFFLINE_SECONDS = 30;
/** Default window and lag search of measure_track_alignment. */
const DEFAULT_ALIGNMENT_SECONDS = 10;
const DEFAULT_MAX_LAG_MS = 20;
/** Below this correlation the two tracks share too little to trust the lag. */
export const MIN_ALIGNMENT_CORRELATION = 0.3;
/** Max window measure_track_alignment renders per track (seconds). */
export const MAX_ALIGNMENT_SECONDS = 30;
/** Render is synchronous in REAPER: allow ~1 s per 3 s of audio plus slack. */
const renderTimeoutMs = (seconds: number) => 30_000 + seconds * 400;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const error = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

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

/** Shift the sidecar's file-relative section times to project time. */
function toProjectTime(result: Record<string, unknown>, offset: number): Record<string, unknown> {
  const loudness = result['loudness'] as { sections?: { start: number; end: number }[] } | undefined;
  if (loudness?.sections && offset) {
    loudness.sections = loudness.sections.map((s) => ({
      ...s,
      start: Math.round((s.start + offset) * 10) / 10,
      end: Math.round((s.end + offset) * 10) / 10,
    }));
  }
  return result;
}

const referenceSchema = {
  referencePath: z.string().min(1).optional()
    .describe('Absolute path of a reference audio file (WAV/FLAC/AIFF) to compare tonal balance and loudness against'),
  referenceStartTime: z.coerce.number().min(0).optional()
    .describe('Start of the reference excerpt in seconds (default 0)'),
  referenceEndTime: z.coerce.number().min(0).optional()
    .describe('End of the reference excerpt in seconds (default: end of file)'),
};

export function registerOfflineTools(server: McpServer): void {
  server.tool(
    'analyze_track_offline',
    'Render a track (or the master, -1) once and analyze it offline — no playback needed, works on folder tracks. ' +
    'Returns integrated LUFS (BS.1770 gated), loudness range (LRA), true peak (dBTP), sample peak, crest factor, ' +
    'per-section loudness, band balance (sub..brilliance as share of energy), resonance hints (narrow peaks above the ' +
    'local spectrum) and sibilance hints (5-10 kHz spikes with times). With referencePath, also the loudness difference ' +
    'and tonal-balance difference (bands and third octaves, level offset removed) against that file. ' +
    `Use this for whole-song and mastering numbers (up to ${MAX_OFFLINE_SECONDS} s). Requires the Python sidecar.`,
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master: the whole mix)'),
      startTime: z.coerce.number().min(0).optional().describe('Start in seconds (default 0)'),
      endTime: z.coerce.number().min(0).optional().describe('End in seconds (default startTime + durationSeconds)'),
      durationSeconds: z.coerce.number().min(1).max(MAX_OFFLINE_SECONDS).optional().default(DEFAULT_OFFLINE_SECONDS)
        .describe(`Length in seconds when endTime is not given (default ${DEFAULT_OFFLINE_SECONDS}, max ${MAX_OFFLINE_SECONDS})`),
      sectionSeconds: z.coerce.number().min(1).max(120).optional()
        .describe('Also report loudness per consecutive section of this length (e.g. 10)'),
      ...referenceSchema,
    },
    async (args) => {
      const { trackIndex, startTime, endTime, durationSeconds, sectionSeconds, referencePath, referenceStartTime, referenceEndTime } = args;
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);

      const start = startTime ?? 0;
      const end = endTime ?? start + (durationSeconds ?? DEFAULT_OFFLINE_SECONDS);
      if (end <= start) return error('endTime must be greater than startTime');
      if (end - start > MAX_OFFLINE_SECONDS) return error(`Range too long: max ${MAX_OFFLINE_SECONDS} s per call`);

      let wav: RenderTrackToWavResult;
      try {
        wav = await render(trackIndex, start, end);
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
      try {
        const result = await sidecar.analyzeAudio({
          path: wav.wavPath,
          ...(sectionSeconds ? { sectionSeconds } : {}),
          ...(referencePath ? { referencePath, referenceStartTime, referenceEndTime } : {}),
        });
        const data = toProjectTime(result, start);
        logToolResult('analyze_track_offline', args, startedAt, offlineSummary(wav.trackName ?? `Track ${trackIndex + 1}`, data));
        return text({
          trackIndex,
          trackName: wav.trackName,
          startTime: start,
          endTime: end,
          ...data,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logToolResult('analyze_track_offline', args, startedAt, null, message);
        return error(message);
      } finally {
        await removeQuietly(wav.wavPath);
      }
    },
  );

  server.tool(
    'analyze_audio_file',
    'Analyze an audio file on disk (a reference track, a bounce, a stem) the same way as analyze_track_offline: ' +
    'integrated LUFS, LRA, true peak, crest, per-section loudness, band balance, resonance and sibilance hints, and ' +
    'an optional comparison against another file. Does not touch REAPER. Requires the Python sidecar.',
    {
      path: z.string().min(1).describe('Absolute path of the audio file'),
      startTime: z.coerce.number().min(0).optional().describe('Start in seconds (default 0)'),
      endTime: z.coerce.number().min(0).optional().describe('End in seconds (default: end of file)'),
      sectionSeconds: z.coerce.number().min(1).max(120).optional()
        .describe('Also report loudness per consecutive section of this length'),
      ...referenceSchema,
    },
    async (args) => {
      const { path, startTime, endTime, sectionSeconds, referencePath, referenceStartTime, referenceEndTime } = args;
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      if (startTime != null && endTime != null && endTime <= startTime) {
        return error('endTime must be greater than startTime');
      }
      try {
        const result = await sidecar.analyzeAudio({
          path,
          ...(startTime != null ? { startTime } : {}),
          ...(endTime != null ? { endTime } : {}),
          ...(sectionSeconds ? { sectionSeconds } : {}),
          ...(referencePath ? { referencePath, referenceStartTime, referenceEndTime } : {}),
        });
        const data = toProjectTime(result, startTime ?? 0);
        logToolResult('analyze_audio_file', args, startedAt, offlineSummary(basename(path), data));
        return text({ path, ...data });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logToolResult('analyze_audio_file', args, startedAt, null, message);
        return error(message);
      }
    },
  );

  server.tool(
    'measure_track_alignment',
    'Measure the time offset and polarity of one track against a reference track (e.g. snare bottom vs snare top, ' +
    'kick sub vs kick in, overheads vs snare) by rendering both over the same range and cross-correlating them. ' +
    'A positive delayMs means the track arrives later than the reference, as both play now (the current playback ' +
    'offset and polarity are included). To align it, set_track_property playOffsetMs = suggestedPlayOffsetMs and ' +
    'phase = suggestedPhase (1 = inverted) on that track — absolute values that already account for the current ' +
    'settings, so re-measuring an aligned track suggests what it already has. Renders are post-FX (plugin latency ' +
    'is compensated). Pick a range where both tracks play the same hits; below correlation ' +
    `${MIN_ALIGNMENT_CORRELATION} no suggestion is made. Requires the Python sidecar.`,
    {
      referenceTrack: z.coerce.number().int().min(0).describe('Zero-based index of the reference track'),
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based index of the track to measure'),
      startTime: z.coerce.number().min(0).describe('Start of the range in seconds'),
      durationSeconds: z.coerce.number().min(0.5).max(MAX_ALIGNMENT_SECONDS).optional().default(DEFAULT_ALIGNMENT_SECONDS)
        .describe(`Length in seconds (default ${DEFAULT_ALIGNMENT_SECONDS}, max ${MAX_ALIGNMENT_SECONDS})`),
      maxLagMs: z.coerce.number().min(0.1).max(100).optional().default(DEFAULT_MAX_LAG_MS)
        .describe(`Largest offset to search either way in ms (default ${DEFAULT_MAX_LAG_MS}; room mics may need 30-50)`),
    },
    async (args) => {
      const { referenceTrack, trackIndex, startTime, durationSeconds, maxLagMs } = args;
      const startedAt = Date.now();
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      if (referenceTrack === trackIndex) return error('referenceTrack and trackIndex must differ');

      const end = startTime + (durationSeconds ?? DEFAULT_ALIGNMENT_SECONDS);
      const rendered: RenderTrackToWavResult[] = [];
      try {
        rendered.push(await render(referenceTrack, startTime, end));
        rendered.push(await render(trackIndex, startTime, end));
        const result = await sidecar.align({
          referencePath: rendered[0].wavPath,
          path: rendered[1].wavPath,
          maxLagMs: maxLagMs ?? DEFAULT_MAX_LAG_MS,
        });
        const delayMs = result['delayMs'] as number | null;
        const correlation = Math.abs(Number(result['correlation'] ?? 0));
        const confident = typeof delayMs === 'number' && correlation >= MIN_ALIGNMENT_CORRELATION;
        const currentPlayOffsetMs = rendered[1].playOffsetMs ?? 0;
        const currentPhaseInverted = rendered[1].phaseInverted ?? false;
        const data = {
          referenceTrack,
          referenceName: rendered[0].trackName,
          trackIndex,
          trackName: rendered[1].trackName,
          startTime,
          endTime: end,
          ...result,
          currentPlayOffsetMs,
          currentPhaseInverted,
          ...(typeof delayMs === 'number' && !confident
            ? {
              warning: `Correlation ${correlation.toFixed(2)} is below ${MIN_ALIGNMENT_CORRELATION}: the tracks share ` +
                'too little in this range to trust the delay. Pick a range where both play the same hits.',
            }
            : {}),
          ...(confident
            ? {
              suggestedPlayOffsetMs: Math.round((currentPlayOffsetMs - delayMs) * 1000) / 1000,
              suggestedPhase: currentPhaseInverted !== Boolean(result['polarityInverted']) ? 1 : 0,
            }
            : {}),
        };
        // A window the sidecar could not measure (silence) logs as a refused call with its reason
        const reason = typeof result['error'] === 'string' ? result['error'] : undefined;
        logToolResult('measure_track_alignment', args, startedAt, reason ? null : alignmentSummary(data), reason);
        return text(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logToolResult('measure_track_alignment', args, startedAt, null, message);
        return error(message);
      } finally {
        await Promise.all(rendered.map((r) => removeQuietly(r.wavPath)));
      }
    },
  );
}
