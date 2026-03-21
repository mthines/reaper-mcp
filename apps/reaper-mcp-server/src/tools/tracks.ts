import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerTrackTools(server: McpServer): void {
  server.tool(
    'list_tracks',
    'List all tracks in the current REAPER project with name, index, volume, mute/solo state, and folder structure',
    {},
    async () => {
      const res = await sendCommand('list_tracks');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'get_track_properties',
    'Get detailed properties of a specific track including volume, pan, mute, solo, and FX chain',
    { trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index') },
    async ({ trackIndex }) => {
      const res = await sendCommand('get_track_properties', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_track_property',
    'Set a track property: volume (dB), pan (-1.0 to 1.0), mute (0/1), or solo (0/1)',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      property: z.enum(['volume', 'pan', 'mute', 'solo']).describe('Property to set'),
      value: z.coerce.number().describe('Value: volume in dB, pan -1.0–1.0, mute/solo 0 or 1'),
    },
    async ({ trackIndex, property, value }) => {
      const res = await sendCommand('set_track_property', { trackIndex, property, value });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Set track ${trackIndex} ${property} = ${value}` }] };
    }
  );
}
