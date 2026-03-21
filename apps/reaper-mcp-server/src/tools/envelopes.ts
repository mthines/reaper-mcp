import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerEnvelopeTools(server: McpServer): void {
  server.tool(
    'get_track_envelopes',
    'List all automation envelopes on a track (volume, pan, mute, FX params, etc.) with point counts',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
    },
    async ({ trackIndex }) => {
      const res = await sendCommand('get_track_envelopes', { trackIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'get_envelope_points',
    'Get automation points for a track envelope with pagination. Returns time, value, shape, tension per point.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      envelopeIndex: z.coerce.number().int().min(0).describe('Zero-based envelope index on the track'),
      offset: z.coerce.number().int().min(0).optional().describe('Skip first N points (default 0)'),
      limit: z.coerce.number().int().min(1).optional().describe('Max points to return (default all)'),
    },
    async ({ trackIndex, envelopeIndex, offset, limit }) => {
      const res = await sendCommand('get_envelope_points', { trackIndex, envelopeIndex, offset, limit });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'insert_envelope_point',
    'Insert an automation point on a track envelope at a given time with value and optional shape/tension',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      envelopeIndex: z.coerce.number().int().min(0).describe('Zero-based envelope index on the track'),
      time: z.coerce.number().describe('Time position in seconds'),
      value: z.coerce.number().describe('Envelope value (scale depends on envelope type)'),
      shape: z.coerce.number().int().min(0).max(5).optional().describe('Shape: 0=linear, 1=square, 2=slow start/end, 3=fast start, 4=fast end, 5=bezier'),
      tension: z.coerce.number().min(-1).max(1).optional().describe('Tension for bezier shape (-1.0 to 1.0)'),
    },
    async ({ trackIndex, envelopeIndex, time, value, shape, tension }) => {
      const res = await sendCommand('insert_envelope_point', {
        trackIndex, envelopeIndex, time, value, shape, tension,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'delete_envelope_point',
    'Delete an automation point from a track envelope by point index',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      envelopeIndex: z.coerce.number().int().min(0).describe('Zero-based envelope index on the track'),
      pointIndex: z.coerce.number().int().min(0).describe('Zero-based point index'),
    },
    async ({ trackIndex, envelopeIndex, pointIndex }) => {
      const res = await sendCommand('delete_envelope_point', {
        trackIndex, envelopeIndex, pointIndex,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Deleted envelope point ${pointIndex}` }] };
    }
  );
}
