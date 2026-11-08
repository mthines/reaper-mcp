import { z } from 'zod/v4';
import { trace } from '@opentelemetry/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { activeTelemetryMode } from '../telemetry.js';

/**
 * report_plugin_research: the plugin-researcher's last call, so usage telemetry can count
 * plugin research runs (/learn-plugin, and /mixer or /mastering bootstrapping a plugin they
 * don't know) and how they went. TS-only: no bridge command, nothing changes in REAPER.
 *
 * Privacy rule (TELEMETRY.md promises plugin names are never sent): every attribute is a
 * closed value or a capped count, and no combination of them on one span may single out one
 * plugin. So there is no name or slug, no exact parameter count (it fingerprints a plugin;
 * it is bucketed), no "has a built-in record" outcome and no extension flag (both narrow
 * to a handful of known plugins). The scratch track's tag is used only to time the run
 * here, in memory; it never reaches a span.
 */

export const OUTCOMES = ['new', 'refined', 'not_installed', 'load_failed', 'no_lorekit'] as const;
export const CALLERS = ['learn-plugin', 'mixer', 'mastering', 'other'] as const;

/** memory-protocol.md's category field guide plus the categories the built-in list uses. */
export const PLUGIN_CATEGORIES = [
  'eq', 'compressor', 'limiter', 'saturator', 'reverb', 'delay', 'gate', 'de-esser', 'amp-sim',
  'channel-strip', 'analyzer', 'stereo-imager', 'multiband', 'pitch-correction', 'instrument', 'synth',
  'drums', 'drum-sampler', 'composition', 'restoration', 'stem-separator', 'midi-utility', 'utility',
] as const;

/** memory-protocol.md's style field guide. */
export const PLUGIN_STYLES = ['transparent', 'character', 'vintage', 'modern', 'surgical'] as const;

export const FX_FORMATS = ['VST', 'VST3', 'AU', 'CLAP', 'JS', 'LV2', 'DX'] as const;

/**
 * Caps for the counts. A larger value is sent as the cap rather than refused: a refused
 * call is rejected before the traced handler runs, so the run would leave no span at all.
 */
const MAX_COUNT = { batch: 20, probed: 64, questions: 20, sources: 10 } as const;

/** The scratch track a plugin-researcher (`[MCP] plugin-research <TAG>`) or a /make-plugin run (`[MCP] make-plugin <TAG>`) adds. */
const SCRATCH_TRACK = /^\[MCP\] (?:plugin-research|make-plugin) (\S.*)$/;
/** Runs longer than this were left open (the report never came), so they are not timed. */
const MAX_RUN_MS = 2 * 60 * 60 * 1000;
const MAX_OPEN_RUNS = 50;
const runStarts = new Map<string, number>();

/**
 * Note when a scratch track appears, so report_plugin_research can time the run. Called with
 * every track name add_track and run_plan create; other names are ignored. Memory only.
 * A tag seen again starts a new run: an earlier run with that tag never reported.
 */
export function noteScratchTrack(name: string | undefined, now = Date.now()): void {
  const tag = name?.trim().match(SCRATCH_TRACK)?.[1]?.trim();
  if (!tag) return;
  runStarts.delete(tag);
  if (runStarts.size >= MAX_OPEN_RUNS) runStarts.delete(runStarts.keys().next().value as string);
  runStarts.set(tag, now);
}

/** Seconds since the scratch track with this tag appeared, then forgotten; undefined when unknown. */
export function runSeconds(tag: string | undefined, now = Date.now()): number | undefined {
  const key = tag?.trim();
  const start = key ? runStarts.get(key) : undefined;
  if (key) runStarts.delete(key);
  if (start === undefined || now < start || now - start > MAX_RUN_MS) return undefined;
  return Math.round((now - start) / 1000);
}

