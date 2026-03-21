import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerSnapshotTools(server: McpServer): void {
  server.tool(
    'snapshot_save',
    'Save the current mixer state as a named snapshot. Uses SWS Snapshots if available, otherwise captures track volumes, pans, mutes, solos, and FX bypass states manually.',
    {
      name: z.string().min(1).describe('Unique snapshot name (e.g. "before-compression", "v1-mix")'),
      description: z.string().optional().describe('Optional human-readable description'),
    },
    async ({ name, description }) => {
      const res = await sendCommand('snapshot_save', { name, description });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'snapshot_restore',
    'Restore a previously saved mixer snapshot by name',
    {
      name: z.string().min(1).describe('Name of the snapshot to restore'),
    },
    async ({ name }) => {
      const res = await sendCommand('snapshot_restore', { name });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'snapshot_list',
    'List all saved mixer snapshots with names, descriptions, and timestamps',
    {},
    async () => {
      const res = await sendCommand('snapshot_list', {});
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
