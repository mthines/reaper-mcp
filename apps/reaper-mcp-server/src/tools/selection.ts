import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerSelectionTools(server: McpServer): void {
  server.tool(
    'get_selected_tracks',
    'Get all currently selected tracks in REAPER with their indices and names; a selected master track is listed first as index -1',
    {},
    async () => {
      const res = await sendCommand('get_selected_tracks');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'get_time_selection',
    'Get the current time selection (loop selection) start and end in seconds',
    {},
    async () => {
      const res = await sendCommand('get_time_selection');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_time_selection',
    'Set the time selection (loop selection) to a start and end position in seconds',
    {
      start: z.coerce.number().min(0).describe('Start position in seconds'),
      end: z.coerce.number().min(0).describe('End position in seconds'),
    },
    async ({ start, end }) => {
      const res = await sendCommand('set_time_selection', { start, end });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Time selection set: ${start}s - ${end}s` }] };
    }
  );

  const selectionMode = z
    .enum(['replace', 'add'])
    .optional()
    .describe('replace (default): select exactly these; add: keep the current selection');

  server.tool(
    'set_selected_tracks',
    'Select tracks by 0-based index, exact name, or "{GUID}" — usually before run_action, since most actions act on the selection. ' +
      'Every track is resolved first: an unknown or ambiguous one changes nothing. Returns the selection afterwards.',
    {
      tracks: z
        .array(z.union([z.number().int().min(-1), z.string().min(1)]))
        .min(1)
        .max(1000)
        .describe('Tracks to select: index (-1 or "master" = master track), exact name, or "{GUID}". A digit string means a track name first, then the index.'),
      mode: selectionMode,
    },
    async ({ tracks, mode }) => {
      const res = await sendCommand('set_selected_tracks', { tracks: JSON.stringify(tracks), mode });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_selected_items',
    'Select media items by track and item index (as list_media_items reports them) — usually before run_action. ' +
      'Every item is resolved first: a missing one changes nothing. Returns the selection afterwards.',
    {
      items: z
        .array(z.object({
          trackIndex: z.coerce.number().int().min(0).describe('0-based track index'),
          itemIndex: z.coerce.number().int().min(0).describe('0-based item index on that track'),
        }))
        .min(1)
        .max(1000),
      mode: selectionMode,
    },
    async ({ items, mode }) => {
      const res = await sendCommand('set_selected_items', { items: JSON.stringify(items), mode });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
