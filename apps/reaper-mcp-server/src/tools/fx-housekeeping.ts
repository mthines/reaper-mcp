import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { passThrough } from './items.js';

const trackIndex = z.coerce.number().int().min(0).describe('0-based track index');
const fxIndex = z.coerce.number().int().min(0).describe('0-based FX index in the track\'s chain');
const toTrackIndex = z.coerce.number().int().min(0).optional().describe('0-based target track (default: the same track)');
const toIndex = z.coerce.number().int().min(0).optional().describe('0-based position in the target chain (default: the end)');
const overwrite = z.boolean().optional().describe('Replace an existing file of that name (default false: refuse)');

export function registerFxHousekeepingTools(server: McpServer): void {
  server.tool(
    'move_fx',
    'Move one FX to another position in its chain, or to another track (with its settings). Returns the chain(s) afterwards.',
    { trackIndex, fxIndex, toTrackIndex, toIndex },
    passThrough('move_fx'),
  );

  server.tool(
    'copy_fx',
    'Copy one FX (with its settings) to another position in its chain or onto another track. Returns the chain(s) afterwards.',
    { trackIndex, fxIndex, toTrackIndex, toIndex },
    passThrough('copy_fx'),
  );

  server.tool(
    'rename_fx',
    'Rename one FX instance as shown in the FX chain (REAPER 6.37+). An empty name restores the plugin\'s own name.',
    { trackIndex, fxIndex, name: z.string().describe('New display name, or "" to clear the rename') },
    passThrough('rename_fx'),
  );

  server.tool(
    'save_fx_chain',
    'Save a track\'s whole FX chain (with all settings) as an .RfxChain file in REAPER\'s FXChains folder, where REAPER\'s own "Add FX chain" finds it. ' +
      'The name may include subfolders ("Vocals/Lead") but never "..", an absolute path or a drive letter.',
    {
      trackIndex,
      name: z.string().min(1).describe('File name under FXChains/, without or with .RfxChain'),
      overwrite,
    },
    passThrough('save_fx_chain'),
  );

  server.tool(
    'load_fx_chain',
    'Load an .RfxChain file onto a track: appended after its FX (default) or replacing them. Each loaded FX gets a fresh identity. See list_fx_chains for names.',
    {
      trackIndex,
      name: z.string().min(1).describe('Name under FXChains/ (e.g. "Vocals/Lead"), or an absolute path to a .RfxChain file'),
      mode: z.enum(['append', 'replace']).optional().describe('append (default) or replace the track\'s FX'),
    },
    passThrough('load_fx_chain'),
  );

  server.tool(
    'list_fx_chains',
    'List the .RfxChain files in REAPER\'s FXChains folder (and subfolders), by the name load_fx_chain takes',
    {},
    passThrough('list_fx_chains'),
  );

  server.tool(
    'save_track_template',
    'Save a track (name, FX chain, settings) as an .RTrackTemplate in REAPER\'s TrackTemplates folder. ' +
      'Items are left out unless includeItems is true; receives and folder state are never saved (they depend on the tracks around it). ' +
      'The name may include subfolders but never "..", an absolute path or a drive letter.',
    {
      trackIndex,
      name: z.string().min(1).describe('File name under TrackTemplates/, without or with .RTrackTemplate'),
      includeItems: z.boolean().optional().describe('Also save the track\'s media items (default false)'),
      overwrite,
    },
    passThrough('save_track_template'),
  );

  server.tool(
    'insert_track_template',
    'Insert the track(s) from an .RTrackTemplate at a position, each with fresh identities. See list_track_templates for names.',
    {
      name: z.string().min(1).describe('Name under TrackTemplates/, or an absolute path to a .RTrackTemplate file'),
      index: z.coerce.number().int().min(0).optional().describe('0-based position of the first inserted track (default: the end)'),
    },
    passThrough('insert_track_template'),
  );

  server.tool(
    'list_track_templates',
    'List the .RTrackTemplate files in REAPER\'s TrackTemplates folder (and subfolders), by the name insert_track_template takes',
    {},
    passThrough('list_track_templates'),
  );
}
