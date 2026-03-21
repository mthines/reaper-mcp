import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerTransportTools(server: McpServer): void {
  server.tool(
    'play',
    'Start playback in REAPER',
    {},
    async () => {
      const res = await sendCommand('play');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: 'Playback started' }] };
    }
  );

  server.tool(
    'stop',
    'Stop playback/recording in REAPER',
    {},
    async () => {
      const res = await sendCommand('stop');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: 'Playback stopped' }] };
    }
  );

  server.tool(
    'record',
    'Start recording in REAPER (arms must be set on target tracks)',
    {},
    async () => {
      const res = await sendCommand('record');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: 'Recording started' }] };
    }
  );

  server.tool(
    'get_transport_state',
    'Get current transport state: play/record/pause status, cursor positions, tempo, time signature',
    {},
    async () => {
      const res = await sendCommand('get_transport_state');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_cursor_position',
    'Move the edit cursor to a specific position in seconds from project start',
    {
      position: z.number().min(0).describe('Position in seconds from project start'),
    },
    async ({ position }) => {
      const res = await sendCommand('set_cursor_position', { position });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Cursor moved to ${position}s` }] };
    }
  );
}
