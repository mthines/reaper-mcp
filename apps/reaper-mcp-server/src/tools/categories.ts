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
    description: 'Project-level information and operations: info, undo/redo, save (never opens a dialog), render settings + render, project settings (sample rate, title, author, notes, repeat, metronome)',
    tools: [
      'get_project_info',
      'undo_project', 'redo_project', 'save_project',
      'get_render_settings', 'set_render_settings', 'render_project', 'render_versions',
      'get_project_settings', 'set_project_settings',
    ],
  },
  tracks: {
    name: 'tracks',
    description: 'Track management: list, inspect, and set properties (volume, pan, mute, solo, record arm, phase, input), including batch set. Structure: add, delete, move, folders, name/color/channels, groups and VCAs. Freeze/unfreeze tracks to free CPU. trackIndex -1 (or "master") is the master track.',
    tools: ['list_tracks', 'get_track_properties', 'set_track_property', 'set_multiple_track_properties', 'add_track', 'delete_track', 'move_track', 'set_track_folder', 'set_track_info', 'set_track_group', 'freeze_tracks', 'unfreeze_tracks'],
  },
  fx: {
    name: 'fx',
    description: 'FX chain management: add, remove, inspect, and set parameters. Includes batch setup of an entire FX chain and batch parameter updates across multiple plugins, parameter modulation (LFO, audio control signal/sidechain follower, parameter link), pin mappings (sidechain on 3/4), and the monitoring FX chain (heard, never rendered).',
    tools: [
      'add_fx', 'remove_fx', 'get_fx_parameters', 'analyze_fx', 'set_fx_parameter', 'set_fx_enabled', 'set_fx_offline', 'setup_fx_chain', 'set_multiple_fx_parameters',
      'get_fx_param_modulation', 'set_fx_param_modulation', 'get_fx_pins', 'set_fx_pins',
      'list_monitoring_fx', 'add_monitoring_fx', 'set_monitoring_fx', 'remove_monitoring_fx',
    ],
  },
  transport: {
    name: 'transport',
    description: 'Transport control: play, stop, record, get transport state, set cursor position',
    tools: ['play', 'stop', 'record', 'get_transport_state', 'set_cursor_position'],
  },
  midi: {
    name: 'midi',
    description: 'MIDI item editing: create items, insert/edit/delete notes and CC events, batch operations, quantize, transform (transpose/velocity/humanize/length), MIDI file import, analysis, plus live MIDI output (send_midi_cc/pc/note). Use analyze_midi first for large items; paginate with get_midi_notes offset/limit.',
    tools: [
      'create_midi_item', 'list_midi_items', 'get_midi_notes', 'analyze_midi',
      'insert_midi_note', 'insert_midi_notes', 'edit_midi_note', 'edit_midi_notes',
      'delete_midi_note', 'quantize_midi', 'transform_midi', 'import_midi_file', 'get_midi_cc', 'insert_midi_cc', 'delete_midi_cc',
      'get_midi_item_properties', 'set_midi_item_properties',
      'send_midi_cc', 'send_midi_pc', 'send_midi_note',
    ],
  },
  media: {
    name: 'media',
    description: 'Media item editing: list, inspect, set properties, split, delete, move, trim, stretch markers (batch add, quantize audio to the grid), render in place (apply FX to items as a new take). Includes batch set for multiple items at once.',
    tools: [
      'list_media_items', 'get_media_item_properties', 'set_media_item_properties', 'set_media_items_properties',
      'split_media_item', 'delete_media_item', 'move_media_item', 'trim_media_item',
      'add_stretch_marker', 'get_stretch_markers', 'delete_stretch_marker', 'add_stretch_markers', 'quantize_audio', 'apply_fx_to_items',
    ],
  },
  arrange: {
    name: 'arrange',
    description: 'Arrangement: copy or repeat items, insert or remove time across the whole project (items, markers, regions, tempo, automation), copy a section to another position, normalize/reverse/glue items',
    tools: ['copy_media_items', 'insert_time', 'remove_time', 'copy_section', 'process_items'],
  },
  selection: {
    name: 'selection',
    description: 'Selection and navigation: get/set selected tracks and items, get/set time selection range',
    tools: ['get_selected_tracks', 'set_selected_tracks', 'set_selected_items', 'get_time_selection', 'set_time_selection'],
  },
  recording: {
    name: 'recording',
    description: 'Recording setup and comping: armed tracks with inputs and monitoring, arm/input/monitor/record mode per track, global record mode (normal, auto-punch on a time selection or selected items) and record path, fixed lanes (names, which lane plays) and comping a new lane from ranges of the takes with crossfades',
    tools: ['get_record_setup', 'set_track_record', 'set_record_mode', 'get_track_lanes', 'set_track_lanes', 'comp_lanes'],
  },
  markers: {
    name: 'markers',
    description: 'Markers and regions: list, add, edit (rename, move, recolor), delete markers and regions with optional names and colors',
    tools: ['list_markers', 'list_regions', 'add_marker', 'add_region', 'delete_marker', 'delete_region', 'edit_marker', 'edit_region'],
  },
  tempo: {
    name: 'tempo',
    description: 'Tempo map: get all tempo and time signature changes; add, edit and delete tempo/time signature markers; set the project tempo',
    tools: ['get_tempo_map', 'add_tempo_marker', 'edit_tempo_marker', 'delete_tempo_marker', 'set_project_tempo'],
  },
  envelopes: {
    name: 'envelopes',
    description: 'Automation envelopes: create, inspect, insert/edit/delete points (dB on volume envelopes), clear, batch insert, set properties, and pooled automation items (one pool per repeated section). Supports volume, pan, mute, width, trim volume, send volume/pan/mute, and FX parameter envelopes, plus track automation modes and the global override.',
    tools: [
      'create_track_envelope', 'get_track_envelopes', 'get_envelope_points',
      'insert_envelope_point', 'insert_envelope_points', 'delete_envelope_point',
      'clear_envelope', 'remove_envelope_points', 'set_envelope_properties', 'edit_envelope_points',
      'list_automation_items', 'insert_automation_item', 'set_automation_item', 'delete_automation_item',
      'set_automation_mode',
    ],
  },
  analysis: {
    name: 'analysis',
    description: 'Audio metering and analysis: peak/RMS meters, FFT spectrum, LUFS loudness, stereo correlation, crest factor, one-call multi-metric measurement (measure_tracks), perceptual aesthetics scores, offline render-based loudness/LRA/true-peak/spectrum with reference comparison, multi-mic time alignment, transient detection and transient-driven automation e.g. for lighting, loudness over time, stereo correlation per band, masking between tracks, stem separation (the render-based tools need the Python sidecar; stem separation also its --with-separation install), musical key detection (MIDI notes, or audio via the sidecar)',
    tools: ['read_track_meters', 'read_track_spectrum', 'read_track_lufs', 'read_track_correlation', 'read_track_crest', 'measure_tracks', 'analyze_track_aesthetics', 'analyze_track_offline', 'analyze_audio_file', 'measure_track_alignment', 'detect_transients', 'create_transient_automation', 'analyze_loudness_curve', 'analyze_stereo_bands', 'measure_masking', 'separate_stems', 'detect_key', 'detect_chords'],
  },
  discovery: {
    name: 'discovery',
    description: 'FX discovery and presets: list all installed plugins, fuzzy search by name, list and load presets',
    tools: ['list_available_fx', 'search_fx', 'get_fx_preset_list', 'set_fx_preset'],
  },
  snapshots: {
    name: 'snapshots',
    description: 'Mixer state snapshots: save, restore, list, rename and delete named snapshots of volumes, pans, FX, and mutes',
    tools: ['snapshot_save', 'snapshot_restore', 'snapshot_list', 'snapshot_delete', 'snapshot_edit'],
  },
  routing: {
    name: 'routing',
    description: 'Track routing: inspect and edit sends, receives, hardware outputs, sidechain channels, master send, parent/folder relationships',
    tools: ['get_track_routing', 'add_send', 'set_send', 'remove_send', 'add_hardware_output'],
  },
  plan: {
    name: 'plan',
    description: 'Multi-step edits in one call: run_plan applies an ordered list of ops (add/set tracks, add FX, set FX params, add sends, copy FX chains) in one undo block, all-or-nothing, with $refs, dry-run and idempotency',
    tools: ['run_plan'],
  },
  actions: {
    name: 'actions',
    description: 'REAPER action proxy: search ~6k actions (native, SWS, scripts, Custom: macros), inspect one (shortcuts, macro steps), run one by id / stable named id / name. Pair with set_selected_tracks / set_selected_items.',
    tools: ['search_actions', 'get_action', 'run_action'],
  },
  takes: {
    name: 'takes',
    description: 'Items and takes: insert an audio file as an item, list takes and set the active take, take FX (add/remove/list/set params), item color and fade lengths/shapes/curves',
    tools: [
      'insert_audio_file', 'list_takes', 'set_active_take',
      'get_take_fx', 'add_take_fx', 'remove_take_fx', 'set_take_fx_parameter',
      'get_item_appearance', 'set_item_color', 'set_item_fades',
    ],
  },
  fx_files: {
    name: 'fx_files',
    description: 'FX housekeeping: move/copy one FX within or across tracks, rename an FX, save/load .RfxChain files, save/insert track templates, list saved chains and templates',
    tools: [
      'move_fx', 'copy_fx', 'rename_fx',
      'save_fx_chain', 'load_fx_chain', 'list_fx_chains',
      'save_track_template', 'insert_track_template', 'list_track_templates',
    ],
  },
  knowledge: {
    name: 'knowledge',
    description: 'Built-in mix knowledge (read-only, curated in LoreKit): list/search plugin records and mixing lessons, read one by key. The user\'s own LoreKit layer (user:: keys) overrides it.',
    tools: ['list_builtin_knowledge', 'get_builtin_knowledge'],
  },
};

export function registerCategoryTools(server: McpServer): void {
  server.tool(
    'list_tool_categories',
    'List all available tool categories with descriptions and tool names. Use this to discover what tools are available without loading every tool schema. ' +
      `Categories: ${Object.keys(TOOL_CATEGORIES).join(', ')}.`,
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
