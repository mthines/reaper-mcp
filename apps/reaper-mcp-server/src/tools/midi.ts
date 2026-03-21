import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerMidiTools(server: McpServer): void {
  server.tool(
    'create_midi_item',
    'Create an empty MIDI item on a track at a given time range (seconds). Use this before inserting notes.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      startPosition: z.coerce.number().min(0).describe('Start position in seconds from project start'),
      endPosition: z.coerce.number().min(0).describe('End position in seconds from project start'),
    },
    async ({ trackIndex, startPosition, endPosition }) => {
      const res = await sendCommand('create_midi_item', { trackIndex, startPosition, endPosition });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'list_midi_items',
    'List all MIDI items on a track with position, length, and note/CC counts',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('list_midi_items', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'get_midi_notes',
    'Get all MIDI notes in a MIDI item. Returns pitch (0-127, 60=C4), velocity (0-127), position and duration in beats from item start.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
    },
    async ({ trackIndex, itemIndex }) => {
      const res = await sendCommand('get_midi_notes', { trackIndex, itemIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'insert_midi_note',
    'Insert a single MIDI note. Pitch: 0-127 (60=C4/Middle C, 48=C3, 72=C5). Velocity: 1-127 (64=medium, 100=strong, 127=max). Position/duration in beats from item start (1.0=quarter, 0.5=eighth, 0.25=sixteenth).',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      pitch: z.coerce.number().min(0).max(127).describe('MIDI note number (60=C4/Middle C)'),
      velocity: z.coerce.number().min(1).max(127).describe('Note velocity (1-127)'),
      startPosition: z.coerce.number().min(0).describe('Start position in beats from item start'),
      duration: z.coerce.number().min(0).describe('Duration in beats (1.0=quarter note)'),
      channel: z.coerce.number().min(0).max(15).optional().describe('MIDI channel 0-15 (default 0)'),
    },
    async ({ trackIndex, itemIndex, pitch, velocity, startPosition, duration, channel }) => {
      const res = await sendCommand('insert_midi_note', {
        trackIndex, itemIndex, pitch, velocity, startPosition, duration, channel: channel ?? 0,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'insert_midi_notes',
    'Batch insert multiple MIDI notes. Pass a JSON array of notes as a string. Each note: { "pitch": 60, "velocity": 100, "startPosition": 0.0, "duration": 1.0, "channel": 0 }. Positions/durations in beats from item start.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      notes: z.string().describe('JSON array string of notes: [{"pitch":60,"velocity":100,"startPosition":0,"duration":1,"channel":0}, ...]'),
    },
    async ({ trackIndex, itemIndex, notes }) => {
      const res = await sendCommand('insert_midi_notes', { trackIndex, itemIndex, notes });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'edit_midi_note',
    'Edit an existing MIDI note by index. Only provided fields are changed. Positions/durations in beats from item start.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      noteIndex: z.coerce.number().min(0).describe('0-based note index'),
      pitch: z.coerce.number().min(0).max(127).optional().describe('New pitch (0-127)'),
      velocity: z.coerce.number().min(1).max(127).optional().describe('New velocity (1-127)'),
      startPosition: z.coerce.number().min(0).optional().describe('New start position in beats from item start'),
      duration: z.coerce.number().min(0).optional().describe('New duration in beats'),
      channel: z.coerce.number().min(0).max(15).optional().describe('New MIDI channel (0-15)'),
    },
    async ({ trackIndex, itemIndex, noteIndex, pitch, velocity, startPosition, duration, channel }) => {
      const res = await sendCommand('edit_midi_note', {
        trackIndex, itemIndex, noteIndex, pitch, velocity, startPosition, duration, channel,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'delete_midi_note',
    'Delete a MIDI note by index from a MIDI item',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      noteIndex: z.coerce.number().min(0).describe('0-based note index to delete'),
    },
    async ({ trackIndex, itemIndex, noteIndex }) => {
      const res = await sendCommand('delete_midi_note', { trackIndex, itemIndex, noteIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'get_midi_cc',
    'Get CC (continuous controller) events from a MIDI item. Optionally filter by CC number (e.g. 1=modulation, 7=volume, 10=pan, 11=expression, 64=sustain).',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      ccNumber: z.coerce.number().min(0).max(127).optional().describe('Optional: filter by CC number (0-127)'),
    },
    async ({ trackIndex, itemIndex, ccNumber }) => {
      const res = await sendCommand('get_midi_cc', { trackIndex, itemIndex, ccNumber });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'insert_midi_cc',
    'Insert a CC (continuous controller) event. Common CC numbers: 1=modulation, 7=volume, 10=pan, 11=expression, 64=sustain, 74=filter cutoff.',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      ccNumber: z.coerce.number().min(0).max(127).describe('CC number (0-127)'),
      value: z.coerce.number().min(0).max(127).describe('CC value (0-127)'),
      position: z.coerce.number().min(0).describe('Position in beats from item start'),
      channel: z.coerce.number().min(0).max(15).optional().describe('MIDI channel 0-15 (default 0)'),
    },
    async ({ trackIndex, itemIndex, ccNumber, value, position, channel }) => {
      const res = await sendCommand('insert_midi_cc', {
        trackIndex, itemIndex, ccNumber, value, position, channel: channel ?? 0,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'delete_midi_cc',
    'Delete a CC event by index from a MIDI item',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      ccIndex: z.coerce.number().min(0).describe('0-based CC event index to delete'),
    },
    async ({ trackIndex, itemIndex, ccIndex }) => {
      const res = await sendCommand('delete_midi_cc', { trackIndex, itemIndex, ccIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'get_midi_item_properties',
    'Get detailed properties of a MIDI item including position, length, note count, CC count, mute state, and loop setting',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
    },
    async ({ trackIndex, itemIndex }) => {
      const res = await sendCommand('get_midi_item_properties', { trackIndex, itemIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'set_midi_item_properties',
    'Set MIDI item properties: position (seconds), length (seconds), mute, loop source',
    {
      trackIndex: z.coerce.number().min(0).describe('0-based track index'),
      itemIndex: z.coerce.number().min(0).describe('0-based item index on the track'),
      position: z.coerce.number().min(0).optional().describe('New position in seconds from project start'),
      length: z.coerce.number().min(0).optional().describe('New length in seconds'),
      mute: z.coerce.number().min(0).max(1).optional().describe('Mute state (0=unmuted, 1=muted)'),
      loopSource: z.coerce.number().min(0).max(1).optional().describe('Loop source (0=no loop, 1=loop)'),
    },
    async ({ trackIndex, itemIndex, position, length, mute, loopSource }) => {
      const res = await sendCommand('set_midi_item_properties', {
        trackIndex, itemIndex, position, length, mute, loopSource,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );
}
