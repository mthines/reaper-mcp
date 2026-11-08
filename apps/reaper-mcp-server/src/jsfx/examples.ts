/**
 * Installs the shipped example plugins (.claude/skills/make-plugin/examples/) as ready-to-use plugins in
 * `Effects/reaper-mcp-generated/examples/`, toolkit inlined, so they work without the skill. A copy the
 * user edited is never overwritten: each file's hash is kept in a manifest, and a file whose hash no longer
 * matches it is left alone (the same promise `install-skills` makes).
 *
 * An example's suggested presets (`<name>.presets.json` beside it) go into REAPER's preset file for it,
 * merged with presets the user saved: only presets we wrote, unchanged, are ever replaced.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineToolkit, parseSliders } from './inline.js';
import { encodePreset, resolvePresets, writePresetFile, type PresetInput } from './presets.js';

const MANIFEST = '.installed.json';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export interface ExampleInstall {
  installed: string[];
  /** Files the user changed since the last install: left as they are */
  kept: string[];
  /** Suggested presets written per example file */
  presets: Record<string, string[]>;
  /** Example preset files that did not validate (a bug in the shipped examples): skipped */
  presetErrors: string[];
}

export function installExamplePlugins(examplesDir: string, outDir: string, toolkit: string, presetsDir?: string): ExampleInstall {
  const result: ExampleInstall = { installed: [], kept: [], presets: {}, presetErrors: [] };
  if (!existsSync(examplesDir)) return result;
  mkdirSync(outDir, { recursive: true });

  const manifestPath = join(outDir, MANIFEST);
  let manifest: Record<string, string> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
  } catch {
    // first install, or an unreadable manifest: treated as "nothing we wrote yet"
  }

  for (const file of readdirSync(examplesDir).filter((f) => f.endsWith('.jsfx')).sort()) {
    const dest = join(outDir, file);
    const next = inlineToolkit(readFileSync(join(examplesDir, file), 'utf8'), { toolkit, version: 1, request: 'a plugin that ships with reaper-mcp', slug: file.replace(/\.jsfx$/, ''), example: true });
    const current = existsSync(dest) ? readFileSync(dest, 'utf8') : undefined;
    if (current !== undefined && current !== next && sha(current) !== manifest[file]) {
      result.kept.push(file);
      continue;
    }
    if (current !== next) writeFileSync(dest, next);
    manifest[file] = sha(next);
    result.installed.push(file);
  }

  if (presetsDir) {
    const folder = outDir.split(/[/\\]/).slice(-2).join('/'); // reaper-mcp-generated/examples
    for (const file of readdirSync(examplesDir).filter((f) => f.endsWith('.jsfx')).sort()) {
      const presetsPath = join(examplesDir, file.replace(/\.jsfx$/, '.presets.json'));
      if (!existsSync(presetsPath)) continue;
      const input = JSON.parse(readFileSync(presetsPath, 'utf8')) as PresetInput[];
      const { values, errors } = resolvePresets(input, parseSliders(readFileSync(join(examplesDir, file), 'utf8')).sliders);
      if (errors.length) { result.presetErrors.push(`${file}: ${errors.join(' ')}`); continue; }
      const encoded = input.map((p, i) => encodePreset(p.name.trim(), values[i]));
      result.presets[file] = writePresetFile(presetsDir, `${folder}/${file}`, encoded, join(outDir, '.presets', `${file}.json`)).written;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return result;
}
