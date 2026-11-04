/**
 * The model catalog: every block model found in real presets, with one real block to clone from.
 * Model ids and parameter names are never invented; they come from presets Helix itself wrote.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isBlock, isFlowNode, parsePreset, getTone, DSPS, type HlxBlock, type Json, type Preset } from './hlx.js';

export interface ModelEntry {
  model: string;
  /** A real block of this model, to clone. */
  template: HlxBlock;
  /** For a cab block: the sibling entry its `@cab` key points at (the second half of a dual cab). */
  companion?: Json;
  seenIn: string[];
}

export type Catalog = Map<string, ModelEntry>;

export function buildCatalog(presets: { file: string; preset: Preset }[]): Catalog {
  const catalog: Catalog = new Map();
  for (const { file, preset } of presets) {
    let tone;
    try {
      tone = getTone(preset);
    } catch {
      continue;
    }
    for (const dsp of DSPS) {
      const path = (tone[dsp] ?? {}) as Json;
      for (const value of Object.values(path)) {
        if (!isBlock(value) || isFlowNode(value) || value['@position'] === undefined) continue;
        const entry = catalog.get(value['@model']);
        if (entry) {
          if (!entry.seenIn.includes(file)) entry.seenIn.push(file);
          continue;
        }
        const companionKey = value['@cab'];
        const companion = typeof companionKey === 'string' ? (path[companionKey] as Json | undefined) : undefined;
        catalog.set(value['@model'], {
          model: value['@model'],
          template: structuredClone(value),
          ...(companion && { companion: structuredClone(companion) }),
          seenIn: [file],
        });
      }
    }
  }
  return catalog;
}

const MAX_DEPTH = 3;

/** Read every `.hlx` under the given folders (a few levels deep). Unreadable or invalid files are skipped and listed. */
export async function scanLibrary(dirs: string[]): Promise<{ presets: { file: string; preset: Preset }[]; skipped: string[] }> {
  const presets: { file: string; preset: Preset }[] = [];
  const skipped: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && depth < MAX_DEPTH && !e.name.startsWith('.')) await walk(full, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.hlx')) {
        try {
          const parsed = parsePreset(await readFile(full, 'utf8'));
          if (parsed.ok) presets.push({ file: full, preset: parsed.preset });
          else skipped.push(`${full}: ${parsed.error}`);
        } catch (err) {
          skipped.push(`${full}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  for (const d of dirs) await walk(d, 0);
  return { presets, skipped };
}
