import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tool category definitions for progressive discovery.
 *
 * All 72+ tools are registered at server startup. These category tools let an AI agent
 * discover what tools exist without reading all 72+ tool schemas — each category
 * description is compact compared to loading full schema definitions.
 *
 * Use list_tool_categories to see what tools are available.
 * Use enable_tool_category as a semantic signal that you intend to use a category's tools.
 * Use disable_tool_category as a semantic signal that you are done with a category.
 */

interface ToolCategory {
  name: string;
  description: string;
  tools: string[];
}

export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  project: {
    name: 'project',
    description: 'Project-level information: name, tempo, time signature, sample rate, transport state',
    tools: ['get_project_info'],
  },
  tracks: {
    name: 'tracks',
    description: 'Track management: list, inspect, and set properties (volume, pan, mute, solo, record arm, phase, input). Includes batch set for multiple tracks at once.',
    tools: ['list_tracks', 'get_track_properties', 'set_track_property', 'set_multiple_track_properties'],
  },
  fx: {
    name: 'fx',
    description: 'FX chain management: add, remove, inspect, and set parameters. Includes batch setup of an entire FX chain and batch parameter updates across multiple plugins.',
    tools: ['add_fx', 'remove_fx', 'get_fx_parameters', 'set_fx_parameter', 'set_fx_enabled', 'set_fx_offline', 'setup_fx_chain', 'set_multiple_fx_parameters'],
  },
  transport: {
    name: 'transport',
    description: 'Transport control: play, stop, record, get transport state, set cursor position',
    tools: ['play', 'stop', 'record', 'get_transport_state', 'set_cursor_position'],
  },
  midi: {
    name: 'midi',
    description: 'MIDI item editing: create items, insert/edit/delete notes and CC events, batch operations, analysis. Use analyze_midi first for large items; paginate with get_midi_notes offset/limit.',
    tools: [
      'create_midi_item', 'list_midi_items', 'get_midi_notes', 'analyze_midi',
      'insert_midi_note', 'insert_midi_notes', 'edit_midi_note', 'edit_midi_notes',
      'delete_midi_note', 'get_midi_cc', 'insert_midi_cc', 'delete_midi_cc',
      'get_midi_item_properties', 'set_midi_item_properties',
    ],
  },
  media: {
    name: 'media',
    description: 'Media item editing: list, inspect, set properties, split, delete, move, trim, stretch markers. Includes batch set for multiple items at once.',
    tools: [
      'list_media_items', 'get_media_item_properties', 'set_media_item_properties', 'set_media_items_properties',
      'split_media_item', 'delete_media_item', 'move_media_item', 'trim_media_item',
      'add_stretch_marker', 'get_stretch_markers', 'delete_stretch_marker',
    ],
  },
  selection: {
    name: 'selection',
    description: 'Selection and navigation: get selected tracks, get/set time selection range',
    tools: ['get_selected_tracks', 'get_time_selection', 'set_time_selection'],
  },
  markers: {
    name: 'markers',
    description: 'Markers and regions: list, add, delete markers and regions with optional names and colors',
    tools: ['list_markers', 'list_regions', 'add_marker', 'add_region', 'delete_marker', 'delete_region'],
  },
  tempo: {
    name: 'tempo',
    description: 'Tempo map: get all tempo and time signature changes with positions, BPM, and linear/step flags',
    tools: ['get_tempo_map'],
  },
  envelopes: {
    name: 'envelopes',
    description: 'Automation envelopes: create, inspect, insert/delete points, clear, batch insert, set properties. Supports volume, pan, mute, width, trim volume, and FX parameter envelopes.',
    tools: [
      'create_track_envelope', 'get_track_envelopes', 'get_envelope_points',
      'insert_envelope_point', 'insert_envelope_points', 'delete_envelope_point',
      'clear_envelope', 'remove_envelope_points', 'set_envelope_properties',
    ],
  },
  analysis: {
    name: 'analysis',
    description: 'Audio metering and analysis: peak/RMS meters, FFT spectrum, LUFS loudness, stereo correlation, crest factor',
    tools: ['read_track_meters', 'read_track_spectrum', 'read_track_lufs', 'read_track_correlation', 'read_track_crest'],
  },
  discovery: {
    name: 'discovery',
    description: 'FX discovery and presets: list all installed plugins, fuzzy search by name, list and load presets',
    tools: ['list_available_fx', 'search_fx', 'get_fx_preset_list', 'set_fx_preset'],
  },
  snapshots: {
    name: 'snapshots',
    description: 'Mixer state snapshots: save, restore, and list named snapshots of volumes, pans, FX, and mutes',
    tools: ['snapshot_save', 'snapshot_restore', 'snapshot_list'],
  },
  routing: {
    name: 'routing',
    description: 'Track routing: inspect sends, receives, parent/folder relationships for a track',
    tools: ['get_track_routing'],
  },
};

export function registerCategoryTools(server: McpServer): void {
  server.tool(
    'list_tool_categories',
    'List all available tool categories with descriptions and tool names. Use this to discover what tools are available without loading all 72+ tool schemas. Categories: project, tracks, fx, transport, midi, media, selection, markers, tempo, envelopes, analysis, discovery, snapshots, routing.',
    {},
    async () => {
      const categories = Object.values(TOOL_CATEGORIES).map((cat) => ({
        name: cat.name,
        description: cat.description,
        toolCount: cat.tools.length,
        tools: cat.tools,
      }));
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ categories, totalTools: categories.reduce((sum, c) => sum + c.toolCount, 0) }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'enable_tool_category',
    'Signal that you intend to use tools from a specific category. All tools are already registered and available — this call returns the full list of tools in the category so you know exactly which tool names to use. Use list_tool_categories first to see all available categories.',
    {
      category: z.string().describe('Category name (e.g. "tracks", "fx", "midi", "media", "transport", "markers", "envelopes", "analysis", "discovery")'),
    },
    async ({ category }) => {
      const cat = TOOL_CATEGORIES[category];
      if (!cat) {
        const available = Object.keys(TOOL_CATEGORIES).join(', ');
        return {
          content: [{
            type: 'text',
            text: `Error: Unknown category "${category}". Available categories: ${available}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            category: cat.name,
            description: cat.description,
            toolCount: cat.tools.length,
            tools: cat.tools,
            status: 'ready',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'disable_tool_category',
    'Signal that you are done using tools from a specific category. This is a semantic hint to help manage your context budget — the tools remain registered but you can use this to indicate you no longer need them in the current workflow.',
    {
      category: z.string().describe('Category name (e.g. "tracks", "fx", "midi", "media", "transport", "markers", "envelopes", "analysis", "discovery")'),
    },
    async ({ category }) => {
      const cat = TOOL_CATEGORIES[category];
      if (!cat) {
        const available = Object.keys(TOOL_CATEGORIES).join(', ');
        return {
          content: [{
            type: 'text',
            text: `Error: Unknown category "${category}". Available categories: ${available}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            category: cat.name,
            status: 'disabled',
            note: 'Tools remain available if needed. Use enable_tool_category to re-activate.',
          }, null, 2),
        }],
      };
    },
  );
}
