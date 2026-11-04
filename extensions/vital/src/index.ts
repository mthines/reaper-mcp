import type { ExtensionApi, ExtensionModule, FxLocation, ToolResult } from '@reaper-mcp/extension-api';
import { applyLfo, applyModulation, applySettings, applyWavetable, summarize, MOD_SOURCES, type Edit } from './patch.js';
import { buildVitalState, parseVitalState, type VitalPatch } from './state.js';
import { buildWavetable, frameFromHarmonics, shapeHarmonics, MAX_FRAMES } from './wavetable.js';

const FX_NOTE = 'fxIndex is optional: with one Vital on the track it is found for you.';
const MAX_SETTINGS_SHOWN = 200;

type Located = { ok: true; loc: FxLocation } | { ok: false; error: string };

async function locateVital(api: ExtensionApi, trackIndex: number, fxIndex?: number): Promise<Located> {
  if (fxIndex !== undefined) return { ok: true, loc: { trackIndex, fxIndex } };
  const res = await api.bridge('get_track_properties', { trackIndex });
  if (!res.success) return { ok: false, error: res.error ?? 'could not read the track' };
  const fxList = ((res.data as { fxList?: { index: number; name: string }[] } | undefined)?.fxList ?? []).filter((f) => /vital/i.test(f.name));
  if (fxList.length === 0) return { ok: false, error: `No Vital on track ${trackIndex}` };
  if (fxList.length > 1) return { ok: false, error: `Track ${trackIndex} has ${fxList.length} Vitals (FX ${fxList.map((f) => f.index).join(', ')}); pass fxIndex` };
  return { ok: true, loc: { trackIndex, fxIndex: fxList[0].index } };
}

interface EditOutcome {
  info: Record<string, unknown>;
}

/** Read the patch, let `mutate` edit it, and write it back unless `dryRun`; a refused edit writes nothing. */
async function editPatch(
  api: ExtensionApi,
  args: { trackIndex: number; fxIndex?: number; dryRun?: boolean },
  mutate: (patch: VitalPatch) => Edit<EditOutcome> | { ok: false; error: string },
): Promise<ToolResult> {
  const located = await locateVital(api, args.trackIndex, args.fxIndex);
  if (!located.ok) return api.error(located.error);
  const got = await api.fxState.get(located.loc);
  if (!got.ok) return api.error(got.error);
  if (!/vital/i.test(got.value.name)) return api.error(`FX ${located.loc.fxIndex} on track ${located.loc.trackIndex} is "${got.value.name}", not Vital`);
  const parsed = parseVitalState(got.value.state);
  if (!parsed.ok) return api.error(parsed.error);

  const patch = parsed.value.patch;
  const result = mutate(patch);
  if (!result.ok) return api.error(`${result.error} (nothing was changed)`);
  if (args.dryRun) return api.json({ written: false, dryRun: true, ...result.info });

  const state = buildVitalState(parsed.value, patch);
  const set = await api.fxState.set(located.loc, state, { expectName: 'Vital' });
  if (!set.ok) return api.error(set.error);
  return api.json({
    written: true,
    ...result.info,
    note: 'Vital reloaded the patch; an open Vital window may need closing and re-opening to redraw. undo_project reverts it.',
  });
}

