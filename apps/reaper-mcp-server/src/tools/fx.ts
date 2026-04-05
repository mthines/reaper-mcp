import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerFxTools(server: McpServer): void {
  server.tool(
    'add_fx',
    'Add an FX plugin to a track by name (e.g. "ReaEQ", "JS: Schwa\'s Spectral Analyzer", "VST: Pro-Q 3")',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxName: z.string().describe('FX plugin name (partial match supported)'),
      position: z.coerce.number().int().optional().describe('Position in FX chain (-1 or omit for end)'),
    },
    async ({ trackIndex, fxName, position }) => {
      const res = await sendCommand('add_fx', { trackIndex, fxName, position: position ?? -1 });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'remove_fx',
    'Remove an FX plugin from a track by its index in the FX chain',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.coerce.number().int().min(0).describe('Zero-based FX index in the chain'),
    },
    async ({ trackIndex, fxIndex }) => {
      const res = await sendCommand('remove_fx', { trackIndex, fxIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Removed FX ${fxIndex} from track ${trackIndex}` }] };
    }
  );

  server.tool(
    'get_fx_parameters',
    'List parameters of an FX plugin with current values and ranges. Supports filtering by name pattern, changed-only filter, and pagination. For a quick summary of active EQ bands or compressor settings, use analyze_fx instead.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.coerce.number().int().min(0).describe('Zero-based FX index in the chain'),
      namePattern: z.string().optional().describe('Filter params by name (case-insensitive substring match, e.g. "Gain", "Band 1")'),
      changedOnly: z.boolean().optional().describe('Only return params that appear non-default (value differs from minimum or formatted value suggests activity)'),
      offset: z.coerce.number().int().min(0).optional().describe('Skip first N matching params (default 0)'),
      limit: z.coerce.number().int().min(1).optional().describe('Max params to return (default all)'),
    },
    async ({ trackIndex, fxIndex, namePattern, changedOnly, offset, limit }) => {
      const res = await sendCommand('get_fx_parameters', {
        trackIndex, fxIndex, namePattern, changedOnly, offset, limit,
      });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'analyze_fx',
    'Analyze an FX plugin and return a compact summary: FX name, preset, and notable (non-default) parameters. For EQ plugins, detects active bands with frequency/gain/Q/shape. For compressors, extracts threshold/ratio/attack/release/makeup. Use this before get_fx_parameters to understand what a plugin is doing without reading 500+ parameters.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.coerce.number().int().min(0).describe('Zero-based FX index in the chain'),
    },
    async ({ trackIndex, fxIndex }) => {
      const res = await sendCommand('analyze_fx', { trackIndex, fxIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_fx_parameter',
    'Set a specific FX parameter value (normalized 0.0–1.0)',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.coerce.number().int().min(0).describe('Zero-based FX index in the chain'),
      paramIndex: z.coerce.number().int().min(0).describe('Zero-based parameter index'),
      value: z.coerce.number().min(0).max(1).describe('Normalized parameter value 0.0–1.0'),
    },
    async ({ trackIndex, fxIndex, paramIndex, value }) => {
      const res = await sendCommand('set_fx_parameter', { trackIndex, fxIndex, paramIndex, value });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Set FX ${fxIndex} param ${paramIndex} = ${value}` }] };
    }
  );

  server.tool(
    'set_fx_enabled',
    'Enable or disable (bypass) an FX plugin on a track',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.coerce.number().int().min(0).describe('Zero-based FX index in the chain'),
      enabled: z.coerce.number().int().min(0).max(1).describe('1 = enabled, 0 = disabled (bypassed)'),
    },
    async ({ trackIndex, fxIndex, enabled }) => {
      const res = await sendCommand('set_fx_enabled', { trackIndex, fxIndex, enabled });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `FX ${fxIndex} on track ${trackIndex} ${enabled ? 'enabled' : 'disabled'}` }] };
    }
  );

  server.tool(
    'set_fx_offline',
    'Set an FX plugin online or offline. Offline FX uses no CPU but preserves settings.',
    {
      trackIndex: z.coerce.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.coerce.number().int().min(0).describe('Zero-based FX index in the chain'),
      offline: z.coerce.number().int().min(0).max(1).describe('1 = offline, 0 = online'),
    },
    async ({ trackIndex, fxIndex, offline }) => {
      const res = await sendCommand('set_fx_offline', { trackIndex, fxIndex, offline });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `FX ${fxIndex} on track ${trackIndex} set ${offline ? 'offline' : 'online'}` }] };
    }
  );
}
