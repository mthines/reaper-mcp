import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

const trackIndex = z.coerce.number().int().min(-1).describe('Zero-based track index (-1 = master track)');
const envelopeIndex = z.coerce.number().int().min(0).describe('Zero-based envelope index on the track (from get_track_envelopes)');
const automationItemIndex = z.coerce
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    'Work on the points inside this automation item (from list_automation_items) instead of the underlying envelope. ' +
      'Pooled instances share their points, so this edits every instance of the pool.',
  );
const shape = z.coerce.number().int().min(0).max(5).optional().describe('Shape: 0=linear, 1=square, 2=slow start/end, 3=fast start, 4=fast end, 5=bezier');
const tension = z.coerce.number().min(-1).max(1).optional().describe('Tension for bezier shape (-1.0 to 1.0)');

const VALUE_HELP =
  'Give `db` on volume envelopes (Volume, Trim Volume, Send Volume): it is converted with the envelope\'s own scaling ' +
  '(fader-scaled volume envelopes store 716.2 for 0 dB, not 1.0). `value` is the raw envelope value (pan -1..1, mute 0/1, FX parameter 0..1).';

const automationItemFields = {
  startOffset: z.coerce.number().optional().describe('Seconds into the pool\'s points where this instance starts'),
  playRate: z.coerce.number().positive().optional().describe('Play rate (1 = normal)'),
  baseline: z.coerce.number().min(0).max(1).optional().describe('Baseline 0..1 (0.5 = unchanged)'),
  amplitude: z.coerce.number().min(-1).max(1).optional().describe('Amplitude -1..1 (1 = unchanged)'),
  loop: z.boolean().optional().describe('Loop the pool\'s points when the item is longer than them'),
  name: z.string().optional().describe('Pool name, shared by every instance (e.g. "Vox Chorus")'),
};

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: true };

async function run(command: Parameters<typeof sendCommand>[0], params: Record<string, unknown>): Promise<ToolResult> {
  const res = await sendCommand(command, params);
  if (!res.success) {
    return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
  }
  return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
}