const extension: ExtensionModule = {
  register(api) {
    const { z } = api;
    const trackIndex = z.coerce.number().int().min(0).describe('0-based track index');
    const fxIndex = z.coerce.number().int().min(0).optional().describe(`FX slot of the Vital. ${FX_NOTE}`);
    const dryRun = z.boolean().optional().describe('Check and show what would change, write nothing');

    api.tool(
      'read_patch',
      'Summarize the Vital patch on a track: oscillators with their wavetable names and frame counts, filters, LFO shapes, effects that are on, ' +
        'and every mod-matrix route with its amount. With settingsMatching, also the raw values of the settings whose names contain that text ' +
        '(e.g. "osc_1", "filter_1", "env_1"). Read-only.',
      { trackIndex, fxIndex, settingsMatching: z.string().min(1).optional().describe('Substring of setting names to include, e.g. "osc_1_"') },
      async (args) => {
        const located = await locateVital(api, args.trackIndex, args.fxIndex);
        if (!located.ok) return api.error(located.error);
        const got = await api.fxState.get(located.loc);
        if (!got.ok) return api.error(got.error);
        if (!/vital/i.test(got.value.name)) return api.error(`FX ${located.loc.fxIndex} on track ${located.loc.trackIndex} is "${got.value.name}", not Vital`);
        const parsed = parseVitalState(got.value.state);
        if (!parsed.ok) return api.error(parsed.error);
        const patch = parsed.value.patch;
        const out: Record<string, unknown> = { fxIndex: located.loc.fxIndex, ...summarize(patch) };
        if (args.settingsMatching) {
          const hits = Object.entries(patch.settings).filter(([k, v]) => typeof v === 'number' && k.includes(args.settingsMatching as string));
          out['settings'] = Object.fromEntries(hits.slice(0, MAX_SETTINGS_SHOWN));
          if (hits.length > MAX_SETTINGS_SHOWN) out['settingsTruncated'] = `${hits.length} match; showing ${MAX_SETTINGS_SHOWN}. Narrow settingsMatching.`;
        }
        return api.json(out);
      },
    );

    api.tool(
      'write_patch',
      'Edit the Vital patch on a track in one step: plain settings by Vital\'s own names (osc_1_level, filter_1_cutoff, env_1_attack, …; raw values as in read_patch), ' +
        'mod-matrix routes (add, update or remove), and LFO shapes. Everything is validated first; one refused edit changes nothing. ' +
        `Mod sources: ${MOD_SOURCES.join(', ')}. A destination is a setting name. Undoable with undo_project.`,
      {
        trackIndex,
        fxIndex,
        settings: z.record(z.string(), z.coerce.number()).optional().describe('Setting name -> new raw value'),
        modulations: z
          .array(
            z.object({
              source: z.string().describe('e.g. lfo_1, env_2, macro_control_1, velocity'),
              destination: z.string().describe('A setting name, e.g. filter_1_cutoff'),
              amount: z.coerce.number().min(-1).max(1).optional().describe('-1..1 (a new route starts at 1)'),
              bipolar: z.boolean().optional(),
              stereo: z.boolean().optional(),
              bypass: z.boolean().optional(),
              power: z.coerce.number().optional().describe('Curve of the route, 0 = straight'),
              remove: z.boolean().optional().describe('Remove this route'),
            }),
          )
          .optional(),
        lfos: z
          .array(
            z.object({
              index: z.coerce.number().int().min(1).max(8).describe('LFO 1-8'),
              name: z.string().optional(),
              points: z.array(z.tuple([z.coerce.number(), z.coerce.number()])).describe('[x, y] pairs, both 0..1, x not going backwards'),
              powers: z.array(z.coerce.number()).optional().describe('Curve after each point; defaults to straight'),
              smooth: z.boolean().optional(),
            }),
          )
          .optional(),
        dryRun,
      },
      async (args) => {
        if (!args.settings && !args.modulations?.length && !args.lfos?.length) {
          return api.error('Nothing to change: give settings, modulations or lfos');
        }
        return editPatch(api, args, (patch) => {
          const info: Record<string, unknown> = {};
          if (args.settings) {
            const r = applySettings(patch, args.settings);
            if (!r.ok) return r;
            info['changedSettings'] = r.changed;
          }
          if (args.modulations?.length) {
            const routes = [];
            for (const m of args.modulations) {
              const r = applyModulation(patch, m);
              if (!r.ok) return r;
              routes.push({ source: m.source, destination: m.destination, slot: r.slot, action: r.action });
            }
            info['modulations'] = routes;
          }
          if (args.lfos?.length) {
            for (const l of args.lfos) {
              const r = applyLfo(patch, { ...l, points: l.points as [number, number][] });
              if (!r.ok) return r;
            }
            info['lfosSet'] = args.lfos.map((l) => l.index);
          }
          return { ok: true, info };
        });
      },
    );

    const frameSpec = z.union([
      z.object({
        shape: z.enum(['sine', 'saw', 'square', 'triangle']).describe('A classic band-limited shape'),
        harmonics: z.coerce.number().int().min(1).max(512).optional().describe('How many harmonics (default 64)'),
      }),
      z.object({
        harmonics: z.array(z.coerce.number()).min(1).max(512).describe('Amplitude of the 1st, 2nd, 3rd … harmonic'),
        phases: z.array(z.coerce.number()).optional().describe('Phase in radians per harmonic (default 0)'),
      }),
    ]);

    api.tool(
      'set_wavetable',
      'Build a wavetable and put it on one Vital oscillator: 1 to 256 frames, each a classic shape or an additive recipe (amplitudes of the harmonics), ' +
        'spread evenly along the wavetable position so the oscillator morphs from the first frame to the last. 2048-sample frames, scaled to peak 1. Undoable with undo_project.',
      {
        trackIndex,
        fxIndex,
        oscillator: z.coerce.number().int().min(1).max(3).describe('Oscillator 1-3'),
        name: z.string().min(1).max(60).describe('Wavetable name shown in Vital'),
        frames: z.array(frameSpec).min(1).max(MAX_FRAMES),
        author: z.string().optional(),
        dryRun,
      },
      async (args) => {
        let wavetable;
        try {
          const frames = args.frames.map((f) => {
            if ('shape' in f) return frameFromHarmonics(shapeHarmonics(f.shape, f.harmonics ?? 64));
            return frameFromHarmonics(f.harmonics as number[], f.phases);
          });
          wavetable = buildWavetable({ name: args.name, frames, author: args.author });
        } catch (err) {
          return api.error(err instanceof Error ? err.message : String(err));
        }
        return editPatch(api, args, (patch) => {
          const r = applyWavetable(patch, args.oscillator, wavetable);
          if (!r.ok) return r;
          return { ok: true, info: { oscillator: args.oscillator, wavetable: { name: args.name, frames: args.frames.length } } };
        });
      },
    );

    api.describeCategory('Vital synth: read a patch, edit settings / mod matrix / LFO shapes, build wavetables');
  },
};

export default extension;
