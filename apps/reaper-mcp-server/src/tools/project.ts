import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerProjectTools(server: McpServer): void {
  server.tool(
    'get_project_info',
    'Get current REAPER project info: name, track count, tempo, time signature, sample rate, transport state',
    {},
    async () => {
      const res = await sendCommand('get_project_info');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