export function registerEnvelopeTools(server: McpServer): void {
  server.tool(
    'get_track_envelopes',
    'List all automation envelopes on a track (volume, pan, mute, FX params, etc.) with point and automation item counts',
    { trackIndex },
    async (params) => run('get_track_envelopes', params),
  );

  server.tool(
    'get_envelope_points',
    'Get automation points for a track envelope (or one automation item) with pagination. Returns time, raw value, shape, tension per point, plus `db` on volume envelopes.',
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex,
      offset: z.coerce.number().int().min(0).optional().describe('Skip first N points (default 0)'),
      limit: z.coerce.number().int().min(1).optional().describe('Max points to return (default all)'),
    },
    async (params) => run('get_envelope_points', params),
  );

  server.tool(
    'insert_envelope_point',
    `Insert an automation point on a track envelope (or inside an automation item) at a time in seconds. ${VALUE_HELP}`,
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex,
      time: z.coerce.number().describe('Time position in seconds (project time)'),
      value: z.coerce.number().optional().describe('Raw envelope value'),
      db: z.coerce.number().optional().describe('Level in dB (volume envelopes only), instead of value'),
      shape,
      tension,
    },
    async (params) => run('insert_envelope_point', params),
  );

  server.tool(
    'insert_envelope_points',
    `Batch insert automation points on a track envelope (or inside an automation item). Much faster than repeated insert_envelope_point calls. ${VALUE_HELP}`,
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex,
      points: z.string().describe('JSON array of point objects: [{time, value | db, shape?, tension?}, ...]'),
    },
    async (params) => run('insert_envelope_points', params),
  );

  server.tool(
    'edit_envelope_points',
    `Edit existing automation points by index (from get_envelope_points): move them, change their level, shape or tension. Fields left out keep their value; all edits are validated before any is written. ${VALUE_HELP}`,
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex,
      points: z.string().describe('JSON array: [{index, time?, value? | db?, shape?, tension?}, ...]'),
    },
    async (params) => run('edit_envelope_points', params),
  );

  server.tool(
    'delete_envelope_point',
    'Delete one automation point by its index (from get_envelope_points); returns the deleted point',
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex,
      pointIndex: z.coerce.number().int().min(0).describe('Zero-based point index'),
    },
    async (params) => run('delete_envelope_point', params),
  );

  server.tool(
    'create_track_envelope',
    'Create/show an automation envelope on a track. Use envelopeName for built-in envelopes (Volume, Pan, Mute, Width, Trim Volume) or fxIndex+paramIndex for FX parameter envelopes. The envelope is made visible and active; an existing one is only shown (`created: false`). The track selection is left as it was.',
    {
      trackIndex,
      envelopeName: z.string().optional().describe('Built-in envelope name: "Volume", "Pan", "Mute", "Width", "Trim Volume"'),
      fxIndex: z.coerce.number().int().min(0).optional().describe('FX chain index (for FX parameter envelopes)'),
      paramIndex: z.coerce.number().int().min(0).optional().describe('FX parameter index (required if fxIndex provided)'),
    },
    async (params) => run('create_track_envelope', params),
  );

  server.tool(
    'set_envelope_properties',
    'Set properties (active, visible, armed) on a track envelope. Requires SWS extension for full support.',
    {
      trackIndex,
      envelopeIndex,
      active: z.boolean().optional().describe('Set envelope active/inactive'),
      visible: z.boolean().optional().describe('Set envelope visible/hidden in arrange view'),
      armed: z.boolean().optional().describe('Set envelope armed for writing automation'),
    },
    async (params) => run('set_envelope_properties', params),
  );

  server.tool(
    'clear_envelope',
    'Delete ALL automation points from an envelope (or from one automation item\'s pool), resetting it to its default state',
    { trackIndex, envelopeIndex, automationItemIndex },
    async (params) => run('clear_envelope', params),
  );

  server.tool(
    'remove_envelope_points',
    'Delete automation points in a time range from a track envelope (or automation item). Use to surgically remove a section of automation.',
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex,
      timeStart: z.coerce.number().describe('Start of time range in seconds (inclusive)'),
      timeEnd: z.coerce.number().describe('End of time range in seconds (exclusive)'),
    },
    async (params) => run('remove_envelope_points', params),
  );

  server.tool(
    'list_automation_items',
    'List the automation items on an envelope: index, poolId, pool name, position, length, loop, baseline/amplitude and point count. Items with the same poolId share their points.',
    { trackIndex, envelopeIndex },
    async (params) => run('list_automation_items', params),
  );

  server.tool(
    'insert_automation_item',
    'Insert an automation item on an envelope. Without poolId it starts a new pool, filled from `points` (times in seconds from the item start); ' +
      'with the poolId of an existing item (on any track) it adds a pooled instance with the same points, so editing one edits all; pooledWith counts the other instances in the project (use this for repeated sections such as every chorus). ' +
      'captureEnvelope moves the underlying envelope points in the range into the new item instead. Automation items override the underlying envelope where they sit.',
    {
      trackIndex,
      envelopeIndex,
      position: z.coerce.number().min(0).describe('Item start in seconds'),
      length: z.coerce.number().positive().describe('Item length in seconds'),
      poolId: z.coerce.number().int().min(0).optional().describe('Existing pool to instance (from list_automation_items)'),
      points: z.string().optional().describe(`New pool only. JSON array [{time, value | db, shape?, tension?}], time from the item start. ${VALUE_HELP}`),
      captureEnvelope: z.boolean().optional().describe('Move the underlying points in range into the item (new pool)'),
      ...automationItemFields,
    },
    async (params) => run('insert_automation_item', params),
  );

  server.tool(
    'set_automation_item',
    'Move, resize or change an automation item: position, length, start offset, play rate, baseline, amplitude, loop, pool name. Points are edited with edit_envelope_points and automationItemIndex.',
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex: z.coerce.number().int().min(0).describe('Automation item index (from list_automation_items)'),
      position: z.coerce.number().min(0).optional().describe('Item start in seconds'),
      length: z.coerce.number().positive().optional().describe('Item length in seconds'),
      ...automationItemFields,
    },
    async (params) => run('set_automation_item', params),
  );

  server.tool(
    'delete_automation_item',
    'Delete one automation item. Its pool lives on while other instances use it. preservePoints keeps its points on the underlying envelope. Other selections are left as they were.',
    {
      trackIndex,
      envelopeIndex,
      automationItemIndex: z.coerce.number().int().min(0).describe('Automation item index (from list_automation_items)'),
      preservePoints: z.boolean().optional().describe('Keep the item\'s points on the underlying envelope'),
    },
    async (params) => run('delete_automation_item', params),
  );
}
