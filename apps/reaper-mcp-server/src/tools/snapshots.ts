import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerSnapshotTools(server: McpServer): void {
  server.tool(
    'snapshot_save',
    'Save the current mixer state as a named snapshot. Stored in .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). By default captures ALL tracks\' volumes, pans, mutes, solos, FX bypass/offline states, full FX parameter values, preset names, track names/colors, and send levels. Pass trackIndices to scope the snapshot to specific tracks (e.g. just the master bus for an A/B that never touches other tracks). Pass fullChunk (or rely on its default-on when scoped) to capture exact track state chunks, which faithfully reproduce each plugin\'s internal state on restore — including plugins whose tone is driven by internal snapshots (e.g. Helix Native) that parameter-value capture cannot reproduce. Pass stretchMarkers to also keep the stretch markers of every audio item on the captured tracks (an alignment or a stretch edit): they are stored on their own, so they come back even where REAPER refuses to apply a track chunk (seen on tracks whose items carry Melodyne take FX). A fullChunk snapshot also holds each track\'s items (the whole chunk comes back on restore); without fullChunk a snapshot holds no items, only the stretch markers when asked for. Response includes storageLocation, scoped, fullChunk, tracksCaptured, and stretchMarkerItems.',
    {
      name: z.string().min(1).describe('Unique snapshot name (e.g. "before-compression", "v1-mix")'),
      description: z.string().optional().describe('Optional human-readable description'),
      includeFxParams: z.boolean().optional().default(true).describe('Include FX parameter values in snapshot (default true). Only applies to non-chunk capture.'),
      maxParamsPerFx: z.coerce.number().int().min(1).max(2000).optional().default(500).describe('Max parameters to capture per FX plugin (default 500). Only applies to non-chunk capture.'),
      trackIndices: z.array(z.coerce.number().int().min(0)).optional().describe('Restrict the snapshot to these 0-based track indices. Omit to capture all tracks. Restoring a scoped snapshot only affects the listed tracks.'),
      fullChunk: z.boolean().optional().describe('Capture exact track state chunks (complete FX internal state, e.g. Helix Native snapshots) instead of parameter values. Defaults to true when trackIndices is set, false otherwise (whole-project chunk snapshots are large).'),
      stretchMarkers: z.boolean().optional().describe('Also keep the stretch markers of every audio item on the captured tracks (default false). Restoring puts them back on the same items (found by GUID, else by track, position and length). Up to 5000 audio items: scope with trackIndices for a big project.'),
    },
    async ({ name, description, includeFxParams, maxParamsPerFx, trackIndices, fullChunk, stretchMarkers }) => {
      const res = await sendCommand('snapshot_save', { name, description, includeFxParams, maxParamsPerFx, trackIndices, fullChunk, stretchMarkers });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'snapshot_restore',
    'Restore a previously saved mixer snapshot by name. Reads from .reaper-mcp/snapshots/ alongside the project file (falls back to global bridge dir for unsaved projects). For chunk-based snapshots (saved with fullChunk), restores each captured track exactly via its state chunk — reproducing complete FX internal state (incl. plugin internal snapshots like Helix Native) and affecting only the tracks the snapshot captured. For parameter-based snapshots, restores volumes, pans, mutes, solos, FX bypass states, and FX parameters (parameters only when the plugin name matches, to avoid applying wrong values). Stretch markers saved with the snapshot are put back on their items afterwards, also when a track chunk could not be applied (the reply field stretchMarkers counts restored, unchanged and missing items).',
    {
      name: z.string().min(1).describe('Name of the snapshot to restore'),
      restoreTrackMeta: z.boolean().optional().default(false).describe('Also restore track names and colors (default false)'),
      restoreSendLevels: z.boolean().optional().default(true).describe('Restore send volume/pan/mute for existing sends (default true)'),
      restoreStretchMarkers: z.boolean().optional().default(true).describe('Put back the stretch markers saved with the snapshot (default true; only snapshots saved with stretchMarkers hold any)'),
    },
    async ({ name, restoreTrackMeta, restoreSendLevels, restoreStretchMarkers }) => {
      const res = await sendCommand('snapshot_restore', { name, restoreTrackMeta, restoreSendLevels, restoreStretchMarkers });
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

  server.tool(
    'snapshot_edit',
    'Rename a mixer snapshot and/or change its description. The saved mixer state is kept. A new name whose file belongs to another snapshot is refused.',
    {
      name: z.string().min(1).describe('Name of the snapshot to edit'),
      newName: z.string().min(1).optional().describe('New name; omit to keep the name'),
      description: z.string().optional().describe('New description; omit to keep it, "" clears it'),
    },
    async ({ name, newName, description }) => {
      const res = await sendCommand('snapshot_edit', { name, newName, description });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
