/**
 * analyze_track_aesthetics — MCP tool registration
 *
 * Renders a REAPER track segment to a temp WAV file (via Lua bridge), sends
 * the WAV to the Python sidecar running Meta's Audiobox Aesthetics model,
 * and returns 4 perceptual quality scores (0-10 scale).
 *
 * The sidecar is opt-in. If setup-sidecar has not been run, the tool
 * returns a clear actionable error.
 *
 * License note: Audiobox Aesthetics is CC-BY 4.0 (commercial use permitted).
 * Model: https://huggingface.co/facebook/audiobox-aesthetics
 */

import { z } from 'zod/v4';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import type { RenderTrackToWavResult } from '@reaper-mcp/protocol';

/** Loudness every clip is scored at, so louder versions do not score higher for being louder. */
export const DEFAULT_SCORING_LUFS = -18;

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

export function registerAestheticsTools(server: McpServer): void {
  server.tool(
    'analyze_track_aesthetics',
    'Analyze the perceptual aesthetic quality of a track\'s audio using Meta\'s Audiobox Aesthetics model (CC-BY 4.0). Bounces the track to a temp WAV file (post-FX, post-fader) and runs 4-axis perceptual quality scoring: Production Quality (PQ), Production Complexity (PC), Content Enjoyment (CE), Content Usefulness (CU). Returns scores 0-10. The clip is normalized to normalizeLufs (default -18 LUFS) before scoring, so a louder version does not score higher just for being louder; compare versions only at matched loudness. PQ (and partly CU) judge mix changes; PC and CE mostly follow the arrangement. Differences under ~0.3 are noise. Requires the Python sidecar (run: node dist/apps/reaper-mcp-server/main.js setup-sidecar).',
    {
      trackIndex: z.coerce.number().int().min(-1)
        .describe('Zero-based track index (-1 = master: the whole mix)'),
      startTime: z.coerce.number().min(0).optional()
        .describe('Start time in seconds (default: 0 or use REAPER time selection)'),
      endTime: z.coerce.number().min(0).optional()
        .describe('End time in seconds (default: startTime + durationSeconds)'),
      durationSeconds: z.coerce.number().min(0.5).max(30).optional().default(5)
        .describe('Duration to analyze in seconds (default 5, max 30). Ignored if endTime is provided.'),
      normalizeLufs: z.union([z.literal(false), z.null(), z.coerce.number().min(-60).max(0)]).optional().default(DEFAULT_SCORING_LUFS)
        .describe('Scale the clip to this integrated loudness before scoring (default -18 LUFS); false or null scores it as rendered'),
    },
    async ({ trackIndex, startTime, endTime, durationSeconds, normalizeLufs }) => {
      // Check 1: is sidecar installed?
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) {
        return {
          content: [{ type: 'text', text: SIDECAR_NOT_INSTALLED_MSG }],
          isError: true,
        };
      }

      // Resolve time bounds
      const resolvedStart = startTime ?? 0;
      const resolvedEnd = endTime ?? (resolvedStart + (durationSeconds ?? 5));

      if (resolvedEnd <= resolvedStart) {
        return {
          content: [{ type: 'text', text: 'endTime must be greater than startTime' }],
          isError: true,
        };
      }

      // Render track to temp WAV via Lua bridge
      const commandId = randomUUID();
      const renderRes = await sendCommand('render_track_to_wav', {
        trackIndex,
        startTime: resolvedStart,
        endTime: resolvedEnd,
        commandId,
      });

      if (!renderRes.success) {
        return {
          content: [{ type: 'text', text: `Render failed: ${renderRes.error}` }],
          isError: true,
        };
      }

      const renderData = renderRes.data as RenderTrackToWavResult;
      const wavPath = renderData.wavPath;

      // Call sidecar (with cleanup in finally)
      try {
        // The WAV holds only the rendered segment, so times are relative to it
        const scores = await sidecar.analyze(wavPath, 0, resolvedEnd - resolvedStart, {
          normalizeLufs: normalizeLufs === false || normalizeLufs === null
            ? null
            : (normalizeLufs ?? DEFAULT_SCORING_LUFS),
        });

        const result = {
          trackIndex,
          trackName: renderData.trackName,
          productionQuality: scores.PQ,
          productionComplexity: scores.PC,
          contentEnjoyment: scores.CE,
          contentUsefulness: scores.CU,
          startTime: resolvedStart,
          endTime: resolvedEnd,
          durationSeconds: resolvedEnd - resolvedStart,
          normalizedToLufs: scores.normalizeLufs ?? null,
          inputLufs: scores.inputLufs ?? null,
          gainDb: scores.gainDb ?? 0,
          modelVersion: scores.modelVersion,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: err instanceof Error ? err.message : String(err),
          }],
          isError: true,
        };
      } finally {
        // Always clean up temp WAV, even on error
        await unlink(wavPath).catch(() => {
          // Best-effort: OS temp dir cleaned on reboot; file is small
        });
      }
    }
  );
}
