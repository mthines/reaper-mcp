/**
 * Suggested presets for a generated plugin, written in REAPER's own JSFX preset file so they show in
 * the plugin's preset dropdown (and `get_fx_preset_list` / `set_fx_preset`).
 *
 * The format, read from REAPER 7.40's own files and proven live (a file written by this module loads
 * through the dropdown and sets every slider to the raw value):
 *
 *   <resource>/presets/js-<effect path with "/", "\" and "." as "_">.ini
 *     (Effects/reaper-mcp-generated/examples/mutate-verb.jsfx → js-reaper-mcp-generated_examples_mutate-verb_jsfx.ini)
 *   [General]  NbPresets=<n>
 *   [Preset<k>] Data=<hex>  Len=<bytes>  Name=<name>
 *
 * Data is the hex of `v1 v2 … v64 "<name>"` (64 slider values, "%f", "-" for a slider the plugin does
 * not declare) followed by one checksum byte: the sum of those bytes & 255. Len is the byte count
 * without the checksum. A user's own presets live in the same file, so ours are merged in, never
 * written over theirs: a manifest of the presets we wrote says which ones we own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SliderSpec } from './inline.js';

export const MAX_PRESETS = 8;
export const MAX_PRESET_NAME = 32;
const JSFX_SLIDERS = 64;

export interface PresetInput {
  name: string;
  /** slider index ("3", "slider3") or label ("Mix") → value in the slider's own units */
  values: Record<string, number>;
}

export interface EncodedPreset {
  name: string;
  data: string;
  len: number;
}

/** REAPER's preset file name for an effect path relative to Effects/. */
export function presetFileName(effectPath: string): string {
  return `js-${effectPath.replace(/[/\\.]/g, '_')}.ini`;
}

function onStep(s: SliderSpec, v: number): boolean {
  if (!(s.step > 0)) return true;
  const k = (v - s.min) / s.step;
  return Math.abs(k - Math.round(k)) < 0.0001;
}

/**
 * Checks every preset against the plugin's sliders. Errors name the preset and the value; a slider a
 * preset leaves out takes its default, so a preset always sets the whole plugin.
 */
export function resolvePresets(presets: PresetInput[], sliders: SliderSpec[]): { values: Map<number, number>[]; errors: string[] } {
  const errors: string[] = [];
  const values: Map<number, number>[] = [];
  if (presets.length > MAX_PRESETS) errors.push(`${presets.length} presets: at most ${MAX_PRESETS}. Keep the few that teach the plugin.`);
  const names = new Set<string>();
  for (const p of presets) {
    const name = p.name.trim();
    if (!name || name.length > MAX_PRESET_NAME) errors.push(`Preset name "${p.name}": 1-${MAX_PRESET_NAME} characters.`);
    if (/["\r\n\t|]/.test(name)) errors.push(`Preset name "${p.name}": no quotes, tabs, line breaks or "|".`);
    if (names.has(name.toLowerCase())) errors.push(`Preset "${name}" is listed twice.`);
    names.add(name.toLowerCase());
    const set = new Map(sliders.filter((s) => !s.named).map((s) => [s.index, s.default]));
    for (const [key, v] of Object.entries(p.values)) {
      const m = key.trim().match(/^(?:slider)?(\d+)$/i);
      const s = m ? sliders.find((x) => x.index === Number(m[1])) : sliders.find((x) => x.name.toLowerCase() === key.trim().toLowerCase());
      if (!s) { errors.push(`Preset "${name}": no slider "${key}".`); continue; }
      const lo = Math.min(s.min, s.max), hi = Math.max(s.min, s.max);
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`Preset "${name}": ${s.name} = ${String(v)} is not a number.`);
      else if (v < lo || v > hi) errors.push(`Preset "${name}": ${s.name} = ${v} is outside ${s.min}..${s.max}.`);
      else if (!onStep(s, v)) errors.push(`Preset "${name}": ${s.name} = ${v} is not on its step of ${s.step}.`);
      else set.set(s.index, v);
    }
    values.push(set);
  }
  return { values, errors };
}

/** One preset's Data/Len, exactly as REAPER writes them. */
export function encodePreset(name: string, values: Map<number, number>): EncodedPreset {
  const fields: string[] = [];
  for (let i = 1; i <= JSFX_SLIDERS; i++) fields.push(values.has(i) ? (values.get(i) as number).toFixed(6) : '-');
  const bytes = Buffer.from(`${fields.join(' ')} "${name}"`, 'utf8');
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 255;
  return { name, data: bytes.toString('hex').toUpperCase() + sum.toString(16).toUpperCase().padStart(2, '0'), len: bytes.length };
}

/** The slider values of a preset's Data (index → value), for reading a file back. */
export function decodePresetValues(data: string): Map<number, number> {
  const text = Buffer.from(data.slice(0, -2), 'hex').toString('utf8');
  const fields = text.slice(0, text.indexOf('"')).trim().split(/\s+/);
  const out = new Map<number, number>();
  fields.forEach((f, i) => { if (f !== '-') out.set(i + 1, Number(f)); });
  return out;
}

/** Every preset in a REAPER preset file, in order (any line we do not know is dropped on rewrite). */
export function parsePresetFile(text: string): EncodedPreset[] {
  const out: EncodedPreset[] = [];
  let cur: Partial<EncodedPreset> | undefined;
  const flush = () => { if (cur?.name !== undefined && cur.data) out.push({ name: cur.name, data: cur.data, len: cur.len ?? 0 }); };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (/^\[Preset\d+\]$/i.test(line)) { flush(); cur = {}; continue; }
    if (/^\[/.test(line)) { flush(); cur = undefined; continue; }
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq), v = line.slice(eq + 1);
    if (k === 'Data') cur.data = v;
    else if (k === 'Len') cur.len = Number(v);
    else if (k === 'Name') cur.name = v;
  }
  flush();
  return out;
}

