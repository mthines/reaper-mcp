import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import type { TrackMeasurement } from '@reaper-mcp/protocol';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Why a read returned no usable data, or null when it did. A meter that never
 * processed audio leaves its gmem slot untouched: duration 0 and every value 0.
 */
export function noDataReason(metric: string, data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const numbers = Object.entries(d).filter(([k, v]) => typeof v === 'number' && k !== 'trackIndex').map(([, v]) => v as number);
  const silentMeter = metric === 'lufs'
    ? d['duration'] === 0 || d['measuring'] === false
    : numbers.length > 0 && numbers.every((v) => v === 0);
  return silentMeter
    ? 'no data — the meter received no audio (track muted, frozen, silent or not processed in this range); try analyze_track_offline'
    : null;
}

export function registerAnalysisTools(server: McpServer): void {
  server.tool(
    'read_track_lufs',
    'Read ITU-R BS.1770 loudness data for a track. Auto-inserts the MCP LUFS Meter JSFX if not present. Returns integrated, short-term (3s), and momentary (400ms) LUFS plus true inter-sample peak levels. Audio must be playing to accumulate data.',
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('read_track_lufs', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'read_track_correlation',
    'Read stereo field correlation and M/S analysis for a track. Auto-inserts the MCP Correlation Meter JSFX if not present. Returns correlation coefficient (-1 to +1), stereo width, and mid/side levels. Audio must be playing to accumulate data.',
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('read_track_correlation', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'read_track_crest',
    'Read crest factor (peak-to-RMS ratio) for a track. Auto-inserts the MCP Crest Factor Meter JSFX if not present. Returns crest factor in dB (higher = more dynamic, lower = over-compressed), peak hold level, and RMS level. Audio must be playing to accumulate data.',
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('read_track_crest', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'measure_tracks',
    'Play audio and collect analysis measurements (LUFS, crest factor, correlation, spectrum) for one or more tracks in a single call. Handles playback start/stop automatically. LUFS supports multi-track; crest/correlation/spectrum use global gmem and are only reliable for single-track measurement. The meters it inserts are removed afterwards unless keepMeters. A meter that received no audio (muted, frozen or silent track, nothing in range) is reported under errors, not as numbers. For whole-song, folder or master numbers without playback, prefer analyze_track_offline.',
    {
      trackIndices: z.array(z.coerce.number().int().min(-1)).min(1).max(8)
        .describe('Track indices to measure (max 8; -1 = master track)'),
      metrics: z.array(z.enum(['lufs', 'crest', 'correlation', 'spectrum'])).min(1)
        .describe('Which metrics to collect'),
      durationSeconds: z.coerce.number().min(1).max(30).default(5)
        .describe('How long to play for measurement (seconds)'),
      startPosition: z.coerce.number().min(0).optional()
        .describe('Project position to seek to before playing (seconds)'),
      fftSize: z.coerce.number().int().optional().default(4096)
        .describe('FFT size for spectrum analysis'),
      stopWhenDone: z.boolean().optional().default(true)
        .describe('Stop playback after measuring'),
      keepMeters: z.boolean().optional().default(false)
        .describe('Leave the MCP meter JSFX on the tracks (default: remove them afterwards)'),
    },
    async ({ trackIndices, metrics, durationSeconds, startPosition, fftSize, stopWhenDone, keepMeters }) => {
      try {
        // One read command per track and metric
        const reads: Array<{ trackIndex: number; metric: string; commandType: string; params: Record<string, unknown> }> = [];
        for (const trackIndex of trackIndices) {
          for (const metric of metrics) {
            let commandType: string;
            const params: Record<string, unknown> = { trackIndex };

            switch (metric) {
              case 'lufs':
                commandType = 'read_track_lufs';
                break;
              case 'crest':
                commandType = 'read_track_crest';
                break;
              case 'correlation':
                commandType = 'read_track_correlation';
                break;
              case 'spectrum':
                commandType = 'read_track_spectrum';
                params.fftSize = fftSize;
                break;
              default:
                continue;
            }
            reads.push({ trackIndex, metric, commandType, params });
          }
        }
        const sendReads = (prime: boolean) => reads.map((r) => ({
          trackIndex: r.trackIndex,
          metric: r.metric,
          promise: sendCommand(
            r.commandType as Parameters<typeof sendCommand>[0],
            prime && r.metric === 'lufs' ? { ...r.params, reset: true } : r.params,
          ),
        }));

        // Prime first: a read inserts the meter JSFX, so the meters exist before
        // the audio they measure; LUFS also restarts its integrated measurement.
        await Promise.all(sendReads(true).map((m) => m.promise));

        // Check current transport state
        const transportRes = await sendCommand('get_transport_state', {});
        const isPlaying = transportRes.success && (transportRes.data as { playing?: boolean })?.playing;

        // Seek and start playback if needed
        if (startPosition != null) {
          await sendCommand('set_cursor_position', { position: startPosition });
        }
        if (!isPlaying || startPosition != null) {
          await sendCommand('play', {});
        }

        // Wait for measurement accumulation
        await sleep(durationSeconds * 1000);

        // Collect all measurements in parallel
        const measurementPromises = sendReads(false);

        const results = await Promise.all(
          measurementPromises.map(async (m) => ({
            trackIndex: m.trackIndex,
            metric: m.metric,
            result: await m.promise,
          }))
        );

        // Get end position before stopping
        const endTransport = await sendCommand('get_transport_state', {});
        const endPosition = endTransport.success
          ? (endTransport.data as { playPosition?: number })?.playPosition ?? 0
          : 0;

        // Stop playback if requested
        if (stopWhenDone) {
          await sendCommand('stop', {});
        }

        // Merge results by track index
        const trackMap = new Map<number, TrackMeasurement>();
        for (const trackIndex of trackIndices) {
          trackMap.set(trackIndex, { trackIndex });
        }

        for (const { trackIndex, metric, result } of results) {
          const measurement = trackMap.get(trackIndex)!;
          const problem = !result.success ? result.error : noDataReason(metric, result.data);
          if (problem) {
            (measurement.errors ??= []).push(`${metric}: ${problem}`);
            continue;
          }
          switch (metric) {
            case 'lufs':
              measurement.lufs = result.data as TrackMeasurement['lufs'];
              break;
            case 'crest':
              measurement.crest = result.data as TrackMeasurement['crest'];
              break;
            case 'correlation':
              measurement.correlation = result.data as TrackMeasurement['correlation'];
              break;
            case 'spectrum':
              measurement.spectrum = result.data as TrackMeasurement['spectrum'];
              break;
          }
        }

        // Meters left behind clutter the user's chains and cost CPU
        let metersRemoved: boolean | undefined;
        if (!keepMeters) {
          const removal = await sendCommand('remove_mcp_meters', { trackIndices });
          metersRemoved = removal.success;
        }

        const output = {
          tracks: Array.from(trackMap.values()),
          ...(metersRemoved === false ? { warning: 'Could not remove the MCP meters; remove "MCP Meters" from these tracks by hand' } : {}),
          durationSeconds,
          startPosition: startPosition ?? 0,
          endPosition,
        };

        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
