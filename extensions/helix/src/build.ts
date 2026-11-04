/**
 * Building and editing presets. Everything is validated before anything is returned: a refused spec yields an
 * error and no preset. The result always satisfies the load-time invariants (base @enabled and base parameter
 * values equal the boot snapshot's), so a preset made here loads in the state its first snapshot describes.
 */
import {
  DSPS,
  MAX_BLOCKS_PER_PATH,
  SNAPSHOTS_CONTROLLER,
  bootIndex,
  chain,
  getTone,
  isBlock,
  isFlowNode,
  snapshotOf,
  validatePreset,
  type DspName,
  type Finding,
  type HlxBlock,
  type Json,
  type Preset,
  type Snapshot,
  type Tone,
} from './hlx.js';
import type { Catalog } from './catalog.js';

export type Result<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

export type ParamValue = number | boolean;

export interface BlockSpec {
  /** Your handle for the block, used by snapshots. Unique across both paths. */
  id: string;
  /** A model id that exists in the catalog (see helix_list_models). */
  model: string;
  /** Parameter values by Helix's own names; every name must exist on the model. */
  params?: Record<string, ParamValue>;
  /** Default true. */
  enabled?: boolean;
}

export interface SnapshotSpec {
  name: string;
  ledcolor?: number;
  tempo?: number;
  /** Block ids that are on in this snapshot. Default: every block that is enabled by default. */
  on?: string[];
  /** blockId -> parameter -> value for this snapshot; the parameter becomes snapshot-controlled. */
  params?: Record<string, Record<string, number>>;
}

export interface CreateSpec {
  name: string;
  tempo?: number;
  /** Snapshot that is active on load, 0-7 (default 0). */
  boot?: number;
  inputGate?: { enabled?: boolean; threshold?: number; decay?: number };
  path1: BlockSpec[];
  /** Blocks on the second path; the first path then feeds it. */
  path2?: BlockSpec[];
  /** Up to 8, in snapshot order. */
  snapshots: SnapshotSpec[];
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

interface Placed {
  dsp: DspName;
  key: string;
  spec: BlockSpec;
}

function blockKeyParts(ref: string): { dsp: DspName; key: string } | undefined {
  const m = /^(dsp[01])\/(\S+)$/.exec(ref);
  return m ? { dsp: m[1] as DspName, key: m[2] } : undefined;
}

/** Same JSON type as the value the model's real block holds, so a number never lands in a boolean slot. */
function checkParam(tpl: HlxBlock, model: string, param: string, value: ParamValue): string | undefined {
  if (param.startsWith('@')) return `"${param}" is not a parameter`;
  if (!(param in tpl)) {
    const known = Object.keys(tpl).filter((k) => !k.startsWith('@'));
    return `${model} has no parameter "${param}" (it has: ${known.join(', ')})`;
  }
  if (typeof tpl[param] !== typeof value) return `${model}.${param} is a ${typeof tpl[param]}, got ${typeof value}`;
  if (typeof value === 'number' && !Number.isFinite(value)) return `${model}.${param} must be a finite number`;
  return undefined;
}

function declaredRange(values: number[]): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min >= 0 && max <= 1 ? { min: 0, max: 1 } : { min, max };
}

