import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerDiscoveryTools(server: McpServer): void {
  server.tool(
    'list_available_fx',
    'Enumerate all installed FX plugins in REAPER (VST, VST3, JS, CLAP, AU) with an optional category filter',
    {
      category: z.string().optional().describe('Optional filter: e.g. "VST", "VST3", "JS", "AU", "CLAP"'),
    },
    async ({ category }) => {
      const res = await sendCommand('list_available_fx', { category });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'search_fx',
    'Search installed FX plugins by name (case-insensitive substring match)',
    {
      query: z.string().min(1).describe('Search term to match against FX plugin names'),
    },
    async ({ query }) => {
      const res = await sendCommand('search_fx', { query });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
