import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerAnalysisTools(server: McpServer): void {
  server.tool(
    'read_track_lufs',
    'Read ITU-R BS.1770 loudness data for a track. Auto-inserts the MCP LUFS Meter JSFX if not present. Returns integrated, short-term (3s), and momentary (400ms) LUFS plus true inter-sample peak levels. Audio must be playing to accumulate data.',
    {
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
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
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
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
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('read_track_crest', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
