import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerRoutingTools(server: McpServer): void {
  server.tool(
    'get_track_routing',
    'Get sends, receives, and parent/folder information for a track — useful for understanding bus structure',
    {
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('get_track_routing', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
