import type { VitalPatch } from './state.js';
import type { VitalWavetable } from './wavetable.js';

/**
 * Edits to a parsed Vital patch. Each function validates first and returns an error without touching
 * the patch; the caller discards the whole patch on any error, so a refused edit never reaches Vital.
 */

export const MOD_SLOTS = 64;
export const LFO_COUNT = 8;
export const OSC_COUNT = 3;
const MAX_LFO_POINTS = 100;

/** Modulation sources Vital knows, as it names them in a patch. */
export const MOD_SOURCES = [
  'aftertouch', 'env_1', 'env_2', 'env_3', 'env_4', 'env_5', 'env_6',
  'lfo_1', 'lfo_2', 'lfo_3', 'lfo_4', 'lfo_5', 'lfo_6', 'lfo_7', 'lfo_8',
  'lift', 'macro_control_1', 'macro_control_2', 'macro_control_3', 'macro_control_4',
  'mod_wheel', 'note', 'note_in_octave', 'pitch_wheel', 'random', 'random_1', 'random_2', 'random_3', 'random_4',
  'slide', 'stereo', 'velocity',
] as const;

export type Edit<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Set plain numeric settings by name (`osc_1_level`, `filter_1_cutoff`, …). Unknown names are refused: they are typos. */
export function applySettings(patch: VitalPatch, values: Record<string, number>): Edit<{ changed: Record<string, { from: number; to: number }> }> {
  const s = patch.settings;
  const unknown = Object.keys(values).filter((k) => !isNum(s[k]));
  if (unknown.length > 0) {
    const hint = unknown.map((k) => {
      const near = Object.keys(s).filter((o) => isNum(s[o]) && (o.includes(k) || k.includes(o))).slice(0, 3);
      return near.length ? `${k} (did you mean ${near.join(', ')}?)` : k;
    });
    return fail(`Unknown setting${unknown.length > 1 ? 's' : ''}: ${hint.join('; ')}. Names are Vital's own, see vital_read_patch with settingsMatching.`);
  }
  const bad = Object.entries(values).filter(([, v]) => !isNum(v)).map(([k]) => k);
  if (bad.length > 0) return fail(`Settings must be finite numbers: ${bad.join(', ')}`);
  const changed: Record<string, { from: number; to: number }> = {};
  for (const [k, to] of Object.entries(values)) {
    const from = s[k] as number;
    s[k] = to;
    if (from !== to) changed[k] = { from, to };
  }
  return { ok: true, changed };
}

export interface ModulationEdit {
  source: string;
  destination: string;
  amount?: number;
  bipolar?: boolean;
  stereo?: boolean;
  bypass?: boolean;
  power?: number;
  remove?: boolean;
}

const MOD_FIELDS = ['amount', 'bipolar', 'bypass', 'power', 'stereo'] as const;

/** Add, update or remove one route in the mod matrix. A route is identified by its source and destination. */
export function applyModulation(patch: VitalPatch, edit: ModulationEdit): Edit<{ slot: number; action: 'added' | 'updated' | 'removed' }> {
  const s = patch.settings;
  if (!(MOD_SOURCES as readonly string[]).includes(edit.source)) {
    return fail(`Unknown modulation source "${edit.source}". Sources: ${MOD_SOURCES.join(', ')}`);
  }
  if (!isNum(s[edit.destination]) || edit.destination.startsWith('modulation_')) {
    return fail(`Unknown modulation destination "${edit.destination}"; it must be a setting name such as osc_1_level or filter_1_cutoff`);
  }
  const slots = s.modulations;
  const existing = slots.findIndex((m) => m.source === edit.source && m.destination === edit.destination);

  if (edit.remove) {
    if (existing < 0) return fail(`No route from ${edit.source} to ${edit.destination} to remove`);
    slots[existing] = { source: '', destination: '' };
    for (const f of MOD_FIELDS) s[`modulation_${existing + 1}_${f}`] = 0;
    return { ok: true, slot: existing + 1, action: 'removed' };
  }

  const index = existing >= 0 ? existing : slots.findIndex((m) => !m.source && !m.destination);
  if (index < 0) return fail(`All ${MOD_SLOTS} modulation slots are in use`);
  const n = index + 1;
  if (existing < 0) {
    slots[index] = { source: edit.source, destination: edit.destination };
    for (const f of MOD_FIELDS) s[`modulation_${n}_${f}`] = 0;
  }
  if (edit.amount !== undefined) {
    if (!isNum(edit.amount) || edit.amount < -1 || edit.amount > 1) return fail('A modulation amount is a number from -1 to 1');
    s[`modulation_${n}_amount`] = edit.amount;
  } else if (existing < 0) {
    s[`modulation_${n}_amount`] = 1;
  }
  if (edit.power !== undefined) {
    if (!isNum(edit.power)) return fail('A modulation power is a number');
    s[`modulation_${n}_power`] = edit.power;
  }
  for (const f of ['bipolar', 'stereo', 'bypass'] as const) {
    if (edit[f] !== undefined) s[`modulation_${n}_${f}`] = edit[f] ? 1 : 0;
  }
  return { ok: true, slot: n, action: existing >= 0 ? 'updated' : 'added' };
}

