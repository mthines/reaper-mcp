/**
 * Mixing depth: automation modes, FX parameter modulation (LFO, audio control signal,
 * parameter link), FX pin mappings, monitoring FX, freeze / render in place, and stretch
 * markers. The logic lives in reaper/mcp_mixing_lib.lua; nested values travel to the
 * bridge as JSON strings. quantize_audio finds the hits in the item's source file with
 * the sidecar, then places and moves stretch markers in one bridge call.
 */
import { z } from 'zod/v4';
import { trace } from '@opentelemetry/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CommandType } from '@reaper-mcp/protocol';
import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { getQuantizeOffsetHistogram } from '../telemetry.js';
import { trackRef } from './structure.js';

const SIDECAR_NOT_INSTALLED_MSG =
  'Audio understanding sidecar not installed. ' +
  'Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar';

/** Longest item quantize_audio analyses (seconds of source audio). */
export const MAX_QUANTIZE_SECONDS = 900;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const error = (text: string): ToolResult => ({ content: [{ type: 'text', text: `Error: ${text}` }], isError: true });
const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

async function run(command: CommandType, params: Record<string, unknown>, timeoutMs?: number): Promise<ToolResult & { data?: Record<string, unknown> }> {
  const res = await sendCommand(command, params, timeoutMs);
  if (!res.success) return error(res.error ?? 'unknown error');
  return { ...ok(res.data), data: res.data as Record<string, unknown> };
}

/** Objects and arrays go to the bridge as JSON strings (it decodes only the top level). */
function flatten(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...args };
  for (const k of keys) if (out[k] !== undefined) out[k] = JSON.stringify(out[k]);
  return out;
}

const trackIndex = z.coerce.number().int().min(-1).describe('0-based track index (-1 = master)');
const fxIndex = z.coerce.number().int().min(0).describe('0-based FX index in the track\'s chain');
const tracks = z.array(trackRef).min(1).max(64);
const renderMode = z.enum(['stereo', 'mono', 'multichannel']).optional().default('stereo');
const automationMode = z.enum(['trim', 'read', 'touch', 'write', 'latch', 'latch_preview']);
const fxParams = z.array(z.object({
  paramIndex: z.coerce.number().int().min(0),
  value: z.coerce.number().min(0).max(1).describe('Normalized 0..1'),
})).optional().describe('Parameters to set, normalized 0..1');
const direction = z.coerce.number().int().min(-1).max(1).optional()
  .describe('-1 moves the value down from the baseline, 0 around it, 1 up (default)');

