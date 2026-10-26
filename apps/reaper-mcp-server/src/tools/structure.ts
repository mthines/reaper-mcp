import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CommandType } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';

/** Index, exact name, "{GUID}" or "master" — resolved by the bridge before anything is written. */
export const trackRef = z
  .union([z.number().int().min(-1), z.string().min(1)])
  .describe('Track: 0-based index (-1 = master), exact name, "{GUID}", or "master". A digit string means a track name first, then the index.');

const sendCategory = z
  .enum(['send', 'receive', 'hardware'])
  .optional()
  .describe('send (default): the track\'s sends; receive: its receives (the same objects, seen from the other end); hardware: its hardware outputs');

const sendMode = z
  .enum(['post-fader', 'pre-fx', 'post-fx'])
  .optional()
  .describe('post-fader (default for new sends), pre-fx (sidechain feeds, cue mixes), post-fx (pre-fader)');

const channelPair = (what: string) =>
  z.coerce.number().int().min(1).max(127).optional()
    .describe(`${what}: first channel of a stereo pair, 1-based (1 = 1/2, 3 = 3/4 for a sidechain)`);

const sendLevel = {
  volume: z.coerce.number().optional().describe('Level in dB (0 = unity)'),
  pan: z.coerce.number().min(-1).max(1).optional().describe('Pan from -1 (left) to 1 (right)'),
  mute: z.boolean().optional().describe('Mute the send'),
  mode: sendMode,
};

async function run(command: CommandType, params: Record<string, unknown>) {
  const res = await sendCommand(command, params);
  if (!res.success) {
    return { content: [{ type: 'text' as const, text: `Error: ${res.error}` }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
}

export function registerStructureTools(server: McpServer): void {
  server.tool(
    'add_track',
    'Insert a new track (default: at the end). Returns its index, name and GUID.',
    {
      name: z.string().optional().describe('Track name'),
      index: z.coerce.number().int().min(0).optional().describe('0-based position to insert at (default: after the last track)'),
    },
    async (params) => run('add_track', params)
  );

  server.tool(
    'delete_track',
    'Delete a track with its items, FX and routing (undoable with Ctrl+Z). The master track cannot be deleted. Later tracks move up one index.',
    { track: trackRef },
    async (params) => run('delete_track', params)
  );

  server.tool(
    'move_track',
    'Move a track to a new 0-based position; the other tracks shift around it. The user\'s track selection is kept.',
    {
      track: trackRef,
      toIndex: z.coerce.number().int().min(0).describe('0-based position the track ends up at'),
    },
    async (params) => run('move_track', params)
  );

  server.tool(
    'set_track_folder',
    'Make a track a folder parent, the last track of a folder, or a normal track; optionally collapse the folder. ' +
      'Folders nest by position: tracks after a folder parent belong to it until a track marked "last".',
    {
      track: trackRef,
      mode: z.enum(['folder', 'normal', 'last']).optional()
        .describe('folder: opens a folder at this track; last: closes the innermost open folder here; normal: neither'),
      depth: z.coerce.number().int().min(-8).max(1).optional()
        .describe('Raw I_FOLDERDEPTH instead of mode (1 opens a folder, -N closes N levels)'),
      collapsed: z.coerce.number().int().min(0).max(2).optional()
        .describe('Folder view: 0 = open, 1 = small, 2 = collapsed'),
    },
    async (params) => run('set_track_folder', params)
  );

  server.tool(
    'set_track_info',
    'Rename, color, set the channel count, or switch the master/parent send of a track. ' +
      'Everything is validated before anything is written.',
    {
      track: trackRef,
      name: z.string().optional().describe('New track name'),
      color: z.string().optional().describe('"#RRGGBB", or "none" to clear the custom color'),
      channels: z.coerce.number().int().min(2).max(128).optional()
        .describe('Track channel count, even (4 lets the track receive a sidechain on 3/4)'),
      masterSend: z.boolean().optional().describe('Send this track to the master/parent track'),
    },
    async (params) => run('set_track_info', params)
  );

  server.tool(
    'set_track_group',
    'Put a track in (or take it out of) a REAPER track group with given roles. ' +
      'Roles: volume_lead/follow, vca_lead/follow, pan_lead/follow, mute_lead/follow, solo_lead/follow, ' +
      'recarm_lead/follow, polarity_lead/follow, automode_lead/follow. A VCA: one track vca_lead, the others vca_follow.',
    {
      track: trackRef,
      group: z.coerce.number().int().min(1).max(64).describe('Group number, 1-64'),
      roles: z.array(z.string().min(1)).min(1).max(16).describe('Roles to set, e.g. ["vca_follow", "mute_follow"]'),
      enable: z.boolean().optional().describe('true (default) adds the roles; false removes them'),
    },
    async ({ roles, ...rest }) => run('set_track_group', { ...rest, roles: JSON.stringify(roles) })
  );
}

export function registerRoutingSetters(server: McpServer): void {
  server.tool(
    'add_send',
    'Send one track to another (a bus, a reverb return, or a sidechain input). ' +
      'For a sidechain use mode "pre-fx" and destChannel 3; the destination is widened to 4 channels if needed. ' +
      'Tracks reach the master through their master send (set_track_info masterSend), not through add_send. ' +
      'Returns the new send as get_track_routing reports it.',
    {
      from: trackRef,
      to: trackRef,
      ...sendLevel,
      srcChannel: channelPair('Source channels'),
      destChannel: channelPair('Destination channels'),
    },
    async (params) => run('add_send', params)
  );

  server.tool(
    'add_hardware_output',
    'Route a track straight to an audio interface output (outputChannel is 1-based; mono uses one channel).',
    {
      track: trackRef,
      outputChannel: z.coerce.number().int().min(1).max(512).optional().describe('First output channel, 1-based (default 1)'),
      mono: z.boolean().optional().describe('Use one output channel instead of a stereo pair'),
      ...sendLevel,
    },
    async (params) => run('add_hardware_output', params)
  );

  server.tool(
    'set_send',
    'Change a send, receive or hardware output by its index (as get_track_routing reports it). Only the given fields change.',
    {
      track: trackRef,
      category: sendCategory,
      index: z.coerce.number().int().min(0).describe('0-based index within the category'),
      ...sendLevel,
      srcChannel: channelPair('Source channels'),
      destChannel: channelPair('Destination channels (sends and receives)'),
      outputChannel: z.coerce.number().int().min(1).max(512).optional().describe('Output channel (hardware outputs)'),
      mono: z.boolean().optional().describe('Mono hardware output (applied together with outputChannel)'),
    },
    async (params) => run('set_send', params)
  );

  server.tool(
    'remove_send',
    'Remove a send, receive or hardware output by its index. Removing a receive removes the other track\'s send.',
    {
      track: trackRef,
      category: sendCategory,
      index: z.coerce.number().int().min(0).describe('0-based index within the category'),
    },
    async (params) => run('remove_send', params)
  );
}
