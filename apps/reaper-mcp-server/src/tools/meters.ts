import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import type { TrackSpectrum } from '@reaper-mcp/protocol';
import { summarizeSpectrum } from './spectrum.js';

const SPECTRUM_RETRIES = 4;
const SPECTRUM_RETRY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerMeterTools(server: McpServer): void {
  server.tool(
    'read_track_meters',
    'Read real-time peak and RMS levels (in dB) for a track. Returns L/R peak and RMS values.',
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('read_track_meters', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'read_track_spectrum',
    'Read the real-time frequency spectrum of a track while audio plays. Auto-inserts the MCP Spectrum Analyzer JSFX if not present. Returns 1/3-octave bands (25 Hz-16 kHz, ~0.5 s smoothed), each with raw `db` and K-weighted `kDb` (the BS.1770 weighting LUFS uses). Judge on `kDb`, never `db` (raw levels overstate the lows and understate 2-5 kHz), and compare a band only with the same band on another track or a reference. Pre-fader (the analyzer sits in the track FX chain); each read is a ~0.5 s snapshot, so read several times. Raw FFT bins only with includeBins.',
    {
      trackIndex: z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)'),
      fftSize: z.coerce.number().int().optional().describe('FFT size (default 4096). Options: 512, 1024, 2048, 4096, 8192'),
      includeBins: z.boolean().optional().describe('Also return every raw FFT bin (large: fftSize/2 values)'),
    },
    async ({ trackIndex, fftSize, includeBins }) => {
      // An analyzer this call inserts has not run an FFT yet, so the first read finds no data
      // (seen live: the second read, a moment later, works). Read again for up to ~1 s.
      let res = await sendCommand('read_track_spectrum', { trackIndex, fftSize: fftSize ?? 4096 });
      for (let i = 0; i < SPECTRUM_RETRIES && !res.success && res.error?.includes('not producing data yet'); i++) {
        await sleep(SPECTRUM_RETRY_MS);
        res = await sendCommand('read_track_spectrum', { trackIndex, fftSize: fftSize ?? 4096 });
      }
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      const summary = summarizeSpectrum(res.data as TrackSpectrum, includeBins);
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );
}
