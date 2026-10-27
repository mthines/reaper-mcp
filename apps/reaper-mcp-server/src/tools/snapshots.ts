import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerSnapshotTools(server: McpServer): void {
  server.tool(
    'snapshot_save',
    'Save the current mixer state as a named snapshot. Stored in .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). By default captures ALL tracks\' volumes, pans, mutes, solos, FX bypass/offline states, full FX parameter values, preset names, track names/colors, and send levels. Pass trackIndices to scope the snapshot to specific tracks (e.g. just the master bus for an A/B that never touches other tracks). Pass fullChunk (or rely on its default-on when scoped) to capture exact track state chunks, which faithfully reproduce each plugin\'s internal state on restore — including plugins whose tone is driven by internal snapshots (e.g. Helix Native) that parameter-value capture cannot reproduce. Response includes storageLocation, scoped, fullChunk, and tracksCaptured.',
    {
      name: z.string().min(1).describe('Unique snapshot name (e.g. "before-compression", "v1-mix")'),
      description: z.string().optional().describe('Optional human-readable description'),
      includeFxParams: z.boolean().optional().default(true).describe('Include FX parameter values in snapshot (default true). Only applies to non-chunk capture.'),
      maxParamsPerFx: z.coerce.number().int().min(1).max(2000).optional().default(500).describe('Max parameters to capture per FX plugin (default 500). Only applies to non-chunk capture.'),
      trackIndices: z.array(z.coerce.number().int().min(0)).optional().describe('Restrict the snapshot to these 0-based track indices. Omit to capture all tracks. Restoring a scoped snapshot only affects the listed tracks.'),
      fullChunk: z.boolean().optional().describe('Capture exact track state chunks (complete FX internal state, e.g. Helix Native snapshots) instead of parameter values. Defaults to true when trackIndices is set, false otherwise (whole-project chunk snapshots are large).'),
    },
    async ({ name, description, includeFxParams, maxParamsPerFx, trackIndices, fullChunk }) => {
      const res = await sendCommand('snapshot_save', { name, description, includeFxParams, maxParamsPerFx, trackIndices, fullChunk });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'snapshot_restore',
    'Restore a previously saved mixer snapshot by name. Reads from .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). For chunk-based snapshots (saved with fullChunk), restores each captured track exactly via its state chunk — reproducing complete FX internal state (incl. plugin internal snapshots like Helix Native) and affecting only the tracks the snapshot captured. For parameter-based snapshots, restores volumes, pans, mutes, solos, FX bypass states, and FX parameters (parameters only when the plugin name matches, to avoid applying wrong values).',
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

  server.tool(
    'snapshot_delete',
    'Delete a named mixer snapshot. Removes the snapshot file from .reaper-mcp/snapshots/ alongside the project file (or global bridge dir for unsaved projects). This action is permanent and cannot be undone.',
    {
      name: z.string().min(1).describe('Name of the snapshot to delete'),
    },
    async ({ name }) => {
      const res = await sendCommand('snapshot_delete', { name });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