export interface LfoEdit {
  /** 1-8 */
  index: number;
  name?: string;
  /** [x, y] pairs: x from 0 to 1 (not going backwards), y from 0 to 1 */
  points: [number, number][];
  /** Curve of the segment after each point (-20..20 is Vital's range, 0 is straight); defaults to straight */
  powers?: number[];
  smooth?: boolean;
}

export function applyLfo(patch: VitalPatch, edit: LfoEdit): Edit {
  if (!Number.isInteger(edit.index) || edit.index < 1 || edit.index > LFO_COUNT) return fail(`LFO index must be 1 to ${LFO_COUNT}`);
  const pts = edit.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_LFO_POINTS) return fail(`An LFO shape needs 2 to ${MAX_LFO_POINTS} points`);
  for (const [i, p] of pts.entries()) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return fail(`Point ${i} must be [x, y]`);
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return fail(`Point ${i} is outside 0..1`);
    if (i > 0 && p[0] < pts[i - 1][0]) return fail(`Point ${i} goes backwards in x`);
  }
  const powers = edit.powers ?? pts.map(() => 0);
  if (powers.length !== pts.length || !powers.every(isNum)) return fail('powers needs one number per point');
  const lfo = patch.settings.lfos[edit.index - 1];
  if (!lfo) return fail(`This patch has no LFO ${edit.index}`);
  lfo.points = pts.flat();
  lfo.powers = powers;
  lfo.num_points = pts.length;
  if (edit.name !== undefined) lfo.name = edit.name;
  if (edit.smooth !== undefined) lfo.smooth = edit.smooth;
  return { ok: true };
}

/** Put a wavetable on oscillator 1-3. */
export function applyWavetable(patch: VitalPatch, oscillator: number, wavetable: VitalWavetable): Edit {
  if (!Number.isInteger(oscillator) || oscillator < 1 || oscillator > OSC_COUNT) return fail(`Oscillator must be 1 to ${OSC_COUNT}`);
  if (patch.settings.wavetables.length < oscillator) return fail(`This patch has no wavetable slot for oscillator ${oscillator}`);
  patch.settings.wavetables[oscillator - 1] = wavetable;
  return { ok: true };
}

interface WavetableLike {
  name?: string;
  groups?: { components?: { type?: string; keyframes?: unknown[] }[] }[];
}

export function summarize(patch: VitalPatch) {
  const s = patch.settings;
  const num = (k: string) => (isNum(s[k]) ? (s[k] as number) : undefined);
  const wavetable = (w: unknown) => {
    const wt = (w ?? {}) as WavetableLike;
    const comps = (wt.groups ?? []).flatMap((g) => g.components ?? []);
    return { name: wt.name ?? '', sources: comps.map((c) => c.type ?? '?'), keyframes: comps.reduce((n, c) => n + (c.keyframes?.length ?? 0), 0) };
  };
  return {
    presetName: patch.preset_name ?? '',
    author: patch.author ?? '',
    style: patch.preset_style ?? '',
    macros: [patch.macro1, patch.macro2, patch.macro3, patch.macro4],
    settingCount: Object.values(s).filter(isNum).length,
    oscillators: Array.from({ length: OSC_COUNT }, (_, i) => ({
      oscillator: i + 1,
      on: num(`osc_${i + 1}_on`) === 1,
      level: num(`osc_${i + 1}_level`),
      transpose: num(`osc_${i + 1}_transpose`),
      unisonVoices: num(`osc_${i + 1}_unison_voices`),
      wavetable: wavetable(s.wavetables[i]),
    })),
    sample: { on: num('sample_on') === 1, level: num('sample_level') },
    filters: [1, 2].map((i) => ({ filter: i, on: num(`filter_${i}_on`) === 1, cutoff: num(`filter_${i}_cutoff`), resonance: num(`filter_${i}_resonance`) })),
    effectsOn: Object.keys(s).filter((k) => /^(chorus|compressor|delay|distortion|eq|flanger|phaser|reverb)_on$/.test(k) && s[k] === 1).map((k) => k.replace(/_on$/, '')),
    lfos: s.lfos.map((l, i) => ({ lfo: i + 1, name: l.name, points: l.num_points, smooth: l.smooth })),
    modulations: s.modulations.flatMap((m, i) =>
      m.source || m.destination
        ? [{
            slot: i + 1,
            source: m.source,
            destination: m.destination,
            amount: num(`modulation_${i + 1}_amount`),
            bipolar: num(`modulation_${i + 1}_bipolar`) === 1,
            stereo: num(`modulation_${i + 1}_stereo`) === 1,
            bypass: num(`modulation_${i + 1}_bypass`) === 1,
            power: num(`modulation_${i + 1}_power`),
          }]
        : [],
    ),
  };
}