export function registerMixingTools(server: McpServer): void {
  server.tool(
    'set_automation_mode',
    'Set the automation mode of tracks (trim/read, read, touch, write, latch, latch_preview) and/or REAPER\'s global automation override ("none" clears it, "bypass" turns all automation off). Returns each track\'s mode before and after. Write/latch/touch record fader moves while playing.',
    {
      tracks: tracks.optional().describe('Tracks to set (needs mode)'),
      mode: automationMode.optional(),
      globalOverride: z.enum(['none', 'bypass', 'trim', 'read', 'touch', 'write', 'latch', 'latch_preview']).optional()
        .describe('Override every track\'s mode at once; not saved in the project'),
    },
    async (args) => run('set_automation_mode', flatten(args, ['tracks'])),
  );

  server.tool(
    'get_fx_param_modulation',
    'Read FX parameter modulation (REAPER 6.37+): LFO, audio control signal (sidechain follower) and parameter link, with the baseline. Without paramIndex, lists only the modulated parameters of the FX.',
    { trackIndex, fxIndex, paramIndex: z.coerce.number().int().min(0).optional() },
    async (args) => run('get_fx_param_modulation', args),
  );

  server.tool(
    'set_fx_param_modulation',
    'Modulate an FX parameter (REAPER 6.37+): an LFO, an audio control signal (the parameter follows a channel\'s level, e.g. a sidechain on 3/4), and/or a link to another FX parameter on the same track. Only the fields given change; enabled:false turns all modulation of the parameter off. One undo point; the state before is returned.',
    {
      trackIndex,
      fxIndex,
      paramIndex: z.coerce.number().int().min(0),
      enabled: z.boolean().optional().describe('false turns off all modulation of this parameter'),
      baseline: z.coerce.number().min(0).max(1).optional().describe('0..1, the value the modulation moves around'),
      lfo: z.object({
        enabled: z.boolean().optional(),
        shape: z.enum(['sine', 'square', 'saw_down', 'saw_up', 'triangle', 'random']).optional(),
        speed: z.coerce.number().positive().max(64).optional().describe('Hz, or quarter notes per cycle with tempoSync'),
        strength: z.coerce.number().min(0).max(1).optional(),
        phase: z.coerce.number().min(0).max(1).optional(),
        tempoSync: z.boolean().optional(),
        direction,
      }).optional(),
      audio: z.object({
        enabled: z.boolean().optional(),
        attackMs: z.coerce.number().min(0).max(1000).optional(),
        releaseMs: z.coerce.number().min(0).max(1000).optional(),
        minDb: z.coerce.number().min(-60).max(12).optional().describe('Level that maps to no modulation'),
        maxDb: z.coerce.number().min(-60).max(12).optional().describe('Level that maps to full modulation'),
        strength: z.coerce.number().min(0).max(1).optional(),
        channel: z.coerce.number().int().min(1).max(64).optional().describe('Track channel to follow, 1-based (3 = a sidechain on 3/4)'),
        direction,
      }).optional().describe('Audio control signal: the parameter follows a channel\'s level'),
      link: z.object({
        enabled: z.boolean().optional(),
        fxIndex: z.coerce.number().int().min(0),
        paramIndex: z.coerce.number().int().min(0),
        scale: z.coerce.number().min(-10).max(10).optional(),
        offset: z.coerce.number().min(-1).max(1).optional(),
      }).optional().describe('Follow another FX parameter on this track'),
    },
    async (args) => {
      const res = await run('set_fx_param_modulation', flatten(args, ['lfo', 'audio', 'link']));
      if (!res.isError) {
        const kinds = (['lfo', 'audio', 'link'] as const).filter((k) => args[k] !== undefined);
        trace.getActiveSpan()?.setAttribute('reaper.fx.modulation.kind', args.enabled === false ? 'off' : kinds.join(',') || 'baseline');
      }
      return res;
    },
  );

  server.tool(
    'get_fx_pins',
    'Read an FX\'s pin mappings: each input and output pin and the track channels (1-based) it connects to, plus the track\'s channel count. Pins 3/4 of a compressor are its sidechain input.',
    { trackIndex, fxIndex },
    async (args) => run('get_fx_pins', args),
  );

  server.tool(
    'set_fx_pins',
    'Connect FX pins to track channels (1-based, up to 64). Give a channel list per pin ([[1],[2],[3],[4]]) or only the pins to change ([{pin: 2, channels: [3]}, {pin: 3, channels: [4]}] routes a sidechain on 3/4). The track is widened to the highest channel used; trackChannels sets it explicitly. All validated before any write; one undo point.',
    {
      trackIndex,
      fxIndex,
      inputs: z.array(z.union([
        z.array(z.coerce.number().int().min(1).max(64)),
        z.object({ pin: z.coerce.number().int().min(0), channels: z.array(z.coerce.number().int().min(1).max(64)) }),
      ])).optional(),
      outputs: z.array(z.union([
        z.array(z.coerce.number().int().min(1).max(64)),
        z.object({ pin: z.coerce.number().int().min(0), channels: z.array(z.coerce.number().int().min(1).max(64)) }),
      ])).optional(),
      trackChannels: z.coerce.number().int().min(2).max(128).optional().describe('Even channel count for the track'),
    },
    async (args) => {
      const res = await run('set_fx_pins', flatten(args, ['inputs', 'outputs']));
      if (res.data) trace.getActiveSpan()?.setAttribute('reaper.fx.pins.widened', res.data['trackChannelsBefore'] !== undefined);
      return res;
    },
  );

  server.tool(
    'list_monitoring_fx',
    'List the monitoring FX chain (on the master, heard only in your monitors, never rendered — room correction, a reference meter, a mono check). Global to REAPER, not saved in the project.',
    {},
    async () => run('list_monitoring_fx', {}),
  );

  server.tool(
    'add_monitoring_fx',
    'Add an FX to the monitoring chain (heard in the monitors, never rendered), with optional normalized parameters.',
    { fxName: z.string().min(1).describe('FX name as add_fx takes it, e.g. "ReaEQ" or "VST3: SoundID Reference"'), params: fxParams },
    async (args) => run('add_monitoring_fx', flatten(args, ['params'])),
  );

  server.tool(
    'set_monitoring_fx',
    'Bypass, set offline, or set normalized parameters of a monitoring FX by index (from list_monitoring_fx).',
    {
      fxIndex: z.coerce.number().int().min(0),
      enabled: z.boolean().optional(),
      offline: z.boolean().optional(),
      params: fxParams,
    },
    async (args) => run('set_monitoring_fx', flatten(args, ['params'])),
  );

  server.tool(
    'remove_monitoring_fx',
    'Remove a monitoring FX by index (from list_monitoring_fx).',
    { fxIndex: z.coerce.number().int().min(0) },
    async (args) => run('remove_monitoring_fx', args),
  );

  server.tool(
    'freeze_tracks',
    'Freeze tracks: render them (pre-fader) to stereo, mono or multichannel and take their items and online FX out until unfrozen, to free CPU. Blocks REAPER while it renders (a few seconds per minute of audio). The track selection is put back. Not the master.',
    { tracks, mode: renderMode },
    async (args) => {
      const res = await run('freeze_tracks', flatten(args, ['tracks']), 300_000);
      const span = trace.getActiveSpan();
      span?.setAttribute('reaper.freeze.mode', args.mode);
      span?.setAttribute('reaper.freeze.track_count', args.tracks.length);
      return res;
    },
  );

  server.tool(
    'unfreeze_tracks',
    'Unfreeze tracks: restore the items and FX a freeze took out (one freeze layer per call). Refuses a track that is not frozen.',
    { tracks },
    async (args) => run('unfreeze_tracks', flatten(args, ['tracks']), 120_000),
  );

  server.tool(
    'apply_fx_to_items',
    'Render in place: apply the track and take FX to items as a new active take (stereo, mono or multichannel). The old take stays, so the render can be switched back with set_active_take. Blocks REAPER while it renders. The item selection is put back.',
    {
      items: z.array(z.object({ trackIndex: z.coerce.number().int().min(0), itemIndex: z.coerce.number().int().min(0) })).min(1).max(64),
      mode: renderMode,
    },
    async (args) => run('apply_fx_to_items', flatten(args, ['items']), 300_000),
  );

  server.tool(
    'add_stretch_markers',
    'Add many stretch markers to an audio item in one call and one undo point. position is seconds from the item start; sourcePosition (seconds in the source) pins the audio at that spot to the new position, which stretches the audio around it.',
    {
      trackIndex: z.coerce.number().int().min(0),
      itemIndex: z.coerce.number().int().min(0),
      markers: z.array(z.object({
        position: z.coerce.number().min(0),
        sourcePosition: z.coerce.number().optional(),
      })).min(1).max(2000),
    },
    async (args) => run('add_stretch_markers', flatten(args, ['markers'])),
  );

  server.tool(
    'quantize_audio',
    'Quantize an audio item to the grid with stretch markers: finds the hits in the item\'s source (sidecar), puts a marker on each and moves it toward the nearest grid line (strength, window and swing as quantize_midi). The item keeps its length (anchors at both ends); the item\'s existing stretch markers are replaced. Returns the timing offset before and after (avg/max ms). Requires the sidecar.',
    {
      trackIndex: z.coerce.number().int().min(0),
      itemIndex: z.coerce.number().int().min(0),
      grid: z.coerce.number().positive().max(16).describe('Grid in quarter notes: 1 = quarter, 0.5 = 8th, 0.25 = 16th'),
      strength: z.coerce.number().min(0).max(1).optional().default(1).describe('0..1, how far each hit moves toward its line'),
      window: z.coerce.number().positive().max(1).optional().default(1).describe('0..1 of half a grid step; hits further from a line stay put'),
      swing: z.coerce.number().min(0).max(1).optional().default(0),
      sensitivity: z.coerce.number().min(0).max(1).optional().default(0.5).describe('Hit detection: higher finds softer hits'),
      minGapMs: z.coerce.number().min(5).max(2000).optional().default(60),
      minStrength: z.coerce.number().min(0).max(1).optional().default(0.2).describe('Ignore hits weaker than this (0..1 of the loudest)'),
    },
    async ({ trackIndex: ti, itemIndex, grid, strength, window, swing, sensitivity, minGapMs, minStrength }) => {
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return error(SIDECAR_NOT_INSTALLED_MSG);
      const props = await sendCommand('get_media_item_properties', { trackIndex: ti, itemIndex });
      if (!props.success) return error(props.error ?? 'item not found');
      const item = props.data as { isMidi?: boolean; sourceFile?: string; startOffset?: number; playRate?: number; length?: number };
      if (item.isMidi) return error('quantize_audio needs an audio item; use quantize_midi for MIDI');
      if (!item.sourceFile) return error('The item has no source file to analyse');
      const offs = item.startOffset ?? 0;
      const span = (item.length ?? 0) * (item.playRate ?? 1);
      if (span > MAX_QUANTIZE_SECONDS) return error(`Item too long: max ${MAX_QUANTIZE_SECONDS} s of source audio per call`);

      let detected: Record<string, unknown>;
      try {
        detected = await sidecar.transients({
          path: item.sourceFile,
          ...(offs > 0 ? { startTime: offs } : {}),
          endTime: offs + span,
          band: 'full',
          sensitivity,
          minGapMs,
        });
      } catch (err) {
        return error(`Hit detection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const all = (detected['transients'] as { time: number; strength: number }[] | undefined) ?? [];
      // The sidecar's times are seconds into the file (startTime only limits the window)
      const hits = all.filter((t) => t.strength >= (minStrength ?? 0.2)).map((t) => t.time);

      const res = await run('quantize_audio', { trackIndex: ti, itemIndex, grid, strength, window, swing, hits: JSON.stringify(hits) }, 60_000);
      if (!res.data) return res;
      const d = res.data as { moved?: number; skipped?: number; offsetBefore?: { avgMs: number }; offsetAfter?: { avgMs: number } };
      const s = trace.getActiveSpan();
      s?.setAttribute('reaper.quantize.hits', hits.length);
      s?.setAttribute('reaper.quantize.moved', d.moved ?? 0);
      s?.setAttribute('reaper.quantize.skipped', d.skipped ?? 0);
      if (d.offsetBefore && d.offsetAfter && hits.length > 0) {
        const h = getQuantizeOffsetHistogram();
        h.record(d.offsetBefore.avgMs / 1000, { 'reaper.quantize.stage': 'before' });
        h.record(d.offsetAfter.avgMs / 1000, { 'reaper.quantize.stage': 'after' });
      }
      return ok({ ...res.data, detected: all.length, used: hits.length });
    },
  );
}
