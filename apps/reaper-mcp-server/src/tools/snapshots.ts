import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerSnapshotTools(server: McpServer): void {
  server.tool(
    'snapshot_save',
    'Save the current mixer state as a named snapshot. Stored in .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). Captures track volumes, pans, mutes, solos, FX bypass/offline states, full FX parameter values, preset names, track names/colors, and send levels. Response includes storageLocation ("project" or "global").',
    {
      name: z.string().min(1).describe('Unique snapshot name (e.g. "before-compression", "v1-mix")'),
      description: z.string().optional().describe('Optional human-readable description'),
      includeFxParams: z.boolean().optional().default(true).describe('Include FX parameter values in snapshot (default true)'),
      maxParamsPerFx: z.coerce.number().int().min(1).max(2000).optional().default(500).describe('Max parameters to capture per FX plugin (default 500)'),
    },
    async ({ name, description, includeFxParams, maxParamsPerFx }) => {
      const res = await sendCommand('snapshot_save', { name, description, includeFxParams, maxParamsPerFx });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'snapshot_restore',
    'Restore a previously saved mixer snapshot by name. Reads from .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). Restores volumes, pans, mutes, solos, FX states, and optionally FX parameters (if snapshot is v2). FX parameters are only restored when the plugin name matches the snapshot to prevent applying wrong values.',
    {
      name: z.string().min(1).describe('Name of the snapshot to restore'),
      restoreTrackMeta: z.boolean().optional().default(false).describe('Also restore track names and colors (default false)'),
      restoreSendLevels: z.boolean().optional().default(true).describe('Restore send volume/pan/mute for existing sends (default true)'),
    },
    async ({ name, restoreTrackMeta, restoreSendLevels }) => {
      const res = await sendCommand('snapshot_restore', { name, restoreTrackMeta, restoreSendLevels });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'snapshot_list',
    'List all saved mixer snapshots for the current project. Reads from .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). Response includes storageLocation ("project" or "global").',
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