/** A blank string is not a value: an early-stop report that passes "" means "not known". */
function given(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/** The value when it is one of `allowed`, else "other": free text never reaches a span. */
function closed<T extends string>(allowed: readonly T[], value: string | undefined): T | 'other' {
  const candidate = value?.split(',')[0]?.trim().toLowerCase();
  return candidate !== undefined && (allowed as readonly string[]).includes(candidate) ? (candidate as T) : 'other';
}

/** "VST3i:" / "vst3" / "CLAPi" → format and whether it is an instrument (REAPER's trailing "i"). */
export function fxFormat(prefix: string | undefined): { format: (typeof FX_FORMATS)[number] | 'other'; instrument: boolean } {
  const label = prefix?.trim().replace(/:$/, '').toUpperCase() ?? '';
  const instrument = /^(VST3?|AU|CLAP|LV2|DX)I$/.test(label);
  const base = instrument ? label.slice(0, -1) : label;
  const format = (FX_FORMATS as readonly string[]).includes(base) ? (base as (typeof FX_FORMATS)[number]) : 'other';
  return { format, instrument };
}

function fxAttributes(prefix: string): Record<string, string | boolean> {
  const { format, instrument } = fxFormat(prefix);
  return { 'reaper.plugin.format': format, 'reaper.plugin.instrument': instrument };
}

/** A whole, non-negative count from a number or numeric string; blank, null or anything else is "not known". */
function knownCount(value: number | string | null | undefined): number | undefined {
  const count = typeof value === 'string' ? (value.trim() ? Number(value) : NaN) : value ?? NaN;
  return Number.isInteger(count) && count >= 0 ? count : undefined;
}

/** A plugin's parameter count in coarse buckets: the exact number can identify the plugin. */
export function paramsBucket(total: number | undefined): string | undefined {
  if (total === undefined) return undefined;
  if (total <= 0) return 'none';
  if (total <= 15) return '1-15';
  if (total <= 63) return '16-63';
  if (total <= 255) return '64-255';
  return '256+';
}

export function registerPluginResearchTools(server: McpServer): void {
  server.tool(
    'report_plugin_research',
    'Call once at the end of a plugin research run (the plugin-researcher\'s last step), after cleaning up the scratch track, ' +
      'also when the run stopped early. Records how the run went in pseudonymous usage telemetry as fixed values and counts — never ' +
      'the plugin\'s name. The result shows exactly what was sent. Changes nothing in REAPER.',
    {
      outcome: z
        .string()
        .describe('new: a new record; refined: an existing record of yours, or an overlay on a built-in one; not_installed: no installed FX matched; load_failed: add_fx failed; no_lorekit: LoreKit not connected, nothing saved'),
      category: z.string().optional().describe('The record\'s category (e.g. "compressor"); the first one if it has several'),
      style: z.string().optional().describe('The record\'s style: transparent, character, vintage, modern or surgical'),
      format: z.string().optional().describe('The format prefix of the FX name: VST, VST3, AU, CLAP, JS, LV2, DX, with an instrument\'s "i" (VST3i) as REAPER shows it'),
      // not z.coerce: it turns "" and null into 0, which would be sent as a real "none"
      paramsTotal: z.union([z.number(), z.string()]).nullable().optional().describe('How many parameters get_fx_parameters listed (sent only as a range); leave out when not known'),
      paramsProbed: z.coerce.number().int().min(0).optional().describe('Parameters probed live in Step 4 (0 if not inspected)'),
      openQuestions: z.coerce.number().int().min(0).optional().describe('Open questions in the report, preference included'),
      sources: z.coerce.number().int().min(0).optional().describe('Web sources the record cites'),
      cleanedUp: z.boolean().optional().describe('The scratch track was deleted and nothing else changed (false: report it first)'),
      caller: z.string().optional().describe('Who dispatched the research: the prompt\'s "Dispatched by" line — learn-plugin, mixer or mastering (default other)'),
      batchSize: z.coerce.number().int().min(1).optional().describe('Plugins researched in the same request: the prompt\'s "Batch" line (default 1)'),
      scratchTag: z.string().optional().describe('The <TAG> of your "[MCP] plugin-research <TAG>" track, so the server can time the run. Never sent.'),
    },
    async (args) => {
      const category = given(args.category);
      const style = given(args.style);
      const format = given(args.format);
      const seconds = runSeconds(args.scratchTag);
      const bucket = paramsBucket(knownCount(args.paramsTotal));
      const attributes: Record<string, string | number | boolean> = {
        'reaper.plugin_research.outcome': closed(OUTCOMES, args.outcome.trim().toLowerCase() === 'overlay' ? 'refined' : args.outcome),
        'reaper.plugin_research.caller': args.caller === undefined ? 'other' : closed(CALLERS, args.caller),
        'reaper.plugin_research.batch_size': Math.min(args.batchSize ?? 1, MAX_COUNT.batch),
        'reaper.plugin_research.params_probed': Math.min(args.paramsProbed ?? 0, MAX_COUNT.probed),
        'reaper.plugin_research.open_questions': Math.min(args.openQuestions ?? 0, MAX_COUNT.questions),
        'reaper.plugin_research.sources': Math.min(args.sources ?? 0, MAX_COUNT.sources),
        ...(args.cleanedUp !== undefined ? { 'reaper.plugin_research.cleaned_up': args.cleanedUp } : {}),
        ...(seconds !== undefined ? { 'reaper.plugin_research.duration_s': seconds } : {}),
        // given but unknown → "other"; not given → left out, so a missing value never reads as one
        ...(category ? { 'reaper.plugin.category': closed(PLUGIN_CATEGORIES, category) } : {}),
        ...(style ? { 'reaper.plugin.style': closed(PLUGIN_STYLES, style) } : {}),
        ...(format ? fxAttributes(format) : {}),
        ...(bucket ? { 'reaper.plugin.params_total': bucket } : {}),
      };
      trace.getActiveSpan()?.setAttributes(attributes);

      const mode = activeTelemetryMode();
      const result = { telemetry: mode, sent: mode === 'off' ? {} : attributes };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
