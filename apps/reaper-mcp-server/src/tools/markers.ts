import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import { bridgeText, reply } from './project.js';

export function registerMarkerTools(server: McpServer): void {
  server.tool(
    'list_markers',
    'List all project markers with index, name, position, and color',
    {},
    async () => {
      const res = await sendCommand('list_markers');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'list_regions',
    'List all project regions with index, name, start/end positions, and color',
    {},
    async () => {
      const res = await sendCommand('list_regions');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'add_marker',
    'Add a project marker at a position in seconds, with optional name and color',
    {
      position: z.coerce.number().min(0).describe('Position in seconds'),
      name: z.string().optional().describe('Marker name'),
      color: z.coerce.number().optional().describe('REAPER native color int (0 = default)'),
    },
    async ({ position, name, color }) => {
      const res = await sendCommand('add_marker', { position, name, color });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'add_region',
    'Add a project region with start/end in seconds, optional name and color',
    {
      start: z.coerce.number().min(0).describe('Region start in seconds'),
      end: z.coerce.number().min(0).describe('Region end in seconds'),
      name: z.string().optional().describe('Region name'),
      color: z.coerce.number().optional().describe('REAPER native color int (0 = default)'),
    },
    async ({ start, end, name, color }) => {
      const res = await sendCommand('add_region', { start, end, name, color });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'delete_marker',
    'Delete a project marker by its marker index number',
    {
      markerIndex: z.coerce.number().int().min(0).describe('Marker index number'),
    },
    async ({ markerIndex }) => {
      const res = await sendCommand('delete_marker', { markerIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Deleted marker ${markerIndex}` }] };
    }
  );

  server.tool(
    'delete_region',
    'Delete a project region by its region index number',
    {
      regionIndex: z.coerce.number().int().min(0).describe('Region index number'),
    },
    async ({ regionIndex }) => {
      const res = await sendCommand('delete_region', { regionIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Deleted region ${regionIndex}` }] };
    }
  );

  registerMarkerEditTools(server);
}

// --- Marker / region editing (logic in reaper/mcp_project_lib.lua) ---


function registerMarkerEditTools(server: McpServer): void {
  server.tool(
    'edit_marker',
    'Rename, move or recolor an existing marker by its marker index number (from list_markers). Unspecified fields keep their values; name "" clears the name. Color is a native color int, stored with REAPER\'s 0x1000000 "custom color" flag. Unknown markers change nothing.',
    {
      markerIndex: z.coerce.number().int().min(0).describe('Marker index number (list_markers index)'),
      name: bridgeText.optional().describe('New name ("" clears it)'),
      position: z.coerce.number().min(0).optional().describe('New position in seconds'),
      color: z.coerce.number().int().min(0).optional().describe('Native color int (e.g. ColorToNative(r,g,b)); 0 keeps the current color'),
    },
    async (params) => reply(await sendCommand('edit_marker', params)),
  );

  server.tool(
    'edit_region',
    'Rename, move/resize or recolor an existing region by its region index number (from list_regions). Unspecified fields keep their values; end must stay after start. Unknown regions change nothing.',
    {
      regionIndex: z.coerce.number().int().min(0).describe('Region index number (list_regions index)'),
      name: bridgeText.optional().describe('New name ("" clears it)'),
      start: z.coerce.number().min(0).optional().describe('New start in seconds'),
      end: z.coerce.number().min(0).optional().describe('New end in seconds'),
      color: z.coerce.number().int().min(0).optional().describe('Native color int; 0 keeps the current color'),
    },
    async (params) => reply(await sendCommand('edit_region', params)),
  );
}
