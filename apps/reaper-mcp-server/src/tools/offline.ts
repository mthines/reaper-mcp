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
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RenderTrackToWavResult } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

/** Max range analyze_track_offline renders in one call (seconds). */
export const MAX_OFFLINE_SECONDS = 900;
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
      durationSeconds: z.coerce.number().min(1).max(MAX_OFFLINE_SECONDS).optional().default(30)
        .describe(`Length in seconds when endTime is not given (default 30, max ${MAX_OFFLINE_SECONDS})`),
      sectionSeconds: z.coerce.number().min(1).max(120).optional()
        .describe('Also report loudness per consecutive section of this length (e.g. 10)'),
      ...referenceSchema,
    },
    async ({ trackIndex, startTime, endTime, durationSeconds, sectionSeconds, referencePath, referenceStartTime, referenceEndTime }) => {
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);

      const start = startTime ?? 0;
      const end = endTime ?? start + (durationSeconds ?? 30);
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
        return text({
          trackIndex,
          trackName: wav.trackName,
          startTime: start,
          endTime: end,
          ...toProjectTime(result, start),
        });
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
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
    async ({ path, startTime, endTime, sectionSeconds, referencePath, referenceStartTime, referenceEndTime }) => {
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
        return text({ path, ...toProjectTime(result, startTime ?? 0) });
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
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
    'is compensated). Pick a range where both tracks play the same hits. Requires the Python sidecar.',
    {
      referenceTrack: z.coerce.number().int().min(0).describe('Zero-based index of the reference track'),
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based index of the track to measure'),
      startTime: z.coerce.number().min(0).describe('Start of the range in seconds'),
      durationSeconds: z.coerce.number().min(0.5).max(MAX_ALIGNMENT_SECONDS).optional().default(10)
        .describe(`Length in seconds (default 10, max ${MAX_ALIGNMENT_SECONDS})`),
      maxLagMs: z.coerce.number().min(0.1).max(100).optional().default(20)
        .describe('Largest offset to search either way in ms (default 20; room mics may need 30-50)'),
    },
    async ({ referenceTrack, trackIndex, startTime, durationSeconds, maxLagMs }) => {
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      if (referenceTrack === trackIndex) return error('referenceTrack and trackIndex must differ');

      const end = startTime + (durationSeconds ?? 10);
      const rendered: RenderTrackToWavResult[] = [];
      try {
        rendered.push(await render(referenceTrack, startTime, end));
        rendered.push(await render(trackIndex, startTime, end));
        const result = await sidecar.align({
          referencePath: rendered[0].wavPath,
          path: rendered[1].wavPath,
          maxLagMs: maxLagMs ?? 20,
        });
        const delayMs = result['delayMs'] as number | null;
        const currentPlayOffsetMs = rendered[1].playOffsetMs ?? 0;
        const currentPhaseInverted = rendered[1].phaseInverted ?? false;
        return text({
          referenceTrack,
          referenceName: rendered[0].trackName,
          trackIndex,
          trackName: rendered[1].trackName,
          startTime,
          endTime: end,
          ...result,
          currentPlayOffsetMs,
          currentPhaseInverted,
          ...(typeof delayMs === 'number'
            ? {
              suggestedPlayOffsetMs: Math.round((currentPlayOffsetMs - delayMs) * 1000) / 1000,
              suggestedPhase: currentPhaseInverted !== Boolean(result['polarityInverted']) ? 1 : 0,
            }
            : {}),
        });
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      } finally {
        await Promise.all(rendered.map((r) => removeQuietly(r.wavPath)));
      }
    },
  );
}
