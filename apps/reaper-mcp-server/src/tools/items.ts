import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CommandType } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';

export function reply(res: { success: boolean; data?: unknown; error?: string }) {
  if (!res.success) {
    return { content: [{ type: 'text' as const, text: `Error: ${res.error}` }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
}

/** Send the tool's arguments to the bridge command of the same name. */
export function passThrough(command: CommandType) {
  return async (args: Record<string, unknown>) => reply(await sendCommand(command, args));
}

const trackIndex = z.coerce.number().int().min(0).describe('0-based track index');
const itemIndex = z.coerce.number().int().min(0).describe('0-based item index on the track');
const takeIndex = z.coerce.number().int().min(0).optional().describe('0-based take index (default: the active take)');
const fadeShape = z.coerce
  .number()
  .int()
  .min(0)
  .max(6)
  .optional();
const fadeCurve = z.coerce.number().min(-1).max(1).optional();

export function registerItemTools(server: McpServer): void {
  server.tool(
    'insert_audio_file',
    'Insert an audio file (WAV, AIFF, FLAC, MP3, …) onto a track as a new item at a position. The item is as long as the file. ' +
      'Refused, with nothing changed, when the file does not exist or REAPER cannot read it as audio.',
    {
      trackIndex,
      filePath: z.string().min(1).describe('Absolute path of the audio file'),
      position: z.coerce.number().min(0).optional().describe('Item start in seconds (default: the edit cursor)'),
    },
    passThrough('insert_audio_file'),
  );

  server.tool(
    'list_takes',
    'List the takes of a media item: name, which one is active, MIDI or audio, source file, and take FX count',
    { trackIndex, itemIndex },
    passThrough('list_takes'),
  );

  server.tool(
    'set_active_take',
    'Make one take of a media item the active (playing) take. Returns the item\'s takes afterwards.',
    { trackIndex, itemIndex, takeIndex: z.coerce.number().int().min(0).describe('0-based take index') },
    passThrough('set_active_take'),
  );

  server.tool(
    'get_take_fx',
    'List the FX on a take (its own FX chain, separate from the track FX). With fxIndex, also lists that FX\'s parameters with values and formatted text.',
    {
      trackIndex,
      itemIndex,
      takeIndex,
      fxIndex: z.coerce.number().int().min(0).optional().describe('0-based take FX index whose parameters to list'),
    },
    passThrough('get_take_fx'),
  );

  server.tool(
    'add_take_fx',
    'Add an FX to a take\'s FX chain by name (partial match, like add_fx). Returns the take\'s FX chain afterwards.',
    {
      trackIndex,
      itemIndex,
      takeIndex,
      fxName: z.string().min(1).describe('FX name, e.g. "ReaEQ" or "VST: Pro-Q 3"'),
    },
    passThrough('add_take_fx'),
  );

  server.tool(
    'remove_take_fx',
    'Remove one FX from a take\'s FX chain. Returns the take\'s FX chain afterwards.',
    { trackIndex, itemIndex, takeIndex, fxIndex: z.coerce.number().int().min(0).describe('0-based take FX index') },
    passThrough('remove_take_fx'),
  );

  server.tool(
    'set_take_fx_parameter',
    'Set one parameter of a take FX (same value scale as set_fx_parameter) and return the value REAPER reads back',
    {
      trackIndex,
      itemIndex,
      takeIndex,
      fxIndex: z.coerce.number().int().min(0).describe('0-based take FX index'),
      paramIndex: z.coerce.number().int().min(0).describe('0-based parameter index (see get_take_fx with fxIndex)'),
      value: z.coerce.number().describe('Parameter value (normalized 0.0-1.0 for most plugins)'),
    },
    passThrough('set_take_fx_parameter'),
  );

  server.tool(
    'get_item_appearance',
    'Get a media item\'s color ("#RRGGBB" or "none") and fades: lengths (seconds), shapes (0-6) and curves (-1..1)',
    { trackIndex, itemIndex },
    passThrough('get_item_appearance'),
  );

  server.tool(
    'set_item_color',
    'Set a media item\'s color, or "none" to go back to the track\'s default. Returns the color and fades REAPER reads back.',
    {
      trackIndex,
      itemIndex,
      color: z.string().describe('"#RRGGBB" (e.g. "#FF8000"), or "none"'),
    },
    passThrough('set_item_color'),
  );

  server.tool(
    'set_item_fades',
    'Set a media item\'s fade-in/out lengths, shapes and curves; only the fields given change. ' +
      'Shapes: 0 linear, 1 fast start, 2 fast end, 3 fast start (steep), 4 fast end (steep), 5 slow start/end, 6 slow start/end (steep). ' +
      'Returns the color and fades REAPER reads back.',
    {
      trackIndex,
      itemIndex,
      fadeInLength: z.coerce.number().min(0).optional().describe('Fade-in length in seconds'),
      fadeOutLength: z.coerce.number().min(0).optional().describe('Fade-out length in seconds'),
      fadeInShape: fadeShape.describe('Fade-in shape 0-6'),
      fadeOutShape: fadeShape.describe('Fade-out shape 0-6'),
      fadeInCurve: fadeCurve.describe('Fade-in curvature -1..1 (0 = shape default)'),
      fadeOutCurve: fadeCurve.describe('Fade-out curvature -1..1 (0 = shape default)'),
    },
    passThrough('set_item_fades'),
  );
}
