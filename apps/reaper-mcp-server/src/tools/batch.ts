import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

/**
 * Composite batch tools that collapse common multi-step workflows into a single MCP call.
 * These reduce round-trips for operations that would otherwise require N sequential calls.
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    'set_multiple_track_properties',
    'Batch set properties (volume, pan, mute, solo, recordArm, phase, input) on multiple tracks in a single call. Much more efficient than calling set_track_property repeatedly. Pass an array of track update objects, each with trackIndex and any properties to change.',
    {
      tracks: z.array(z.object({
        trackIndex: z.coerce.number().int().min(0).describe('0-based track index'),
        volume: z.coerce.number().optional().describe('Volume in dB (0 = unity gain)'),
        pan: z.coerce.number().min(-1).max(1).optional().describe('Pan position -1.0 (left) to 1.0 (right)'),
        mute: z.coerce.number().int().min(0).max(1).optional().describe('Mute state (0=unmuted, 1=muted)'),
        solo: z.coerce.number().int().min(0).max(1).optional().describe('Solo state (0=unsolo, 1=solo)'),
        recordArm: z.coerce.number().int().min(0).max(1).optional().describe('Record arm state (0=unarmed, 1=armed)'),
        phase: z.coerce.number().int().min(0).max(1).optional().describe('Phase inversion (0=normal, 1=inverted)'),
        input: z.coerce.number().int().optional().describe('REAPER input index (-1 = no input)'),
      })).describe('Array of track property updates to apply'),
    },
    async ({ tracks }) => {
      const res = await sendCommand('set_multiple_track_properties', { tracks });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'setup_fx_chain',
    'Add multiple FX plugins to a track with optional initial parameter values in a single call. Returns the FX chain indices of added plugins. More efficient than calling add_fx and set_fx_parameter repeatedly.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('0-based track index'),
      plugins: z.array(z.object({
        fxName: z.string().describe('FX plugin name (partial match supported, e.g. "ReaEQ", "VST: Pro-Q 3")'),
        enabled: z.coerce.number().int().min(0).max(1).optional().describe('Initial enabled state (1=enabled default, 0=bypassed)'),
        parameters: z.array(z.object({
          index: z.coerce.number().int().min(0).describe('Parameter index'),
          value: z.coerce.number().min(0).max(1).describe('Normalized parameter value 0.0–1.0'),
        })).optional().describe('Initial parameter values to set after adding the plugin'),
      })).describe('Array of FX plugins to add, in order'),
    },
    async ({ trackIndex, plugins }) => {
      const res = await sendCommand('setup_fx_chain', { trackIndex, plugins });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );

  server.tool(
    'set_multiple_fx_parameters',
    'Batch set parameters across multiple FX plugins, potentially on different tracks, in a single call. Much faster than repeated set_fx_parameter calls. Pass an array of update objects with trackIndex, fxIndex, paramIndex, and value.',
    {
      updates: z.array(z.object({
        trackIndex: z.coerce.number().int().min(0).describe('0-based track index'),
        fxIndex: z.coerce.number().int().min(0).describe('0-based FX index in the chain'),
        paramIndex: z.coerce.number().int().min(0).describe('0-based parameter index'),
        value: z.coerce.number().min(0).max(1).describe('Normalized parameter value 0.0–1.0'),
      })).describe('Array of FX parameter updates to apply'),
    },
    async ({ updates }) => {
      const res = await sendCommand('set_multiple_fx_parameters', { updates });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );
}
