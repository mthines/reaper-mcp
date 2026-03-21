import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerFxTools(server: McpServer): void {
  server.tool(
    'add_fx',
    'Add an FX plugin to a track by name (e.g. "ReaEQ", "JS: Schwa\'s Spectral Analyzer", "VST: Pro-Q 3")',
    {
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
      fxName: z.string().describe('FX plugin name (partial match supported)'),
      position: z.number().int().optional().describe('Position in FX chain (-1 or omit for end)'),
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
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.number().int().min(0).describe('Zero-based FX index in the chain'),
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
    'List all parameters of an FX plugin with current values and ranges',
    {
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.number().int().min(0).describe('Zero-based FX index in the chain'),
    },
    async ({ trackIndex, fxIndex }) => {
      const res = await sendCommand('get_fx_parameters', { trackIndex, fxIndex });
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
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.number().int().min(0).describe('Zero-based FX index in the chain'),
      paramIndex: z.number().int().min(0).describe('Zero-based parameter index'),
      value: z.number().min(0).max(1).describe('Normalized parameter value 0.0–1.0'),
    },
    async ({ trackIndex, fxIndex, paramIndex, value }) => {
      const res = await sendCommand('set_fx_parameter', { trackIndex, fxIndex, paramIndex, value });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Set FX ${fxIndex} param ${paramIndex} = ${value}` }] };
    }
  );
}
