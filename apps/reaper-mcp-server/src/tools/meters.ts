import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerMeterTools(server: McpServer): void {
  server.tool(
    'read_track_meters',
    'Read real-time peak and RMS levels (in dB) for a track. Returns L/R peak and RMS values.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
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
    'Read real-time FFT frequency spectrum data for a track. Auto-inserts the MCP Spectrum Analyzer JSFX if not present. Returns frequency bins in dB from 0 Hz to Nyquist.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fftSize: z.coerce.number().int().optional().describe('FFT size (default 4096). Options: 512, 1024, 2048, 4096, 8192'),
    },
    async ({ trackIndex, fftSize }) => {
      const res = await sendCommand('read_track_spectrum', { trackIndex, fftSize: fftSize ?? 4096 });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
