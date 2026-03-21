import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerPresetTools(server: McpServer): void {
  server.tool(
    'get_fx_preset_list',
    'List all available presets for a specific FX plugin on a track',
    {
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.number().int().min(0).describe('Zero-based FX index in the chain'),
    },
    async ({ trackIndex, fxIndex }) => {
      const res = await sendCommand('get_fx_preset_list', { trackIndex, fxIndex });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'set_fx_preset',
    'Apply a named preset to an FX plugin on a track',
    {
      trackIndex: z.number().int().min(0).describe('Zero-based track index'),
      fxIndex: z.number().int().min(0).describe('Zero-based FX index in the chain'),
      presetName: z.string().min(1).describe('Exact preset name to apply'),
    },
    async ({ trackIndex, fxIndex, presetName }) => {
      const res = await sendCommand('set_fx_preset', { trackIndex, fxIndex, presetName });
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Applied preset "${presetName}" to FX ${fxIndex} on track ${trackIndex}` }] };
    }
  );
}
