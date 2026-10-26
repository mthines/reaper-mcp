import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerTempoTools(server: McpServer): void {
  server.tool(
    'get_tempo_map',
    'Get all tempo and time signature change points in the project (tempo map markers)',
    {},
    async () => {
      const res = await sendCommand('get_tempo_map');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  registerTempoEditTools(server);
}

// --- Tempo map editing (logic in reaper/mcp_project_lib.lua) ---

function reply(res: { success: boolean; data?: unknown; error?: string }) {
  if (!res.success) {
    return { content: [{ type: 'text' as const, text: `Error: ${res.error}` }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
}

const bpm = z.coerce.number().gt(0).max(960).describe('Tempo in BPM (> 0, max 960)');
const timeSigNumerator = z.coerce.number().int().min(1).max(255).optional().describe('Time signature numerator (give with denominator)');
const timeSigDenominator = z.coerce.number().int().optional().describe('Time signature denominator: 1, 2, 4, 8, 16, 32 or 64 (give with numerator)');

function registerTempoEditTools(server: McpServer): void {
  server.tool(
    'add_tempo_marker',
    'Add a tempo / time signature marker at a position in seconds. Returns the updated tempo map (same shape as get_tempo_map, plus tempoMarkerCount). One undo point.',
    {
      position: z.coerce.number().min(0).describe('Position in seconds'),
      bpm,
      timeSigNumerator,
      timeSigDenominator,
      linear: z.boolean().optional().describe('Gradual (linear) tempo change to the next marker'),
    },
    async (params) => reply(await sendCommand('add_tempo_marker', params)),
  );

  server.tool(
    'edit_tempo_marker',
    'Edit a tempo marker by its get_tempo_map index (only tempoMarkerCount > 0 maps have real markers). Unspecified fields keep their values. Returns the updated tempo map.',
    {
      index: z.coerce.number().int().min(0).describe('Tempo marker index from get_tempo_map'),
      position: z.coerce.number().min(0).optional().describe('New position in seconds'),
      bpm: bpm.optional(),
      timeSigNumerator,
      timeSigDenominator,
      linear: z.boolean().optional().describe('Gradual (linear) tempo change to the next marker'),
    },
    async (params) => reply(await sendCommand('edit_tempo_marker', params)),
  );

  server.tool(
    'delete_tempo_marker',
    'Delete a tempo marker by its get_tempo_map index. Returns the updated tempo map.',
    { index: z.coerce.number().int().min(0).describe('Tempo marker index from get_tempo_map') },
    async ({ index }) => reply(await sendCommand('delete_tempo_marker', { index })),
  );

  server.tool(
    'set_project_tempo',
    'Set the project tempo. With no tempo markers this sets the project BPM; with markers it sets the first marker\'s BPM. Returns the updated tempo map.',
    { bpm },
    async ({ bpm: value }) => reply(await sendCommand('set_project_tempo', { bpm: value })),
  );
}
