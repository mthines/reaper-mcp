import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

// Not z.coerce'd: "40001" and an action *name* are both strings; the bridge
// treats a digit string as a command id and anything else as a named id or name.
export const actionRef = z
  .union([z.number().int().min(1), z.string().min(1)])
  .describe('Command id (40001), named id ("_SWS_…", "_aee8…" — stable across sessions; prefer it for custom actions and scripts), or the exact action name');

export const actionSection = z
  .enum(['main', 'midi_editor', 'midi_event_list'])
  .optional()
  .describe('Action section (default main). MIDI editor actions need an open MIDI editor.');

function reply(res: { success: boolean; data?: unknown; error?: string }) {
  if (!res.success) {
    return { content: [{ type: 'text' as const, text: `Error: ${res.error}` }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
}

export function registerActionTools(server: McpServer): void {
  server.tool(
    'search_actions',
    'Search REAPER\'s action list (native, SWS/extensions, scripts, and the user\'s Custom: macros — ~6k actions) inside REAPER. ' +
      'Every query word must appear in the action name or named id (case-insensitive). Returns id, stable namedId, name, ' +
      'toggle state, keyboard shortcuts, and whether it opens a dialog or is always refused, plus the total match count.',
    {
      query: z.string().describe('Words to match, e.g. "track insert", "Custom:", "metronome"'),
      section: actionSection,
      limit: z.coerce.number().int().min(1).max(100).optional().describe('Max results (default 20, max 100)'),
    },
    async ({ query, section, limit }) => reply(await sendCommand('search_actions', { query, section, limit })),
  );

  server.tool(
    'get_action',
    'Get one REAPER action: name, ids, toggle state, shortcuts, and its kind. For a Custom: macro, lists the steps it runs by name; for a script, its file path.',
    { action: actionRef, section: actionSection },
    async ({ action, section }) => reply(await sendCommand('get_action', { action, section })),
  );

  server.tool(
    'run_action',
    'Run one REAPER action (like pressing its shortcut) in an undo block, and return its toggle state afterwards. ' +
      'Most actions work on the current selection: set it first with set_selected_tracks / set_selected_items. ' +
      'Actions that open a dialog (name ends in "...") are refused unless allowDialog is true, because a dialog blocks REAPER until a person closes it. ' +
      'Actions that quit REAPER or close/open/replace the project are always refused. To combine actions with other edits in one undo step, use run_plan\'s run_action op.',
    {
      action: actionRef,
      section: actionSection,
      allowDialog: z.boolean().optional().describe('Allow an action that opens a dialog — only when someone is at the screen to close it'),
    },
    async ({ action, section, allowDialog }) => reply(await sendCommand('run_action', { action, section, allowDialog })),
  );
}
