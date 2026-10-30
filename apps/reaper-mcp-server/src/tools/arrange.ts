import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import { reply } from './items.js';

/**
 * Gluing renders the items to a new file, and an insert/remove touches every item,
 * marker and envelope in the project, so these get more than the default 10 s: a timeout
 * would report failure while REAPER finishes the edit, and a retry would apply it twice.
 */
export const ARRANGE_TIMEOUT_MS = 60_000;

export const itemRefs = z
  .array(z.object({
    trackIndex: z.coerce.number().int().min(0).describe('0-based track index'),
    itemIndex: z.coerce.number().int().min(0).describe('0-based item index on the track (list_media_items order)'),
  }))
  .min(1)
  .max(64);

const seconds = (what: string) => z.coerce.number().min(0).describe(what);

// Nested arrays travel as JSON strings: the bridge decodes only the top level
function send(command: 'copy_media_items' | 'insert_time' | 'remove_time' | 'copy_section' | 'process_items', args: Record<string, unknown>) {
  const params: Record<string, unknown> = { ...args };
  for (const key of ['items', 'tracks']) {
    if (params[key] !== undefined) params[key] = JSON.stringify(params[key]);
  }
  return sendCommand(command, params, ARRANGE_TIMEOUT_MS).then(reply);
}

export function registerArrangeTools(server: McpServer): void {
  server.tool(
    'copy_media_items',
    'Copy (duplicate or repeat) media items, keeping their spacing: by default right after the last one, ' +
      'or at `position` and/or on another track. `times` lays copies end to end (e.g. repeat a 4-bar loop 8 times). ' +
      'Copies get fresh GUIDs; MIDI copies get their own data unless `pooled`. One undo point; returns where each copy landed.',
    {
      items: itemRefs.describe('Items to copy'),
      times: z.coerce.number().int().min(1).max(64).optional().describe('How many copies of the group (default 1)'),
      position: seconds('Start of the first copy in seconds (default: end of the last source item)').optional(),
      trackIndex: z.coerce.number().int().min(0).optional().describe('Destination track (default: each item\'s own track)'),
      pooled: z.boolean().optional().describe('MIDI copies share the source\'s data (edit one, edit all)'),
    },
    (args) => send('copy_media_items', args),
  );

  server.tool(
    'insert_time',
    'Open empty time at a position across the whole project: every item, marker, region, tempo marker, envelope point ' +
      'and automation item at or after it moves later by `length`; items spanning it are split (unless splitItems: false) ' +
      'and regions spanning it grow. Independent of REAPER\'s ripple settings. One undo point; returns what moved.',
    {
      position: seconds('Where to open time, in seconds'),
      length: z.coerce.number().positive().max(3600).describe('How much time to insert, in seconds'),
      splitItems: z.boolean().optional().describe('Split items that span the position (default true)'),
    },
    (args) => send('insert_time', args),
  );

  server.tool(
    'remove_time',
    'Cut a time range out of the whole project and close the gap: items, markers, tempo markers, envelope points and ' +
      'automation items inside it are deleted, items crossing it are trimmed, regions shrink, and everything after moves ' +
      'earlier. The tempo in force at the end of the cut is kept. One undo point; returns what was deleted, trimmed and moved.',
    {
      start: seconds('Start of the range in seconds'),
      end: seconds('End of the range in seconds'),
    },
    (args) => send('remove_time', args),
  );

  server.tool(
    'copy_section',
    'Copy a section of the song (a region by list_regions index, or start/end) to another position: the items in it ' +
      '(trimmed to the section) and, by default, its automation, on every track or the given tracks. With `insert`, ' +
      'time is opened at the position first so nothing there is overwritten (e.g. repeat a chorus). One undo point.',
    {
      regionIndex: z.coerce.number().int().min(0).optional().describe('Region to copy (list_regions index)'),
      start: seconds('Section start in seconds (instead of regionIndex)').optional(),
      end: seconds('Section end in seconds (instead of regionIndex)').optional(),
      position: seconds('Where the copy starts, in seconds'),
      insert: z.boolean().optional().describe('Insert time at the position first (default false: overwrite automation there, place items over)'),
      envelopes: z.boolean().optional().describe('Copy envelope points too (default true)'),
      tracks: z.array(z.coerce.number().int().min(0)).min(1).optional().describe('Track indexes to copy (default all)'),
    },
    (args) => send('copy_section', args),
  );

  server.tool(
    'process_items',
    'Process audio items: `normalize` sets item gain so each item hits `target` dB (mode peak by default, or true_peak, ' +
      'lufs_i, rms, lufs_m_max, lufs_s_max; non-peak modes need a target), measured over what the item plays; ' +
      '`reverse` reverses the active takes; `glue` joins the items on each track into one new item. ' +
      'MIDI items are refused for normalize/reverse. The selection is kept. One undo point; normalize returns each ' +
      'item\'s level and gain before and after.',
    {
      operation: z.enum(['normalize', 'reverse', 'glue']),
      items: itemRefs.describe('Items to process'),
      mode: z.enum(['peak', 'true_peak', 'lufs_i', 'rms', 'lufs_m_max', 'lufs_s_max']).optional().describe('Normalize measurement (default peak)'),
      target: z.coerce.number().min(-70).max(0).optional().describe('Normalize target in dB (default 0 for peak modes)'),
    },
    (args) => send('process_items', args),
  );
}
