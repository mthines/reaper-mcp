import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerMediaTools(server: McpServer): void {
  server.tool(
    'list_media_items',
    'List all media items on a track with position, length, name, volume, mute state, and whether it is MIDI or audio',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('list_media_items', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'get_media_item_properties',
    'Get detailed properties of a media item: position, length, volume, fades, play rate, take info, source file',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
    },
    async ({ trackIndex, itemIndex }) => {
      const res = await sendCommand('get_media_item_properties', { trackIndex, itemIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'set_media_item_properties',
    'Set media item properties: position (seconds), length (seconds), volume (dB), mute, fade in/out lengths, play rate',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      position: z.coerce.number().min(0).optional().describe('New position in seconds'),
      length: z.coerce.number().min(0).optional().describe('New length in seconds'),
      volume: z.coerce.number().optional().describe('New volume in dB (0 = unity gain)'),
      mute: z.coerce.number().min(0).max(1).optional().describe('Mute state (0=unmuted, 1=muted)'),
      fadeInLength: z.coerce.number().min(0).optional().describe('Fade-in length in seconds'),
      fadeOutLength: z.coerce.number().min(0).optional().describe('Fade-out length in seconds'),
      playRate: z.coerce.number().min(0.1).max(10).optional().describe('Playback rate (1.0=normal, 0.5=half, 2.0=double)'),
    },
    async ({ trackIndex, itemIndex, position, length, volume, mute, fadeInLength, fadeOutLength, playRate }) => {
      const res = await sendCommand('set_media_item_properties', {
        trackIndex, itemIndex, position, length, volume, mute, fadeInLength, fadeOutLength, playRate,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'split_media_item',
    'Split a media item at a given position (absolute project time in seconds). Returns info about both resulting items.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      position: z.coerce.number().min(0).describe('Split position in seconds (absolute project time)'),
    },
    async ({ trackIndex, itemIndex, position }) => {
      const res = await sendCommand('split_media_item', { trackIndex, itemIndex, position });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'delete_media_item',
    'Delete a media item from a track',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
    },
    async ({ trackIndex, itemIndex }) => {
      const res = await sendCommand('delete_media_item', { trackIndex, itemIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'move_media_item',
    'Move a media item to a new position and/or a different track',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index (current track)'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      newPosition: z.coerce.number().min(0).optional().describe('New position in seconds'),
      newTrackIndex: z.coerce.number().min(0).optional().describe('Move to this track (0-based index)'),
    },
    async ({ trackIndex, itemIndex, newPosition, newTrackIndex }) => {
      const res = await sendCommand('move_media_item', { trackIndex, itemIndex, newPosition, newTrackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'trim_media_item',
    'Trim a media item edges. Positive trimStart trims from the beginning (makes item shorter/later). Positive trimEnd trims from the end (makes item shorter). Negative values extend.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      trimStart: z.coerce.number().optional().describe('Seconds to trim from start (positive=trim in, negative=extend)'),
      trimEnd: z.coerce.number().optional().describe('Seconds to trim from end (positive=trim in, negative=extend)'),
    },
    async ({ trackIndex, itemIndex, trimStart, trimEnd }) => {
      const res = await sendCommand('trim_media_item', { trackIndex, itemIndex, trimStart, trimEnd });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'add_stretch_marker',
    'Add a stretch marker to a media item for time-stretching audio. Position is within the item (seconds from item start). Source position is the corresponding position in the original audio.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      position: z.coerce.number().min(0).describe('Position within the item in seconds (from item start)'),
      sourcePosition: z.coerce.number().min(0).optional().describe('Position in source audio in seconds (defaults to same as position)'),
    },
    async ({ trackIndex, itemIndex, position, sourcePosition }) => {
      const res = await sendCommand('add_stretch_marker', { trackIndex, itemIndex, position, sourcePosition });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'get_stretch_markers',
    'List all stretch markers in a media item with their positions and source positions',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
    },
    async ({ trackIndex, itemIndex }) => {
      const res = await sendCommand('get_stretch_markers', { trackIndex, itemIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'delete_stretch_marker',
    'Delete a stretch marker by index from a media item',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      markerIndex: z.coerce.number().min(0).describe('0-based stretch marker index'),
    },
    async ({ trackIndex, itemIndex, markerIndex }) => {
      const res = await sendCommand('delete_stretch_marker', { trackIndex, itemIndex, markerIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );
}