export function formatPresetFile(presets: EncodedPreset[]): string {
  const lines = ['[General]', `NbPresets=${presets.length}`, ''];
  presets.forEach((p, k) => lines.push(`[Preset${k}]`, `Data=${p.data}`, `Len=${p.len}`, `Name=${p.name}`, ''));
  return lines.join('\n');
}

export interface PresetMerge {
  text: string;
  /** our presets now in the file */
  written: string[];
  /** ours that the user changed in REAPER (same name, other values): their version is kept */
  keptUserEdits: string[];
}

/**
 * Our presets merged into REAPER's file. `owned` is what we wrote last time (name → Data): a preset
 * with that name and that Data is ours and is replaced or removed; any other preset is the user's.
 */
export function mergePresets(existing: string | undefined, ours: EncodedPreset[], owned: Record<string, string>): PresetMerge {
  const current = existing ? parsePresetFile(existing) : [];
  const keptUserEdits: string[] = [];
  const theirs = current.filter((p) => {
    if (!(p.name in owned)) return true;
    if (owned[p.name] === p.data) return false; // ours, unchanged: replaced below
    keptUserEdits.push(p.name);
    return true;
  });
  const taken = new Set(theirs.map((p) => p.name));
  const add = ours.filter((p) => !taken.has(p.name));
  return { text: formatPresetFile([...theirs, ...add]), written: add.map((p) => p.name), keptUserEdits };
}

/**
 * Writes our presets into REAPER's preset file for `effectPath` (relative to Effects/) in `presetsDir`,
 * keeping the user's own. `manifestPath` remembers which presets we wrote (name → Data), so the next
 * write replaces only those.
 */
export function writePresetFile(presetsDir: string, effectPath: string, encoded: EncodedPreset[], manifestPath: string): { file: string; written: string[]; keptUserEdits: string[] } {
  const file = join(presetsDir, presetFileName(effectPath));
  let owned: Record<string, string> = {};
  try { owned = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { owned?: Record<string, string> }).owned ?? {}; } catch { /* nothing written yet */ }
  const merged = mergePresets(existsSync(file) ? readFileSync(file, 'utf8') : undefined, encoded, owned);
  mkdirSync(presetsDir, { recursive: true });
  writeFileSync(file, merged.text);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const mine = Object.fromEntries(encoded.filter((p) => merged.written.includes(p.name)).map((p) => [p.name, p.data]));
  writeFileSync(manifestPath, JSON.stringify({ owned: mine }, null, 2));
  return { file, written: merged.written, keptUserEdits: merged.keptUserEdits };
}
