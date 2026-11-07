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
 * verify_edit             — after an edit, compare the result with the audio from
 *                           before it: delay/gain/polarity-compensated null and a
 *                           click check, with a verdict per check.
 *
 * Unlike the real-time meters these need no playback, work on folder tracks and
 * the master, and see the whole range at once. They need the sidecar
 * (setup-sidecar); no model is loaded for them.
 */

import { z } from 'zod/v4';
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RenderTrackToWavResult } from '@reaper-mcp/protocol';
import { discardRender, renderTrack, renderTracks } from '../render.js';
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
/** Window verify_edit renders per track (seconds). */
const DEFAULT_VERIFY_SECONDS = 10;
export const MAX_VERIFY_SECONDS = 60;
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const error = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

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

/** verify_edit: the sidecar's click time is seconds into the rendered window; the rest of the answer is project time. */
function inProjectTime(result: Record<string, unknown>, offset: number): Record<string, unknown> {
  const checks = result['checks'] as { discontinuity?: { atSeconds?: number | null } } | undefined;
  const at = checks?.discontinuity?.atSeconds;
  if (checks?.discontinuity && typeof at === 'number') {
    checks.discontinuity.atSeconds = Math.round((at + offset) * 1000) / 1000;
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
        wav = await renderTrack(trackIndex, start, end);
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
        await discardRender(wav);
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
        // One render pass for both tracks: one progress window, not two
        rendered.push(...(await renderTracks([referenceTrack, trackIndex], startTime, end)));
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
        await Promise.all(rendered.map(discardRender));
      }
    },
  );

  server.tool(
    'verify_edit',
    'Check the result of an edit you just made, since you cannot hear it: compare the edited track with the audio from ' +
    'before the edit and get a verdict per check. Compensated null: the delay (ms, + = later), gain (dB) and polarity ' +
    'between the two are estimated and removed, and the residual left (dB below the reference) says whether anything else ' +
    'changed (noise, a splice, a different waveform, a swapped stereo channel; it is relative to referenceRmsDb, so with a quiet reference the rounding noise of a 16-bit bounce can set it). Discontinuity: the largest sample-to-sample jump on any channel against the ' +
    "reference's own, with where it happens and which channel (a click or hard splice). Use expect 'identical' (default) for edits that " +
    'should leave the sound alone apart from level, delay and polarity (alignment, gain, split, crossfade): the residual ' +
    'is judged ok/warn/fail. Use "changed" for EQ, compression and the like: the residual is reported without a ' +
    'verdict. Set timeScale to the stretch factor when the edit changed the timing: the waveform null is then skipped ' +
    'and only the click check runs. The reference is another track (e.g. a copy you kept) or an audio file of the same ' +
    'range from before the edit (a bounce), not an undo. Keep a reference track unmuted so it renders. Pitch, formant and transient checks are not included: they ' +
    'need a baseline per source. A passing result is evidence, not a replacement for listening. Requires the Python sidecar.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based index of the edited track'),
      referenceTrack: z.coerce.number().int().min(0).optional()
        .describe('Zero-based index of a track holding the audio from before the edit (give this or referencePath)'),
      referencePath: z.string().min(1).optional()
        .describe('Absolute path of an audio file of the same range from before the edit (give this or referenceTrack)'),
      startTime: z.coerce.number().min(0).describe('Start of the range in seconds'),
      durationSeconds: z.coerce.number().min(0.5).max(MAX_VERIFY_SECONDS).optional().default(DEFAULT_VERIFY_SECONDS)
        .describe(`Length in seconds (default ${DEFAULT_VERIFY_SECONDS}, max ${MAX_VERIFY_SECONDS})`),
      expect: z.enum(['identical', 'changed']).optional().default('identical')
        .describe('"identical": only level, delay and polarity may differ; "changed": report the residual without a verdict'),
      timeScale: z.coerce.number().min(0.1).max(10).optional().default(1)
        .describe('1 = the edit kept the timing (default). Any other value (a stretch) skips the waveform null'),
      maxLagMs: z.coerce.number().min(0.1).max(100).optional().default(DEFAULT_MAX_LAG_MS)
        .describe(`Largest delay to search either way in ms (default ${DEFAULT_MAX_LAG_MS})`),
    },
    async (args) => {
      const { trackIndex, referenceTrack, referencePath, startTime, durationSeconds, expect, timeScale, maxLagMs } = args;
      const startedAt = Date.now();
      const refuse = (message: string): ToolResult => {
        logToolResult('verify_edit', args, startedAt, null, message);
        return error(message);
      };
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      if ((referenceTrack == null) === (referencePath == null)) {
        return refuse('Give exactly one of referenceTrack (a track with the audio from before the edit) or referencePath (a file)');
      }
      if (referenceTrack === trackIndex) return refuse('referenceTrack and trackIndex must differ');

      const end = startTime + (durationSeconds ?? DEFAULT_VERIFY_SECONDS);
      const rendered: RenderTrackToWavResult[] = [];
      try {
        if (referenceTrack != null) {
          rendered.push(...(await renderTracks([referenceTrack, trackIndex], startTime, end)));
        } else {
          rendered.push(await renderTrack(trackIndex, startTime, end));
        }
        const edited = rendered[rendered.length - 1];
        const result = await sidecar.verifyEdit({
          referencePath: referenceTrack != null ? rendered[0].wavPath : (referencePath as string),
          path: edited.wavPath,
          expect: expect ?? 'identical',
          timeScale: timeScale ?? 1,
          maxLagMs: maxLagMs ?? DEFAULT_MAX_LAG_MS,
        });
        if (typeof result['error'] === 'string') return refuse(result['error']);
        logToolResult('verify_edit', args, startedAt, null);
        return text({
          trackIndex,
          trackName: edited.trackName,
          ...(referenceTrack != null ? { referenceTrack, referenceName: rendered[0].trackName } : { referencePath }),
          startTime,
          endTime: end,
          ...inProjectTime(result, startTime),
        });
      } catch (err) {
        return refuse(err instanceof Error ? err.message : String(err));
      } finally {
        await Promise.all(rendered.map(discardRender));
      }
    },
  );
}
