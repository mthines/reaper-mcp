import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from './index.js';
import { fakeApi } from './__fixtures__/fake-api.js';
import { donor } from './__fixtures__/preset.js';

let dir: string;
let donorPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'helix-tools-'));
  donorPath = join(dir, 'donor.hlx');
  await writeFile(donorPath, JSON.stringify(donor()));
  process.env['HELIX_PRESET_DIRS'] = dir;
  process.env['HELIX_PRESET_OUT'] = join(dir, 'out');
  process.env['HELIX_IMPORT_CONFIG'] = join(dir, 'none.json');
});

async function tools(bridge?: Parameters<typeof fakeApi>[0]) {
  const t = fakeApi(bridge);
  await t.load(extension);
  return t;
}

const verse = (over: Record<string, unknown> = {}) => ({
  donorPath, name: 'Verse',
  path1: [{ id: 'amp', model: 'HD2_AmpArchetypeLead' }, { id: 'cab', model: 'HD2_Cab4X12CaliV30' }],
  path2: [{ id: 'verb', model: 'HD2_ReverbPlateaux', params: { Mix: 0.4 } }],
  snapshots: [{ name: 'Soft' }, { name: 'Wash', params: { verb: { Mix: 0.8 } } }],
  ...over,
});

describe('helix_list_models', () => {
  it('lists models from the scanned presets and shows one model\'s real parameters', async () => {
    const t = await tools();
    const all = (await t.call('list_models', { filter: 'Delay' })) as { models: { model: string }[] };
    expect(all.models.map((m) => m.model)).toEqual(['HD2_DelaySimpleDelay']);
    expect(await t.call('list_models', { model: 'HD2_DelaySimpleDelay' })).toMatchObject({ params: { Time: 0.4, Mix: 0.3, Feedback: 0.4 } });
    expect(await t.call('list_models', { model: 'HD2_Nope' })).toHaveProperty('error');
  });
});

describe('helix_create_preset', () => {
  it('dryRun shows the chain without writing; a real run writes a file that reads back', async () => {
    const t = await tools();
    const dry = await t.call('create_preset', verse({ dryRun: true }));
    expect(dry).toMatchObject({ written: false, summary: { name: 'Verse' } });
    expect(await readdir(dir)).toEqual(['donor.hlx']);

    const r = (await t.call('create_preset', verse())) as { path: string };
    const back = (await t.call('inspect_preset', { path: r.path })) as { name: string; findings: { level: string }[]; snapshots: { name: string; valid: boolean }[] };
    expect(back.name).toBe('Verse');
    expect(back.findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(back.snapshots.filter((s) => s.valid).map((s) => s.name)).toEqual(['Soft', 'Wash']);
  });

  it('refuses to replace an existing preset without overwrite, and keeps a backup when it does', async () => {
    const t = await tools();
    const first = (await t.call('create_preset', verse())) as { path: string };
    expect(await t.call('create_preset', verse())).toHaveProperty('error', expect.stringContaining('exists'));
    const again = (await t.call('create_preset', verse({ overwrite: true }))) as { backup: string };
    expect(JSON.parse(await readFile(again.backup, 'utf8')).data.meta.name).toBe('Verse');
    expect(first.path).toContain('Verse.hlx');
  });

  it('reports a bad spec as an error and writes nothing', async () => {
    const t = await tools();
    const r = await t.call('create_preset', verse({ path1: [{ id: 'a', model: 'HD2_AmpNope' }] }));
    expect(r).toMatchObject({ error: expect.stringContaining('unknown model') });
    expect(await readdir(dir)).toEqual(['donor.hlx']);
  });
});

describe('helix_edit_preset', () => {
  it('needs a destination, then edits a copy and leaves the source alone', async () => {
    const t = await tools();
    const made = (await t.call('create_preset', verse())) as { path: string };
    expect(await t.call('edit_preset', { path: made.path, name: 'Renamed' })).toHaveProperty('error', expect.stringContaining('outputPath'));
    const out = join(dir, 'copy.hlx');
    await t.call('edit_preset', { path: made.path, name: 'Renamed', outputPath: out });
    expect(JSON.parse(await readFile(out, 'utf8')).data.meta.name).toBe('Renamed');
    expect(JSON.parse(await readFile(made.path, 'utf8')).data.meta.name).toBe('Verse');
  });
});

describe('helix_set_preset', () => {
  const helix = (paramCount: number) => (command: string) =>
    command === 'get_track_properties'
      ? { success: true, data: { fxList: [{ index: 0, name: 'VST3i: Helix Native (Line 6)' }] } }
      : { success: true, data: { parameterCount: paramCount } };

  it('refuses an offline Helix (3 parameters) and never starts an import', async () => {
    const t = await tools(helix(3));
    expect(await t.call('set_preset', { path: donorPath, setlist: 2, preset: 8, trackIndex: 0 })).toHaveProperty('error', expect.stringContaining('offline'));
  });

  it('refuses a track without Helix Native', async () => {
    const t = await tools(() => ({ success: true, data: { fxList: [{ index: 0, name: 'VST: ReaEQ' }] } }));
    expect(await t.call('set_preset', { path: donorPath, setlist: 2, preset: 8, trackIndex: 0 })).toHaveProperty('error', 'No Helix Native on track 0');
  });

  it('explains how to configure the import driver when none is set', async () => {
    const t = await tools(helix(170));
    expect(await t.call('set_preset', { path: donorPath, setlist: 2, preset: 8, trackIndex: 0 })).toHaveProperty('error', expect.stringContaining('No import driver configured'));
  });
});
