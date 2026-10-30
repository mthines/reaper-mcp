import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendCommand } from '../bridge.js';
import { trackRef } from './structure.js';

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

/** A synchronous render blocks the bridge until it is done: give it minutes, not the default 10 s */
const RENDER_TIMEOUT_MS = 600_000;

/** The bridge decodes a command's top level only, so nested params travel as JSON strings */
function json(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = JSON.stringify(v);
  return out;
}

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
      path: z.string().optional().describe('Absolute .rpp path to write a copy to'),
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
    'Set any of the project render settings; returns them as read back. All fields are validated before any is written, so an invalid request changes nothing. Covers what is rendered (source: master, stems of the selected tracks, master + stems, selected tracks via the master, the region render matrix), the encoding (bit depth, MP3 bitrate, dither), loudness normalization with a limiter, and embedded metadata.',
    {
      outputDirectory: z.string().optional().describe('Absolute output directory'),
      filePattern: z.string().optional().describe('File name pattern without extension; REAPER wildcards like $project, $track, $region allowed'),
      format: z.enum(['wav', 'aiff', 'flac', 'mp3', 'ogg', 'opus']).optional().describe('Output format'),
      secondaryFormat: z.enum(['none', 'wav', 'aiff', 'flac', 'mp3', 'ogg', 'opus']).optional().describe('Second file written by the same render; none disables it'),
      source: z.enum(['master', 'stems', 'master_and_stems', 'selected_via_master', 'region_matrix', 'selected_items', 'selected_items_via_master']).optional()
        .describe('What is rendered: master mix; stems = one file per selected track (pick them with render_project tracks); master_and_stems; selected_via_master = the selected tracks through the master; region_matrix = the tracks set per region in regionMatrix (needs bounds all_regions or selected_regions)'),
      regionMatrix: z.array(z.object({
        regionIndex: z.coerce.number().int().describe('Region number as list_regions reports it'),
        tracks: z.array(trackRef).describe('Tracks this region renders: index, name, "{GUID}" or "master"; replaces the row'),
      })).optional().describe('Region render matrix rows (source region_matrix); each listed region renders exactly these tracks'),
      bounds: z.enum(['custom', 'project', 'time_selection', 'all_regions', 'selected_items', 'selected_regions']).optional().describe('What to render'),
      startTime: z.coerce.number().min(0).optional().describe('Custom bounds start (seconds)'),
      endTime: z.coerce.number().min(0).optional().describe('Custom bounds end (seconds)'),
      sampleRate: z.coerce.number().int().min(0).optional().describe('Output sample rate; 0 = project rate'),
      channels: z.coerce.number().int().min(1).max(64).optional().describe('Output channel count'),
      bitDepth: z.enum(['16', '24', '32', '32f']).optional().describe('Bit depth of the primary format: wav 16/24/32/32f (float), aiff and flac 16/24'),
      mp3Bitrate: z.coerce.number().int().optional().describe('MP3 constant bitrate in kbps (32-320); format must be mp3'),
      dither: z.boolean().optional().describe('Dither the master and stems (use when reducing to 16 bit)'),
      noiseShaping: z.boolean().optional().describe('Noise shaping with the dither'),
      normalize: z.enum(['off', 'lufs_i', 'rms', 'peak', 'true_peak', 'lufs_m_max', 'lufs_s_max']).optional().describe('Normalize every rendered file to normalizeTarget by this measure'),
      normalizeTarget: z.coerce.number().optional().describe('Normalize target in dB (LUFS for lufs_*; dBFS for peak/true_peak), -70 to 0'),
      normalizeOnlyTooLoud: z.boolean().optional().describe('Only turn down files louder than the target'),
      limit: z.boolean().optional().describe('Brickwall-limit the render at limitCeiling'),
      limitCeiling: z.coerce.number().optional().describe('Limiter ceiling in dB, -30 to 0 (e.g. -1)'),
      limitTruePeak: z.boolean().optional().describe('Limit on true peak instead of sample peak'),
      metadata: z.object({
        title: z.string().optional(), artist: z.string().optional(), album: z.string().optional(), genre: z.string().optional(),
        year: z.string().optional(), isrc: z.string().optional(), comment: z.string().optional(), description: z.string().optional(),
      }).optional().describe('Embedded metadata, written to ID3 (MP3), INFO/BWF/AXML (WAV) and Vorbis (FLAC/OGG) at once; "" clears a field. Turns embedding on'),
      metadataRaw: z.record(z.string(), z.string()).optional().describe('Exact REAPER metadata keys, e.g. {"ID3:TCOM": "Composer"}; "" clears'),
      embedMetadata: z.boolean().optional().describe('Embed the stored metadata in rendered files'),
    },
    async ({ regionMatrix, metadata, metadataRaw, ...params }) =>
      reply(await sendCommand('set_render_settings', { ...params, ...json({ regionMatrix, metadata, metadataRaw }) })),
  );

  server.tool(
    'render_project',
    'Render the project with its current render settings (set them with set_render_settings) and return the files written, each measured: duration, integrated LUFS, true peak and sample peak. Synchronous: REAPER is busy until the render finishes, so keep renders short. Refused when a target file already exists (REAPER would ask) unless overwrite is true, when bounds is time_selection with no time selection, and when the format or secondary format is an encoder outside wav/aiff/flac/mp3/ogg/opus (they can open a dialog).',
    {
      overwrite: z.boolean().optional().describe('Delete existing target files before rendering'),
      tracks: z.array(trackRef).optional()
        .describe('For source stems / master_and_stems / selected_via_master: the tracks to render (index, name or "{GUID}"), selected for this render only'),
      analyze: z.boolean().optional().describe('Measure each file written (default true; up to 16 files)'),
    },
    async ({ overwrite, tracks, analyze }) =>
      reply(await sendCommand('render_project', { overwrite, analyze, ...json({ tracks }) }, RENDER_TIMEOUT_MS)),
  );

  server.tool(
    'render_versions',
    'Render alternate versions in one call (instrumental, a cappella, TV mix, clean): for each version the listed tracks are muted on top of the current mutes, the file pattern gets "-<name>" (or the version\'s own filePattern), and the project renders with the current settings. Every track, name and target is checked before the first render; mutes and the file pattern are restored afterwards, also when a render fails. Each file comes back measured like render_project.',
    {
      versions: z.array(z.object({
        name: z.string().describe('Version name, used in the file name: letters, digits, space, - _ .'),
        mute: z.array(trackRef).optional().describe('Tracks muted in this version (index, name, "{GUID}")'),
        filePattern: z.string().optional().describe('File pattern for this version instead of "<pattern>-<name>"'),
      })).min(1).max(16).describe('The versions to render, in order'),
      overwrite: z.boolean().optional().describe('Replace existing target files'),
      analyze: z.boolean().optional().describe('Measure each file written (default true)'),
    },
    async ({ versions, overwrite, analyze }) =>
      reply(await sendCommand('render_versions', { overwrite, analyze, ...json({ versions }) }, RENDER_TIMEOUT_MS * 4)),
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
      title: z.string().optional().describe('Project title (metadata)'),
      author: z.string().optional().describe('Project author (metadata)'),
      notes: z.string().optional().describe('Project notes (replaces them)'),
      repeat: z.boolean().optional().describe('Repeat / loop playback of the time selection'),
      metronome: z.boolean().optional().describe('Metronome on/off'),
    },
    async (params) => reply(await sendCommand('set_project_settings', params)),
  );
}