export function createPreset(donor: Preset, spec: CreateSpec, catalog: Catalog): Result<Preset> {
  try {
    return buildPreset(donor, spec, catalog);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function buildPreset(donor: Preset, spec: CreateSpec, catalog: Catalog): Result<Preset> {
  const preset = structuredClone(donor);
  let tone: Tone;
  try {
    tone = getTone(preset);
  } catch (e) {
    return fail(`donor: ${e instanceof Error ? e.message : String(e)}`);
  }
  const warnings: string[] = [];
  if (spec.snapshots.length < 1 || spec.snapshots.length > 8) return fail('snapshots: give between 1 and 8');
  const boot = spec.boot ?? 0;
  if (!Number.isInteger(boot) || boot < 0 || boot >= spec.snapshots.length) return fail(`boot must be the index of one of your ${spec.snapshots.length} snapshots`);

  // 1. Strip the donor's processing blocks (and dual-cab companions), keep routing nodes and everything else.
  const paths: Record<DspName, BlockSpec[]> = { dsp0: spec.path1, dsp1: spec.path2 ?? [] };
  for (const dsp of DSPS) {
    const path = (tone[dsp] ??= {}) as Json;
    for (const [k, v] of Object.entries(path)) if (isBlock(v) && !isFlowNode(v)) delete path[k];
  }

  // 2. Place the new blocks from real templates.
  const placed = new Map<string, Placed>();
  for (const dsp of DSPS) {
    const specs = paths[dsp];
    if (specs.length > MAX_BLOCKS_PER_PATH) return fail(`${dsp === 'dsp0' ? 'path1' : 'path2'} has ${specs.length} blocks; at most ${MAX_BLOCKS_PER_PATH} fit a path`);
    const path = tone[dsp] as Json;
    specs.forEach((b, i) => {
      if (placed.has(b.id)) throw new Error(`duplicate block id "${b.id}"`);
      const entry = catalog.get(b.model);
      if (!entry) throw new Error(`unknown model "${b.model}" for block "${b.id}": use a model from helix_list_models`);
      const block = structuredClone(entry.template);
      for (const [p, v] of Object.entries(b.params ?? {})) {
        const problem = checkParam(entry.template, b.model, p, v);
        if (problem) throw new Error(`block "${b.id}": ${problem}`);
        block[p] = v;
      }
      block['@position'] = i + 1;
      block['@path'] = 0;
      const key = `block${i}`;
      if (typeof block['@cab'] === 'string') {
        if (!entry.companion) throw new Error(`block "${b.id}": the catalog has no second cab entry for ${b.model}`);
        const cabKey = `cab${i}`;
        path[cabKey] = structuredClone(entry.companion);
        block['@cab'] = cabKey;
      }
      path[key] = block;
      placed.set(b.id, { dsp, key, spec: b });
    });
  }

  // 3. Routing: path 1 feeds path 2 when there is one, else goes to the main output.
  const out0 = (tone.dsp0 as Json)['outputA'] as Json | undefined;
  const in1 = (tone.dsp1 as Json)['inputA'] as Json | undefined;
  if (paths.dsp1.length > 0) {
    if (!out0 || !in1) return fail('the donor has no path routing nodes to connect path 1 to path 2; pick a two-path donor');
    out0['@output'] = 2;
    in1['@input'] = 0;
  } else if (out0) out0['@output'] = 1;

  // 4. Input gate on path 1.
  if (spec.inputGate) {
    const gate = (tone.dsp0 as Json)['inputA'] as Json | undefined;
    if (!gate) return fail('the donor has no input node to hold the gate');
    if (spec.inputGate.enabled !== undefined) gate['noiseGate'] = spec.inputGate.enabled;
    if (spec.inputGate.threshold !== undefined) gate['threshold'] = spec.inputGate.threshold;
    if (spec.inputGate.decay !== undefined) gate['decay'] = spec.inputGate.decay;
  }

  // 5. Snapshots: bypass maps, controlled values, declarations.
  const base = (id: string, param: string): number => (placed.get(id)?.spec.params?.[param] ?? (catalog.get(placed.get(id)?.spec.model ?? '')?.template[param])) as number;
  const controlled = new Map<string, Set<string>>();
  for (const [i, s] of spec.snapshots.entries()) {
    for (const [id, params] of Object.entries(s.params ?? {})) {
      const p = placed.get(id);
      if (!p) return fail(`snapshot "${s.name}": unknown block id "${id}"`);
      for (const [param, v] of Object.entries(params)) {
        const problem = checkParam(catalog.get(p.spec.model)!.template, p.spec.model, param, v);
        if (problem) return fail(`snapshot "${s.name}": ${problem}`);
        if (typeof v !== 'number') return fail(`snapshot "${s.name}": ${id}.${param} must be a number to be snapshot-controlled`);
        if (!controlled.has(id)) controlled.set(id, new Set());
        controlled.get(id)!.add(param);
      }
    }
    for (const id of s.on ?? []) if (!placed.has(id)) return fail(`snapshot "${s.name}": unknown block id "${id}" in on`);
    if (i > 7) return fail('at most 8 snapshots');
  }
  // A parameter whose value is the same in every snapshot is not controlled; it is just a base value.
  const valueIn = (s: SnapshotSpec, id: string, param: string): number => s.params?.[id]?.[param] ?? base(id, param);
  for (const [id, params] of [...controlled]) {
    for (const param of [...params]) {
      if (new Set(spec.snapshots.map((s) => valueIn(s, id, param))).size < 2) {
        params.delete(param);
        const p = placed.get(id)!;
        ((tone[p.dsp] as Json)[p.key] as HlxBlock)[param] = valueIn(spec.snapshots[0], id, param);
      }
    }
    if (params.size === 0) controlled.delete(id);
  }

  const controller: Tone['controller'] = { dsp0: {}, dsp1: {} };
  for (const [id, params] of controlled) {
    const p = placed.get(id)!;
    for (const param of params) {
      const range = declaredRange(spec.snapshots.map((s) => valueIn(s, id, param)));
      ((controller![p.dsp] ??= {})[p.key] ??= {})[param] = { '@min': range.min, '@max': range.max, '@controller': SNAPSHOTS_CONTROLLER, '@snapshot_disable': false };
    }
  }
  tone.controller = controller;
  tone['footswitch'] = { dsp0: {}, dsp1: {} };

  const defaultOn = [...placed].filter(([, p]) => p.spec.enabled !== false).map(([id]) => id);
  const fallback = snapshotOf(tone, 0) ?? {};
  for (let i = 0; i < 8; i++) {
    const s = spec.snapshots[i];
    const old = (snapshotOf(tone, i) ?? fallback) as Snapshot;
    const snap: Snapshot = { ...structuredClone(old), '@name': s?.name ?? `Snapshot ${i + 1}`, '@valid': s !== undefined };
    if (s?.ledcolor !== undefined) snap['@ledcolor'] = s.ledcolor;
    if (s?.tempo !== undefined) snap['@tempo'] = s.tempo;
    else if (spec.tempo !== undefined) snap['@tempo'] = spec.tempo;
    const on = new Set(s?.on ?? defaultOn);
    snap.blocks = { dsp0: {}, dsp1: {} };
    for (const [id, p] of placed) snap.blocks[p.dsp][p.key] = on.has(id);
    snap.controllers = { dsp0: {}, dsp1: {} };
    for (const [id, params] of controlled) {
      const p = placed.get(id)!;
      for (const param of params) {
        ((snap.controllers[p.dsp] ??= {})[p.key] ??= {})[param] = { '@fs_enabled': false, '@value': s ? valueIn(s, id, param) : valueIn(spec.snapshots[0], id, param) };
      }
    }
    tone[`snapshot${i}`] = snap;
  }

  // 6. The load-time state is the boot snapshot's.
  tone.global = { ...(tone.global ?? {}), '@current_snapshot': boot, ...(spec.tempo !== undefined && { '@tempo': spec.tempo }) };
  syncBoot(tone);
  const meta = (preset.data!.meta ??= {});
  meta.name = spec.name;
  meta['modifieddate'] = Math.floor(Date.now() / 1000);

  return finish(preset, warnings, [], spec.name);
}

/** Make every block's base @enabled and every controlled parameter's base value equal the boot snapshot's. */
export function syncBoot(tone: Tone): void {
  const snap = snapshotOf(tone, bootIndex(tone));
  if (!snap) return;
  for (const dsp of DSPS) {
    for (const [id, on] of Object.entries(snap.blocks?.[dsp] ?? {})) {
      const b = (tone[dsp] as Json | undefined)?.[id];
      if (isBlock(b)) b['@enabled'] = on;
    }
  }
  for (const [dsp, blocks] of Object.entries(snap.controllers ?? {})) {
    for (const [id, params] of Object.entries(blocks)) {
      const b = (tone[dsp] as Json | undefined)?.[id];
      if (isBlock(b)) for (const [p, v] of Object.entries(params)) b[p] = v['@value'];
    }
  }
}

function finish(preset: Preset, warnings: string[], before: Finding[], label: string): Result<Preset> {
  const findings = validatePreset(preset);
  const known = new Set(before.map((f) => f.message));
  const errors = findings.filter((f) => f.level === 'error' && !known.has(f.message));
  if (errors.length) return fail(`"${label}" would not load cleanly: ${errors.map((e) => e.message).join('; ')}`);
  for (const f of findings) if (f.level === 'warn') warnings.push(f.message);
  return { ok: true, value: preset, warnings };
}

// ---------------------------------------------------------------- editing

export interface EditSpec {
  name?: string;
  tempo?: number;
  /** Snapshot that is active on load. */
  boot?: number;
  /** Change blocks. `ref` is `dsp0/block1` or a model-name fragment that matches exactly one block. */
  blocks?: { ref: string; params?: Record<string, ParamValue>; enabled?: boolean }[];
  snapshots?: {
    index: number;
    name?: string;
    ledcolor?: number;
    /** Refs switched on / off in this snapshot. */
    on?: string[];
    off?: string[];
    /** ref -> parameter -> value; declares the parameter snapshot-controlled when it is not yet. */
    params?: Record<string, Record<string, number>>;
  }[];
}

export function resolveRef(tone: Tone, ref: string): { dsp: DspName; key: string; block: HlxBlock } | string {
  const exact = blockKeyParts(ref);
  if (exact) {
    const b = (tone[exact.dsp] as Json | undefined)?.[exact.key];
    return isBlock(b) && !isFlowNode(b) ? { ...exact, block: b } : `no block ${ref}`;
  }
  const hits: { dsp: DspName; key: string; block: HlxBlock }[] = [];
  for (const dsp of DSPS) {
    for (const [key, block] of chain(tone[dsp] as Json | undefined)) if (block['@model'].toLowerCase().includes(ref.toLowerCase())) hits.push({ dsp, key, block });
  }
  if (hits.length === 1) return hits[0];
  return hits.length === 0 ? `no block matches "${ref}"` : `"${ref}" matches ${hits.length} blocks (${hits.map((h) => `${h.dsp}/${h.key}`).join(', ')}); use one of those refs`;
}

export function editPreset(source: Preset, edit: EditSpec): Result<Preset> {
  const preset = structuredClone(source);
  let tone: Tone;
  try {
    tone = getTone(preset);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const before = validatePreset(source);
  const bootSnap = (): Snapshot => snapshotOf(tone, bootIndex(tone)) as Snapshot;

  if (edit.boot !== undefined) {
    if (!snapshotOf(tone, edit.boot)) return fail(`snapshot ${edit.boot} does not exist`);
    tone.global = { ...(tone.global ?? {}), '@current_snapshot': edit.boot };
  }
  if (edit.tempo !== undefined) tone.global = { ...(tone.global ?? {}), '@tempo': edit.tempo };

  const declare = (dsp: DspName, key: string, param: string, value: number, block: HlxBlock): void => {
    const decl = ((tone.controller ??= {})[dsp] ??= {})[key] ??= {};
    const cur = decl[param] as Json | undefined;
    if (!cur) {
      const baseV = block[param] as number;
      const r = declaredRange([baseV, value]);
      decl[param] = { '@min': r.min, '@max': r.max, '@controller': SNAPSHOTS_CONTROLLER, '@snapshot_disable': false };
      for (let i = 0; i < 8; i++) {
        const s = snapshotOf(tone, i);
        if (s) (((s.controllers ??= {})[dsp] ??= {})[key] ??= {})[param] = { '@fs_enabled': false, '@value': baseV };
      }
    } else {
      cur['@min'] = Math.min(cur['@min'] as number, value);
      cur['@max'] = Math.max(cur['@max'] as number, value);
    }
  };

  for (const b of edit.blocks ?? []) {
    const r = resolveRef(tone, b.ref);
    if (typeof r === 'string') return fail(r);
    for (const [p, v] of Object.entries(b.params ?? {})) {
      const problem = checkParam(r.block, r.block['@model'], p, v);
      if (problem) return fail(problem);
      r.block[p] = v;
      // A snapshot-controlled parameter loads at the boot snapshot's value, so that is what this edit means.
      const ctrl = bootSnap()?.controllers?.[r.dsp]?.[r.key]?.[p];
      if (ctrl && typeof v === 'number') {
        ctrl['@value'] = v;
        declare(r.dsp, r.key, p, v, r.block);
      }
    }
    if (b.enabled !== undefined) {
      const bs = bootSnap();
      if (bs) ((bs.blocks ??= {})[r.dsp] ??= {})[r.key] = b.enabled;
      r.block['@enabled'] = b.enabled;
    }
  }

  for (const s of edit.snapshots ?? []) {
    const snap = snapshotOf(tone, s.index);
    if (!snap) return fail(`snapshot ${s.index} does not exist`);
    if (s.name !== undefined) snap['@name'] = s.name;
    if (s.ledcolor !== undefined) snap['@ledcolor'] = s.ledcolor;
    for (const [refs, value] of [[s.on, true], [s.off, false]] as const) {
      for (const ref of refs ?? []) {
        const r = resolveRef(tone, ref);
        if (typeof r === 'string') return fail(r);
        ((snap.blocks ??= {})[r.dsp] ??= {})[r.key] = value;
      }
    }
    for (const [ref, params] of Object.entries(s.params ?? {})) {
      const r = resolveRef(tone, ref);
      if (typeof r === 'string') return fail(r);
      for (const [p, v] of Object.entries(params)) {
        const problem = checkParam(r.block, r.block['@model'], p, v);
        if (problem) return fail(problem);
        if (typeof v !== 'number') return fail(`${ref}.${p} must be a number to be snapshot-controlled`);
        declare(r.dsp, r.key, p, v, r.block);
        (((snap.controllers ??= {})[r.dsp] ??= {})[r.key] ??= {})[p] = { '@fs_enabled': false, '@value': v };
      }
    }
  }

  if (edit.name !== undefined) (preset.data!.meta ??= {}).name = edit.name;
  (preset.data!.meta ??= {})['modifieddate'] = Math.floor(Date.now() / 1000);
  syncBoot(tone);
  return finish(preset, [], before, preset.data?.meta?.name ?? 'preset');
}
