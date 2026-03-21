import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerSelectionTools(server: McpServer): void {
  server.tool(
    'get_selected_tracks',
    'Get all currently selected tracks in REAPER with their indices and names',
    {},
    async () => {
      const res = await sendCommand('get_selected_tracks');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'get_time_selection',
    'Get the current time selection (loop selection) start and end in seconds',
    {},
    async () => {
      const res = await sendCommand('get_time_selection');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_time_selection',
    'Set the time selection (loop selection) to a start and end position in seconds',
    {
      start: z.coerce.number().min(0).describe('Start position in seconds'),
      end: z.coerce.number().min(0).describe('End position in seconds'),
    },
    async ({ start, end }) => {
      const res = await sendCommand('set_time_selection', { start, end });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Time selection set: ${start}s - ${end}s` }] };
    }
  );
}
