/**
 * The Line 6 `.hlx` preset JSON: types, reading helpers, validation and a summary. Pure functions, no I/O.
 * Ported from the helix-preset skill's `hlx` CLI; the format notes are in knowledge/preset-format.md.
 */

export type Json = Record<string, unknown>;

export interface HlxBlock extends Json {
  '@model': string;
  '@position'?: number;
  '@enabled'?: boolean;
  '@type'?: number;
  '@path'?: number;
}

export interface Preset extends Json {
  schema?: string;
  version?: number;
  data?: { meta?: Json & { name?: string }; device?: number; device_version?: number; tone?: Tone } & Json;
}

export interface Tone extends Json {
  dsp0?: Json;
  dsp1?: Json;
  global?: Json & { '@current_snapshot'?: number; '@tempo'?: number };
  controller?: Record<string, Record<string, Record<string, Json>>>;
}

export interface Finding {
  level: 'error' | 'warn';
  message: string;
}

export const DSPS = ['dsp0', 'dsp1'] as const;
export type DspName = (typeof DSPS)[number];

/** The Snapshots controller id written by current Helix Native; older presets use 19. */
export const SNAPSHOTS_CONTROLLER = 9;
export const LEGACY_SNAPSHOTS_CONTROLLER = 19;
/** Positions a path's processing blocks may take (split sits at 0, join at 8). */
export const MAX_BLOCKS_PER_PATH = 7;

export function parsePreset(text: string): { ok: true; preset: Preset } | { ok: false; error: string } {
  try {
    const preset = JSON.parse(text) as Preset;
    if (typeof preset !== 'object' || preset === null) return { ok: false, error: 'not a JSON object' };
    return { ok: true, preset };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function getTone(preset: Preset): Tone {
  const tone = preset.data?.tone;
  if (!tone) throw new Error('preset has no data.tone');
  return tone;
}

export function isBlock(v: unknown): v is HlxBlock {
  return typeof v === 'object' && v !== null && typeof (v as Json)['@model'] === 'string';
}

/** A routing node (split, join, input, output) rather than a processing block. */
export function isFlowNode(b: HlxBlock): boolean {
  return b['@model'].includes('Flow');
}

/** Processing blocks of one path in chain order (by @position, not by key). Companion `cab0` entries are skipped. */
export function chain(dsp: Json | undefined): [string, HlxBlock][] {
  const out: [string, HlxBlock][] = [];
  for (const [key, value] of Object.entries(dsp ?? {})) {
    if (isBlock(value) && !isFlowNode(value) && value['@position'] !== undefined) out.push([key, value]);
  }
  return out.sort((a, b) => (a[1]['@position'] ?? 99) - (b[1]['@position'] ?? 99));
}

export const bootIndex = (tone: Tone): number => tone.global?.['@current_snapshot'] ?? 0;

export interface Snapshot extends Json {
  '@name'?: string;
  '@valid'?: boolean;
  '@ledcolor'?: number;
  blocks?: Record<string, Record<string, boolean>>;
  controllers?: Record<string, Record<string, Record<string, { '@value': unknown; '@fs_enabled'?: boolean }>>>;
}

export const snapshotOf = (tone: Tone, i: number): Snapshot | undefined => tone[`snapshot${i}`] as Snapshot | undefined;

export function snapshotIndices(tone: Tone): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) if (tone[`snapshot${i}`]) out.push(i);
  return out;
}

const MODEL_PREFIXES = ['HD2_', 'DM4', 'DL4', 'FM4', 'L6SPB_', 'VIC_'];

