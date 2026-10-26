import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';

export function registerProjectTools(server: McpServer): void {
  server.tool(
    'get_project_info',
    'Get current REAPER project info: name, track count, tempo, time signature, sample rate, transport state',
    {},
    async () => {
      const res = await sendCommand('get_project_info');
      if (!res.success) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  registerProjectOpsTools(server);
}

// --- Project ops: undo/redo, save, render, settings (logic in reaper/mcp_project_lib.lua) ---

/**
 * Free text the bridge can carry. Its flat command parser cuts the params object
 * at the first unbalanced brace inside a string (silently dropping params), so
 * refuse braces up front instead of reporting a success that changed nothing.
 */
export const bridgeText = z
  .string()
  .refine((s) => !/[{}]/.test(s), {
    message: 'must not contain { or } (the REAPER bridge cannot carry them yet)',
  });

export function reply(res: { success: boolean; data?: unknown; error?: string }) {
  if (!res.success) {
    return { content: [{ type: 'text' as const, text: `Error: ${res.error}` }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
}

function registerProjectOpsTools(server: McpServer): void {
  server.tool(
    'undo_project',
    'Undo the last undo point in the REAPER project (any edit, including ones made by these tools) and report its label, plus the next undo/redo labels.',
    {},
    async () => reply(await sendCommand('undo_project')),
  );

  server.tool(
    'redo_project',
    'Redo the last undone edit in the REAPER project and report its label, plus the next undo/redo labels.',
    {},
    async () => reply(await sendCommand('redo_project')),
  );

  server.tool(
    'save_project',
    'Save the REAPER project. Without a path, saves it where it already lives. With path (an absolute .rpp file in an existing directory) it writes a copy there: the open project keeps its own path (savedAsCopy: true), so a never-saved project stays unsaved. Never opens a dialog: a never-saved project without path is refused; an existing different file is refused unless overwrite is true.',
    {
      path: bridgeText.optional().describe('Absolute .rpp path to write a copy to'),
      overwrite: z.boolean().optional().describe('Replace an existing file at path'),
    },
    async ({ path, overwrite }) => reply(await sendCommand('save_project', { path, overwrite })),
  );

  server.tool(
    'get_render_settings',
    'Get the project render settings: output directory, file name pattern, format, secondary format, bounds (custom/project/time_selection/…), custom start/end, sample rate (0 = project rate), channels, and the target files a render would write.',
    {},
    async () => reply(await sendCommand('get_render_settings')),
  );

  server.tool(
    'set_render_settings',
    'Set any of the project render settings; returns them as read back. All fields are validated before any is written, so an invalid request changes nothing. Formats use REAPER\'s default options for that encoder.',
    {
      outputDirectory: bridgeText.optional().describe('Absolute output directory'),
      filePattern: bridgeText.optional().describe('File name pattern without extension; REAPER wildcards like $project allowed'),
      format: z.enum(['wav', 'aiff', 'flac', 'mp3', 'ogg', 'opus']).optional().describe('Output format'),
      secondaryFormat: z.enum(['none', 'wav', 'aiff', 'flac', 'mp3', 'ogg', 'opus']).optional().describe('Second file written by the same render; none disables it'),
      bounds: z.enum(['custom', 'project', 'time_selection', 'all_regions', 'selected_items', 'selected_regions']).optional().describe('What to render'),
      startTime: z.coerce.number().min(0).optional().describe('Custom bounds start (seconds)'),
      endTime: z.coerce.number().min(0).optional().describe('Custom bounds end (seconds)'),
      sampleRate: z.coerce.number().int().min(0).optional().describe('Output sample rate; 0 = project rate'),
      channels: z.coerce.number().int().min(1).max(64).optional().describe('Output channel count'),
    },
    async (params) => reply(await sendCommand('set_render_settings', params)),
  );

  server.tool(
    'render_project',
    'Render the project with its current render settings (set them with set_render_settings) and return the files written. Synchronous: REAPER is busy until the render finishes, so keep renders short. Refused when a target file already exists (REAPER would ask) unless overwrite is true, when bounds is time_selection with no time selection, and when the format or secondary format is an encoder outside wav/aiff/flac/mp3/ogg/opus (they can open a dialog).',
    {
      overwrite: z.boolean().optional().describe('Delete existing target files before rendering'),
    },
    async ({ overwrite }) => reply(await sendCommand('render_project', { overwrite })),
  );

  server.tool(
    'get_project_settings',
    'Get project settings: path, sample rate and whether it is forced, title, author, notes, repeat (loop playback), and metronome (a global REAPER option).',
    {},
    async () => reply(await sendCommand('get_project_settings')),
  );

  server.tool(
    'set_project_settings',
    'Set any of: sampleRate, useProjectSampleRate, title, author, notes, repeat, metronome. Returns the settings as read back. metronome is a global REAPER option (it is not stored in the project and undo does not revert it). Invalid values change nothing.',
    {
      sampleRate: z.coerce.number().int().min(8000).max(768000).optional().describe('Project sample rate (Hz)'),
      useProjectSampleRate: z.boolean().optional().describe('Force the project sample rate (may reconfigure the audio device)'),
      title: bridgeText.optional().describe('Project title (metadata)'),
      author: bridgeText.optional().describe('Project author (metadata)'),
      notes: bridgeText.optional().describe('Project notes (replaces them)'),
      repeat: z.boolean().optional().describe('Repeat / loop playback of the time selection'),
      metronome: z.boolean().optional().describe('Metronome on/off'),
    },
    async (params) => reply(await sendCommand('set_project_settings', params)),
  );
}
