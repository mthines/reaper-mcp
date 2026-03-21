import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerTempoTools(server: McpServer): void {
  server.tool(
    'get_tempo_map',
    'Get all tempo and time signature change points in the project (tempo map markers)',
    {},
    async () => {
      const res = await sendCommand('get_tempo_map');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