/** `HD2_AmpLine6Badonk` -> `Amp Line6 Badonk`. */
export function prettyModel(model: string): string {
  let s = model;
  for (const p of MODEL_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  return s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim() || model;
}

export function validatePreset(preset: Preset): Finding[] {
  const f: Finding[] = [];
  const err = (message: string) => f.push({ level: 'error', message });
  const warn = (message: string) => f.push({ level: 'warn', message });

  if (preset.schema !== 'L6Preset') err(`schema is "${String(preset.schema)}", expected "L6Preset"`);
  if (preset.version !== 6) err(`version is ${String(preset.version)}, expected 6`);

  let tone: Tone;
  try {
    tone = getTone(preset);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return f;
  }

  const boot = bootIndex(tone);
  const bootSnap = snapshotOf(tone, boot);
  if (!bootSnap) err(`boot snapshot (@current_snapshot=${boot}) does not exist`);
  else checkBoot(tone, boot, bootSnap, err);

  checkSnapshots(tone, err, warn);
  checkBudget(tone, err, warn);
  return f;
}

/** On load Helix reads each block's base @enabled and each controlled parameter's base value, not the snapshot's. */
function checkBoot(tone: Tone, boot: number, bootSnap: Snapshot, err: (m: string) => void): void {
  const label = bootSnap['@name'] ?? `snapshot${boot}`;
  for (const dsp of DSPS) {
    for (const [id, on] of Object.entries(bootSnap.blocks?.[dsp] ?? {})) {
      const block = (tone[dsp] as Json | undefined)?.[id];
      if (!isBlock(block)) err(`boot snapshot references missing block ${dsp}/${id}`);
      else if (block['@enabled'] !== on) {
        err(`base @enabled mismatch on ${dsp}/${id}: base=${String(block['@enabled'])} but boot snapshot "${label}" wants ${String(on)}. Block will load in the wrong bypass state.`);
      }
    }
  }
  for (const [dsp, blocks] of Object.entries(tone.controller ?? {})) {
    for (const [id, params] of Object.entries(blocks)) {
      for (const [param, decl] of Object.entries(params)) {
        if (!isSnapshotController(decl['@controller'])) continue;
        const block = (tone[dsp] as Json | undefined)?.[id];
        const want = bootSnap.controllers?.[dsp]?.[id]?.[param]?.['@value'];
        if (isBlock(block) && want !== undefined && block[param] !== want) {
          err(`base value mismatch on ${dsp}/${id}/${param}: base=${String(block[param])} but boot snapshot "${label}" @value=${String(want)}. Parameter will load at the wrong value.`);
        }
      }
    }
  }
}

const isSnapshotController = (c: unknown): boolean => c === SNAPSHOTS_CONTROLLER || c === LEGACY_SNAPSHOTS_CONTROLLER;

function checkSnapshots(tone: Tone, err: (m: string) => void, warn: (m: string) => void): void {
  const declared = new Set<string>();
  const declaredSnap = new Set<string>();
  for (const [dsp, blocks] of Object.entries(tone.controller ?? {})) {
    for (const [id, params] of Object.entries(blocks)) {
      for (const [param, decl] of Object.entries(params)) {
        declared.add(`${dsp}/${id}/${param}`);
        if (isSnapshotController(decl['@controller'])) declaredSnap.add(`${dsp}/${id}/${param}`);
        if (decl['@controller'] === LEGACY_SNAPSHOTS_CONTROLLER) {
          warn(`${dsp}/${id}/${param} uses the older Snapshots controller id 19; current Helix Native writes 9`);
        }
      }
    }
  }
  for (const i of snapshotIndices(tone)) {
    const snap = snapshotOf(tone, i);
    if (!snap || snap['@valid'] === false) continue;
    const label = snap['@name'] ?? `snapshot${i}`;
    for (const dsp of DSPS) {
      for (const id of Object.keys(snap.blocks?.[dsp] ?? {})) {
        if (!isBlock((tone[dsp] as Json | undefined)?.[id])) err(`snapshot "${label}" references missing block ${dsp}/${id}`);
      }
    }
    const present = new Set<string>();
    for (const [dsp, blocks] of Object.entries(snap.controllers ?? {})) {
      for (const [id, params] of Object.entries(blocks)) for (const p of Object.keys(params)) present.add(`${dsp}/${id}/${p}`);
    }
    for (const key of declaredSnap) if (!present.has(key)) err(`snapshot "${label}" missing controller value for ${key}`);
    for (const key of present) if (!declared.has(key)) err(`snapshot "${label}" sets ${key} but it is not declared in tone.controller`);
  }
}

function checkBudget(tone: Tone, err: (m: string) => void, warn: (m: string) => void): void {
  for (const dsp of DSPS) {
    const blocks = chain(tone[dsp] as Json | undefined).map(([, b]) => b);
    const hasAmp = blocks.some((b) => b['@type'] === 1);
    if (blocks.length > 8) err(`${dsp} has ${blocks.length} processing blocks (more than 8 will not load)`);
    else if (hasAmp && blocks.length >= 7) {
      warn(`${dsp} has ${blocks.length} processing blocks including an amp: at the verified DSP ceiling (7 loads, 8 fails). Move post-FX to the other path.`);
    }
  }
}

/** A compact, agent-sized description of a preset. */
export function summarize(preset: Preset): Json {
  const tone = getTone(preset);
  const boot = bootIndex(tone);
  const bootSnap = snapshotOf(tone, boot);
  const path = (dsp: DspName) =>
    chain(tone[dsp] as Json | undefined).map(([id, b]) => ({
      id: `${dsp}/${id}`,
      model: b['@model'],
      name: prettyModel(b['@model']),
      enabledAtBoot: bootSnap?.blocks?.[dsp]?.[id] ?? b['@enabled'],
    }));
  const flow = (dsp: DspName, key: string, attr: string) => ((tone[dsp] as Json | undefined)?.[key] as Json | undefined)?.[attr];
  return {
    name: preset.data?.meta?.name,
    tempo: tone.global?.['@tempo'],
    bootSnapshot: { index: boot, name: bootSnap?.['@name'] },
    path1: path('dsp0'),
    path2: path('dsp1'),
    routing: { path1Output: flow('dsp0', 'outputA', '@output'), path2Input: flow('dsp1', 'inputA', '@input') },
    snapshots: snapshotIndices(tone).map((i) => {
      const s = snapshotOf(tone, i) as Snapshot;
      const on: string[] = [];
      for (const dsp of DSPS) for (const [id, v] of Object.entries(s.blocks?.[dsp] ?? {})) if (v) on.push(`${dsp}/${id}`);
      const controlled: Record<string, unknown> = {};
      for (const [dsp, blocks] of Object.entries(s.controllers ?? {})) {
        for (const [id, params] of Object.entries(blocks)) for (const [p, v] of Object.entries(params)) controlled[`${dsp}/${id}.${p}`] = v['@value'];
      }
      return { index: i, name: s['@name'], valid: s['@valid'] !== false, on, controlled };
    }),
  };
}
