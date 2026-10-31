import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { trace } from '@opentelemetry/api';
import { sendCommand } from '../bridge.js';
import { emitLog, getCompSegmentsHistogram } from '../telemetry.js';
import { trackRef } from './structure.js';

/** Most comp ranges one call takes (the bridge refuses more too). */
export const MAX_COMP_RANGES = 200;

const TRACK_MODES = [
  'input', 'stereo_out', 'none', 'stereo_out_latency', 'midi_out', 'mono_out', 'mono_out_latency',
  'midi_overdub', 'midi_replace', 'midi_touch_replace', 'multichannel_out', 'multichannel_out_latency',
  'input_mono', 'input_stereo', 'input_multichannel', 'input_midi', 'midi_latch_replace',
] as const;

const recordInput = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('audio'),
      channel: z.coerce.number().int().min(1).describe('First input channel, 1-based'),
      stereo: z.boolean().optional().describe('Stereo pair: this channel and the next'),
    }),
    z.object({
      kind: z.literal('midi'),
      device: z
        .union([z.coerce.number().int().min(0).max(61), z.enum(['all', 'vkb'])])
        .optional()
        .describe('MIDI input index from get_record_setup, "all" (default) or "vkb" (virtual keyboard)'),
      channel: z.coerce.number().int().min(0).max(16).optional().describe('0 = all channels (default), 1-16'),
    }),
    z.object({ kind: z.literal('none') }),
  ])
  .describe('Record input: { kind: "audio", channel, stereo }, { kind: "midi", device, channel } or { kind: "none" }');

/** A lane number; a numeric string is read as one, but never an array (z.coerce would turn [] into 0) */
const laneNumber = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0));

type Data = Record<string, unknown>;

function reply(res: { success: boolean; data?: unknown; error?: string }) {
  if (!res.success) return { content: [{ type: 'text' as const, text: `Error: ${res.error}` }], isError: true };
  return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
}

