import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionApi, ExtensionModule, ToolResult } from '@reaper-mcp/extension-api';
import { buildCatalog, scanLibrary, type Catalog } from './catalog.js';
import { createPreset, editPreset, type CreateSpec, type EditSpec } from './build.js';
import { parsePreset, summarize, validatePreset, type Preset } from './hlx.js';
import { backupLibrary, commandDriver, defaultLibraryDir, setPreset, type ImportDriver } from './import.js';

const home = (...p: string[]) => join(homedir(), '.reaper-mcp', ...p);
const outputDir = () => process.env['HELIX_PRESET_OUT'] ?? home('helix', 'presets');
const searchDirs = (extra?: string[]) =>
  extra?.length ? extra : (process.env['HELIX_PRESET_DIRS']?.split(':').filter(Boolean) ?? [join(homedir(), 'Documents', 'Line 6', 'Tones'), outputDir()]);
const knowledgeDir = () => join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');

async function readPreset(path: string): Promise<{ ok: true; preset: Preset } | { ok: false; error: string }> {
  try {
    return parsePreset(await readFile(path, 'utf8'));
  } catch (e) {
    return { ok: false, error: `${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function loadCatalog(dirs: string[]): Promise<{ catalog: Catalog; files: number }> {
  const { presets } = await scanLibrary(dirs);
  return { catalog: buildCatalog(presets), files: presets.length };
}

async function loadImportDriver(): Promise<{ ok: true; driver: ImportDriver } | { ok: false; error: string }> {
  const file = process.env['HELIX_IMPORT_CONFIG'] ?? home('helix-import.json');
  try {
    const cfg = JSON.parse(await readFile(file, 'utf8')) as { command?: unknown };
    if (Array.isArray(cfg.command) && cfg.command.length > 0 && cfg.command.every((c) => typeof c === 'string')) {
      return { ok: true, driver: commandDriver(cfg.command as string[]) };
    }
    return { ok: false, error: `${file} needs {"command": ["program", "arg", "{file}"]}` };
  } catch {
    return {
      ok: false,
      error: `No import driver configured. Create ${file} with {"command": ["program", "arg", "{file}"]}: a script that opens Helix Native's Import and loads {file}. Helix's saved state is encrypted, so Import is the only way in.`,
    };
  }
}

async function writeNew(api: ExtensionApi, preset: Preset, outputPath: string | undefined, overwrite: boolean | undefined, warnings: string[]): Promise<ToolResult> {
  const name = preset.data?.meta?.name ?? 'preset';
  const path = resolve(outputPath ?? join(outputDir(), `${name.replace(/[\\/:*?"<>|]/g, '_')}.hlx`));
  if ((await exists(path)) && !overwrite) return api.error(`${path} exists; pass overwrite: true (the old file is kept as a timestamped .bak) or another outputPath`);
  await mkdir(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (await exists(path)) {
    backup = `${path}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await copyFile(path, backup);
  }
  await writeFile(path, JSON.stringify(preset), 'utf8');
  const reread = await readPreset(path);
  if (!reread.ok) return api.error(`wrote ${path} but it does not parse back: ${reread.error}`);
  return api.json({ written: true, path, backup, warnings, summary: summarize(reread.preset) });
}

const extension: ExtensionModule = {
  register(api) {
    const { z } = api;

    api.tool(
      'guide',
      'Read the Helix knowledge: preset format, model catalog, chain design, genre recipes (incl. Sleep Token style), snapshot mechanics, parameter encoding, file safety. Call with no topic to list them. Read parameter-encoding and snapshot-mechanics before writing a preset.',
      { topic: z.string().optional().describe('File name without .md, e.g. "sleep-token"') },
      async ({ topic }) => {
        const dir = knowledgeDir();
        const topics = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
        if (!topic) return api.json({ topics });
        if (!topics.includes(topic)) return api.error(`unknown topic "${topic}"; have: ${topics.join(', ')}`);
        return { content: [{ type: 'text', text: await readFile(join(dir, `${topic}.md`), 'utf8') }] };
      },
    );

    api.tool(
      'inspect_preset',
      'Read a .hlx preset: name, both paths in chain order with models, boot snapshot, routing, every snapshot (which blocks are on, which values it controls) and validation findings (errors would stop it loading cleanly). Read-only.',
      { path: z.string().describe('Path to a .hlx file') },
      async ({ path }) => {
        const r = await readPreset(path);
        if (!r.ok) return api.error(r.error);
        return api.json({ ...summarize(r.preset), findings: validatePreset(r.preset) });
      },
    );

    api.tool(
      'list_models',
      'List block models found in real .hlx presets (the only source of valid model ids and parameter names). Use before create/edit to pick models. Filter by a name fragment; with `model`, also returns that model\'s parameters and their current values in the real block.',
      {
        filter: z.string().optional().describe('Fragment of the model id, e.g. "Delay", "Amp", "Plateaux"'),
        model: z.string().optional().describe('Exact model id to show parameters for'),
        libraryDirs: z.array(z.string()).optional().describe('Folders to scan for .hlx (default: HELIX_PRESET_DIRS or ~/Documents/Line 6/Tones and the output folder)'),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      },
      async ({ filter, model, libraryDirs, limit }) => {
        const { catalog, files } = await loadCatalog(searchDirs(libraryDirs));
        if (model) {
          const e = catalog.get(model);
          if (!e) return api.error(`${model} is not in ${files} scanned presets`);
          const params = Object.fromEntries(Object.entries(e.template).filter(([k]) => !k.startsWith('@')));
          return api.json({ model, type: e.template['@type'], params, dualCab: e.companion !== undefined, seenIn: e.seenIn.slice(0, 5) });
        }
        const all = [...catalog.values()].filter((e) => !filter || e.model.toLowerCase().includes(filter.toLowerCase()));
        const shown = all.slice(0, limit ?? 100);
        return api.json({ scannedPresets: files, total: all.length, models: shown.map((e) => ({ model: e.model, type: e.template['@type'], presets: e.seenIn.length })) });
      },
    );

    const blockSpec = z.object({
      id: z.string().min(1).describe('Your handle for this block; snapshots refer to it'),
      model: z.string().describe('Model id from helix_list_models'),
      params: z.record(z.string(), z.union([z.number(), z.boolean()])).optional().describe('Parameter values in Helix units (see guide: parameter-encoding)'),
      enabled: z.boolean().optional().describe('Default true; the boot snapshot decides the load-time state'),
    });
    const snapshotSpec = z.object({
      name: z.string(),
      ledcolor: z.coerce.number().int().optional(),
      tempo: z.coerce.number().optional(),
      on: z.array(z.string()).optional().describe('Block ids that are on in this snapshot (default: all enabled blocks)'),
      params: z.record(z.string(), z.record(z.string(), z.number())).optional().describe('blockId -> parameter -> value in this snapshot'),
    });

    api.tool(
      'create_preset',
      'Build a new .hlx from a donor preset (a real preset with two-path routing, e.g. one with an amp on path 1 and delay/reverb on path 2): replaces its blocks with yours, cloned from real blocks, sets up to 8 snapshots with per-snapshot bypass and parameter values, and fixes the load-time state. Everything is validated first; a refused spec writes nothing. Max 7 blocks per path. Put pitch effects before the amp, gate early. dryRun returns the summary only.',
      {
        donorPath: z.string().describe('A real .hlx to clone routing and device keys from'),
        name: z.string().min(1).max(32),
        tempo: z.coerce.number().min(30).max(240).optional(),
        boot: z.coerce.number().int().min(0).max(7).optional().describe('Snapshot active on load (default 0)'),
        inputGate: z.object({ enabled: z.boolean().optional(), threshold: z.number().optional().describe('dB'), decay: z.number().optional().describe('0-1') }).optional(),
        path1: z.array(blockSpec).describe('Blocks in chain order on path 1 (amp, cab, drives, gates)'),
        path2: z.array(blockSpec).optional().describe('Blocks on path 2, fed by path 1 (delays, reverb, EQ)'),
        snapshots: z.array(snapshotSpec).min(1).max(8),
        libraryDirs: z.array(z.string()).optional().describe('Folders scanned for block templates'),
        outputPath: z.string().optional().describe('Default: <HELIX_PRESET_OUT or ~/.reaper-mcp/helix/presets>/<name>.hlx'),
        overwrite: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
      async (a) => {
        const donor = await readPreset(a.donorPath);
        if (!donor.ok) return api.error(donor.error);
        const { catalog, files } = await loadCatalog([...searchDirs(a.libraryDirs), dirname(resolve(a.donorPath))]);
        if (files === 0) return api.error('no presets found to take block templates from; pass libraryDirs');
        const spec: CreateSpec = { name: a.name, tempo: a.tempo, boot: a.boot, inputGate: a.inputGate, path1: a.path1, path2: a.path2, snapshots: a.snapshots };
        const built = createPreset(donor.preset, spec, catalog);
        if (!built.ok) return api.error(`${built.error} (nothing was written)`);
        if (a.dryRun) return api.json({ written: false, dryRun: true, warnings: built.warnings, summary: summarize(built.value) });
        return writeNew(api, built.value, a.outputPath, a.overwrite, built.warnings);
      },
    );

    api.tool(
      'edit_preset',
      'Change an existing .hlx: rename, tempo, boot snapshot, block parameters and base on/off, and per-snapshot name, color, blocks on/off and parameter values (a parameter used per snapshot becomes snapshot-controlled). Blocks are named `dsp0/block1` (see inspect_preset ids) or by a model fragment that matches one block. The load-time invariants are re-synced and validated; a refused edit writes nothing. By default writes next to the file as a new version only when outputPath is given; with overwrite the original is kept as a timestamped .bak.',
      {
        path: z.string(),
        name: z.string().min(1).max(32).optional(),
        tempo: z.coerce.number().min(30).max(240).optional(),
        boot: z.coerce.number().int().min(0).max(7).optional(),
        blocks: z.array(z.object({ ref: z.string(), params: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(), enabled: z.boolean().optional() })).optional(),
        snapshots: z
          .array(
            z.object({
              index: z.coerce.number().int().min(0).max(7),
              name: z.string().optional(),
              ledcolor: z.coerce.number().int().optional(),
              on: z.array(z.string()).optional(),
              off: z.array(z.string()).optional(),
              params: z.record(z.string(), z.record(z.string(), z.number())).optional(),
            }),
          )
          .optional(),
        outputPath: z.string().optional(),
        overwrite: z.boolean().optional().describe('Replace the file at `path` (backed up first)'),
        dryRun: z.boolean().optional(),
      },
      async (a) => {
        const src = await readPreset(a.path);
        if (!src.ok) return api.error(src.error);
        const edit: EditSpec = { name: a.name, tempo: a.tempo, boot: a.boot, blocks: a.blocks, snapshots: a.snapshots };
        const built = editPreset(src.preset, edit);
        if (!built.ok) return api.error(`${built.error} (nothing was changed)`);
        if (a.dryRun) return api.json({ written: false, dryRun: true, warnings: built.warnings, summary: summarize(built.value) });
        if (!a.outputPath && !a.overwrite) return api.error('give an outputPath, or overwrite: true to replace the file (it is backed up first)');
        return writeNew(api, built.value, a.outputPath ?? a.path, a.overwrite ?? false, built.warnings);
      },
    );

    api.tool(
      'set_preset',
      'Load a .hlx into a live Helix Native by running its Import, into ONE named library slot, with safety checks: Helix Native must be online on the track (a 3-parameter instance is offline: refused), the preset must validate, the whole library is backed up first, and afterwards exactly the expected slot must have changed or the library is restored from the backup. Overwrites that slot; choose a scratch slot ("New Preset"/"CAL"). Needs an import driver configured (see docs/EXTENSIONS.md). Select the preset in the plugin afterwards.',
      {
        path: z.string().describe('The .hlx to load'),
        setlist: z.coerce.number().int().min(0).max(7).describe('Setlist number of the slot to overwrite (SETLIST<n>)'),
        preset: z.coerce.number().int().min(0).max(127).describe('Preset number within the setlist (PRESET<nnn>)'),
        trackIndex: z.coerce.number().int().min(0),
        fxIndex: z.coerce.number().int().min(0).optional().describe('FX slot of the Helix; found automatically when the track has one'),
      },
      async ({ path, setlist, preset, trackIndex, fxIndex }) => {
        const src = await readPreset(path);
        if (!src.ok) return api.error(src.error);
        const errors = validatePreset(src.preset).filter((f) => f.level === 'error');
        if (errors.length) return api.error(`the preset would not load cleanly: ${errors.map((e) => e.message).join('; ')}`);

        const props = await api.bridge('get_track_properties', { trackIndex });
        if (!props.success) return api.error(props.error ?? 'could not read the track');
        const fxList = ((props.data as { fxList?: { index: number; name: string }[] } | undefined)?.fxList ?? []).filter((f) => /helix native/i.test(f.name));
        const slot = fxIndex !== undefined ? fxList.find((f) => f.index === fxIndex) : fxList.length === 1 ? fxList[0] : undefined;
        if (!slot) return api.error(fxList.length === 0 ? `No Helix Native on track ${trackIndex}` : `Pick an FX: track ${trackIndex} has Helix Native at ${fxList.map((f) => f.index).join(', ')}; pass fxIndex`);
        const params = await api.bridge('get_fx_parameters', { trackIndex, fxIndex: slot.index, limit: 1 });
        const count = (params.data as { parameterCount?: number } | undefined)?.parameterCount ?? 0;
        if (!params.success || count <= 3) return api.error(`Helix Native on track ${trackIndex} FX ${slot.index} is offline (only ${count} parameters). Bring it online yourself first; this tool never does.`);

        const drv = await loadImportDriver();
        if (!drv.ok) return api.error(drv.error);
        const result = await setPreset({ hlxPath: resolve(path), libraryDir: defaultLibraryDir(), backupRoot: home('helix', 'library-backups'), driver: drv.driver, expectSlot: { setlist, preset } });
        if (!result.ok) return api.error(result.error);
        return api.json({ loaded: true, name: src.preset.data?.meta?.name, setlist: result.slot.setlist, preset: result.slot.preset, backup: result.backup, note: `Select setlist ${result.slot.setlist}, preset ${result.slot.preset} in the plugin to hear it. To undo, copy the files back from the backup folder.` });
      },
    );

    api.tool(
      'backup_library',
      'Copy the whole Helix Native preset library to ~/.reaper-mcp/helix/library-backups/<time>/ . Do this before anything that touches slots by hand.',
      {},
      async () => {
        try {
          return api.json({ backup: await backupLibrary(defaultLibraryDir(), home('helix', 'library-backups')), name: basename(defaultLibraryDir()) });
        } catch (e) {
          return api.error(e instanceof Error ? e.message : String(e));
        }
      },
    );

    api.describeCategory('Line 6 Helix: build, edit and validate .hlx presets (snapshots, chains from real blocks) and load them into Helix Native with a checked, rolled-back import');
  },
};

export default extension;