export function registerRecordingTools(server: McpServer): void {
  server.tool(
    'get_record_setup',
    'Recording setup: the global record mode (normal, time_selection auto-punch, selected_items auto-punch) with the punch range, the record path, ' +
      'every armed track (or every track with all) with its input ("In 3/4", "MIDI: all inputs"), monitoring, record mode and input FX count, ' +
      'and the audio and MIDI inputs that exist. Read this before arming or recording.',
    { all: z.boolean().optional().describe('List every track, not only the armed ones (max 64)') },
    async ({ all }) => {
      const res = await sendCommand('get_record_setup', { all });
      if (res.success) {
        const d = res.data as Data;
        const span = trace.getActiveSpan();
        span?.setAttribute('reaper.record.mode', String(d['mode']));
        span?.setAttribute('reaper.record.armed_count', Number(d['armedCount'] ?? (d['tracks'] as unknown[] | undefined)?.length ?? 0));
      }
      return reply(res);
    },
  );

  server.tool(
    'set_track_record',
    'Arm tracks and set their record input, monitoring (off, on, auto = tape style), record mode and monitor-items, for up to 64 tracks in one undo point. ' +
      'Every track and input is checked first (an input the audio device does not have, an unknown MIDI device): a refused call changes nothing. ' +
      'Returns each track\'s record state and warnings (a MIDI mode on an audio input, an armed track with no input). ' +
      'Modes: input (default), midi_overdub/midi_replace for MIDI, stereo_out/mono_out to print the track output.',
    {
      tracks: z
        .array(z.object({
          track: trackRef,
          arm: z.boolean().optional(),
          input: recordInput.optional(),
          monitor: z.enum(['off', 'on', 'auto']).optional().describe('Input monitoring; auto = only while armed and stopped or recording (tape style)'),
          mode: z.enum(TRACK_MODES).optional().describe('Record mode (I_RECMODE)'),
          monitorItems: z.boolean().optional().describe('Play existing items while monitoring (track "monitor track media when recording")'),
        }))
        .min(1)
        .max(64),
    },
    async ({ tracks }) => {
      const res = await sendCommand('set_track_record', { tracks: JSON.stringify(tracks) });
      if (res.success) {
        const rows = ((res.data as Data)['tracks'] as Data[] | undefined) ?? [];
        trace.getActiveSpan()?.setAttribute('reaper.record.armed_count', rows.filter((t) => t['armed']).length);
      }
      return reply(res);
    },
  );

  server.tool(
    'set_record_mode',
    'Set the global record mode: normal, time_selection (auto-punch: records only inside the time selection; give punchStart/punchEnd to set it) ' +
      'or selected_items (auto-punch on the selected items). Optionally the record path (a folder relative to the project, or absolute). ' +
      'All input is checked first; one undo point.',
    {
      mode: z.enum(['normal', 'time_selection', 'selected_items']).optional(),
      punchStart: z.coerce.number().min(0).optional().describe('Punch-in, seconds (needs mode time_selection)'),
      punchEnd: z.coerce.number().min(0).optional().describe('Punch-out, seconds'),
      recordPath: z.string().min(1).optional().describe('Where new recordings go, e.g. "Audio"'),
    },
    async (params) => {
      const res = await sendCommand('set_record_mode', params);
      if (res.success) trace.getActiveSpan()?.setAttribute('reaper.record.mode', String((res.data as Data)['mode']));
      return reply(res);
    },
  );

  server.tool(
    'get_track_lanes',
    'A track\'s fixed lanes (REAPER 7): whether they are on, each lane\'s name, whether it plays (exclusive, layered or off) and its items ' +
      '(index, position, length, take name; 100 per lane, then itemsMore). Use before comp_lanes to see which take is on which lane.',
    { track: trackRef },
    async ({ track }) => {
      const res = await sendCommand('get_track_lanes', { track });
      if (res.success) trace.getActiveSpan()?.setAttribute('reaper.lanes.count', Number((res.data as Data)['laneCount'] ?? 0));
      return reply(res);
    },
  );

  server.tool(
    'set_track_lanes',
    'Fixed lanes on a track: turn them on/off, set the lane count, name lanes and choose what plays — one lane alone (play: 2) or several layered (play: [0, 2]). ' +
      'Turning fixed lanes off puts every lane\'s items on one lane, all playing (the answer warns; undo_project brings the lanes back). ' +
      'A lane count below a lane that has items is refused; every refusal changes nothing. One undo point. ' +
      'REAPER can drop the names of lanes with no items, so name lanes once the takes are on them.',
    {
      track: trackRef,
      fixedLanes: z.boolean().optional(),
      laneCount: z.coerce.number().int().min(1).max(64).optional(),
      names: z.array(z.object({ lane: z.coerce.number().int().min(0), name: z.string() })).max(64).optional().describe('Lane names, lanes 0-based'),
      play: z
        .union([z.array(z.coerce.number().int().min(0)).min(1).max(64), laneNumber])
        .optional()
        .describe('A lane number to play alone, or an array of lanes to play together (layered); every other lane goes silent'),
    },
    async ({ track, fixedLanes, laneCount, names, play }) => {
      const res = await sendCommand('set_track_lanes', {
        track, fixedLanes, laneCount,
        names: names === undefined ? undefined : JSON.stringify(names),
        play: play === undefined ? undefined : JSON.stringify(play),
      });
      if (res.success) trace.getActiveSpan()?.setAttribute('reaper.lanes.count', Number((res.data as Data)['laneCount'] ?? 0));
      return reply(res);
    },
  );

  server.tool(
    'comp_lanes',
    'Comp takes from fixed lanes: give time ranges and the lane to take each from ({ start, end, lane }, seconds, no overlaps); ' +
      'copies of those parts go onto a new lane ("Comp" by default) with crossfades where one range meets the next, and that lane plays alone. ' +
      'The source lanes stay untouched (silent), so another comp or set_track_lanes play can switch back. ' +
      'A range a lane has no audio for is refused with the gap; every refusal changes nothing. One undo point.',
    {
      track: trackRef,
      ranges: z
        .array(z.object({
          start: z.coerce.number().min(0),
          end: z.coerce.number().min(0),
          lane: z.coerce.number().int().min(0).describe('Source lane, 0-based (get_track_lanes)'),
        }))
        .min(1)
        .max(MAX_COMP_RANGES),
      crossfadeMs: z.coerce.number().min(0).max(500).optional().describe('Crossfade at each switch, ms (default 10)'),
      name: z.string().min(1).optional().describe('Name of the new comp lane (default "Comp")'),
    },
    async ({ track, ranges, crossfadeMs, name }) => {
      const res = await sendCommand('comp_lanes', { track, ranges: JSON.stringify(ranges), crossfadeMs, name });
      // A refusal is the agent's input; a comp that broke half way (and was undone) is a bug
      if (!res.success && res.error?.startsWith('comp failed and was undone')) {
        emitLog('error', `comp_lanes: ${res.error}`, { 'gen_ai.tool.name': 'comp_lanes', 'error.type': 'comp_undone' }, { eventName: 'reaper.comp.undone' });
      }
      if (res.success) {
        const d = res.data as Data;
        const segments = (d['segments'] as Data[] | undefined) ?? [];
        const sources = new Set(segments.map((s) => s['lane'])).size;
        getCompSegmentsHistogram().record(segments.length);
        const span = trace.getActiveSpan();
        span?.setAttribute('reaper.comp.segment_count', segments.length);
        span?.setAttribute('reaper.comp.source_lane_count', sources);
        span?.setAttribute('reaper.lanes.count', Number(d['laneCount'] ?? 0));
      }
      return reply(res);
    },
  );
}
