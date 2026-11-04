import { describe, it, expect } from 'vitest';
import { buildCatalog } from './catalog.js';
import { createPreset, editPreset, type CreateSpec } from './build.js';
import { donor } from './__fixtures__/preset.js';
import { chain, getTone, summarize, validatePreset, snapshotOf, type Json, type Preset } from './hlx.js';

const catalog = buildCatalog([{ file: 'donor.hlx', preset: donor() }]);
const ok = (p: ReturnType<typeof createPreset>): Preset => {
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

const spec = (over: Partial<CreateSpec> = {}): CreateSpec => ({
  name: 'Verse',
  path1: [
    { id: 'drive', model: 'HD2_DistMinotaur', enabled: false },
    { id: 'amp', model: 'HD2_AmpArchetypeLead', params: { Drive: 0.3 } },
    { id: 'cab', model: 'HD2_Cab4X12CaliV30' },
  ],
  path2: [
    { id: 'delay', model: 'HD2_DelaySimpleDelay', params: { Mix: 0.2 } },
    { id: 'verb', model: 'HD2_ReverbPlateaux' },
  ],
  snapshots: [
    { name: 'Soft', on: ['amp', 'cab', 'delay', 'verb'], params: { amp: { Drive: 0.2 }, verb: { Mix: 0.5 } } },
    { name: 'Heavy', on: ['drive', 'amp', 'cab'], params: { amp: { Drive: 0.7 }, verb: { Mix: 0.1 } } },
  ],
  ...over,
});

describe('createPreset', () => {
  it('builds a preset that validates and loads in the boot snapshot\'s state', () => {
    const p = ok(createPreset(donor(), spec(), catalog));
    expect(validatePreset(p).filter((f) => f.level === 'error')).toEqual([]);
    const s = summarize(p) as { path1: { model: string; enabledAtBoot: boolean }[]; path2: { model: string }[]; snapshots: { name: string; valid: boolean }[] };
    expect(s.path1.map((b) => [b.model, b.enabledAtBoot])).toEqual([
      ['HD2_DistMinotaur', false],
      ['HD2_AmpArchetypeLead', true],
      ['HD2_Cab4X12CaliV30', true],
    ]);
    expect(s.path2.map((b) => b.model)).toEqual(['HD2_DelaySimpleDelay', 'HD2_ReverbPlateaux']);
    expect(s.snapshots.filter((x) => x.valid).map((x) => x.name)).toEqual(['Soft', 'Heavy']);
  });

  it('starts snapshot-controlled parameters at the boot snapshot value and varies them per snapshot', () => {
    const p = ok(createPreset(donor(), spec(), catalog));
    const tone = getTone(p);
    const amp = chain(tone.dsp0 as Json)[1];
    expect(amp[1]['Drive']).toBe(0.2);
    expect(snapshotOf(tone, 1)?.controllers?.['dsp0']?.[amp[0]]?.['Drive']?.['@value']).toBe(0.7);
    expect(tone.controller?.['dsp0']?.[amp[0]]?.['Drive']).toMatchObject({ '@min': 0, '@max': 1, '@controller': 9 });
  });

  it('boots into the snapshot asked for', () => {
    const p = ok(createPreset(donor(), spec({ boot: 1 }), catalog));
    const s = summarize(p) as { bootSnapshot: { name: string }; path1: { enabledAtBoot: boolean }[]; path2: { enabledAtBoot: boolean }[] };
    expect(s.bootSnapshot.name).toBe('Heavy');
    expect(s.path1[0].enabledAtBoot).toBe(true);
    expect(s.path2.map((b) => b.enabledAtBoot)).toEqual([false, false]);
    expect(validatePreset(p).filter((f) => f.level === 'error')).toEqual([]);
  });

  it('copies the dual-cab companion and routes path 1 into path 2', () => {
    const p = ok(createPreset(donor(), spec(), catalog));
    const tone = getTone(p);
    const cab = chain(tone.dsp0 as Json)[2][1];
    expect(typeof cab['@cab']).toBe('string');
    expect((tone.dsp0 as Json)[cab['@cab'] as string]).toMatchObject({ '@model': 'HD2_Cab4X12CaliV30' });
    expect(((tone.dsp0 as Json)['outputA'] as Json)['@output']).toBe(2);
  });

  it('routes straight to the main output with a single path', () => {
    const p = ok(createPreset(donor(), spec({ path2: undefined, snapshots: [{ name: 'a' }] }), catalog));
    expect((((getTone(p).dsp0 as Json)['outputA']) as Json)['@output']).toBe(1);
  });

  it('refuses an invented model, an invented parameter and a wrong value type, writing nothing', () => {
    expect(createPreset(donor(), spec({ path1: [{ id: 'x', model: 'HD2_AmpNope' }] }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('unknown model') });
    expect(createPreset(donor(), spec({ path1: [{ id: 'x', model: 'HD2_AmpArchetypeLead', params: { Gainz: 1 } }] }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('no parameter "Gainz"') });
    expect(createPreset(donor(), spec({ path1: [{ id: 'x', model: 'HD2_AmpArchetypeLead', params: { Drive: true } }] }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('is a number') });
  });

  it('refuses a snapshot that names a block that does not exist and a path with too many blocks', () => {
    expect(createPreset(donor(), spec({ snapshots: [{ name: 'a', on: ['ghost'] }] }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('ghost') });
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, model: 'HD2_EQParametric' }));
    expect(createPreset(donor(), spec({ path1: many }), catalog)).toMatchObject({ ok: false, error: expect.stringContaining('at most 7') });
  });

  it('treats a parameter that is the same in every snapshot as a plain value, not a controller', () => {
    const p = ok(createPreset(donor(), spec({ snapshots: [{ name: 'a', params: { amp: { Drive: 0.4 } } }, { name: 'b', params: { amp: { Drive: 0.4 } } }] }), catalog));
    const tone = getTone(p);
    expect(tone.controller?.['dsp0']).toEqual({});
    expect(chain(tone.dsp0 as Json)[1][1]['Drive']).toBe(0.4);
  });

  it('leaves the donor untouched', () => {
    const d = donor();
    ok(createPreset(d, spec(), catalog));
    expect(d).toEqual(donor());
  });
});

describe('editPreset', () => {
  const base = () => ok(createPreset(donor(), spec(), catalog));

  it('changes a block parameter and keeps the preset loadable', () => {
    const r = editPreset(base(), { blocks: [{ ref: 'DistMinotaur', params: { Gain: 0.9 } }] });
    if (!r.ok) throw new Error(r.error);
    expect(chain(getTone(r.value).dsp0 as Json)[0][1]['Gain']).toBe(0.9);
  });

  it('moving a snapshot-controlled parameter by block edit moves the boot snapshot value too', () => {
    const r = editPreset(base(), { blocks: [{ ref: 'AmpArchetype', params: { Drive: 0.35 } }] });
    if (!r.ok) throw new Error(r.error);
    const tone = getTone(r.value);
    const [key] = chain(tone.dsp0 as Json)[1];
    expect(snapshotOf(tone, 0)?.controllers?.['dsp0']?.[key]?.['Drive']?.['@value']).toBe(0.35);
    expect(validatePreset(r.value).filter((f) => f.level === 'error')).toEqual([]);
  });

  it('renames a snapshot, switches a block and sets a new per-snapshot parameter, declaring it', () => {
    const r = editPreset(base(), { snapshots: [{ index: 1, name: 'Breakdown', off: ['dsp0/block0'], params: { 'dsp1/block0': { Mix: 0.05 } } }] });
    if (!r.ok) throw new Error(r.error);
    const tone = getTone(r.value);
    expect(snapshotOf(tone, 1)?.['@name']).toBe('Breakdown');
    expect(snapshotOf(tone, 1)?.blocks?.['dsp0']?.['block0']).toBe(false);
    expect(tone.controller?.['dsp1']?.['block0']?.['Mix']).toMatchObject({ '@controller': 9 });
    expect(snapshotOf(tone, 0)?.controllers?.['dsp1']?.['block0']?.['Mix']?.['@value']).toBe(0.2);
    expect(validatePreset(r.value).filter((f) => f.level === 'error')).toEqual([]);
  });

  it('refuses an ambiguous fragment, an unknown block and a missing snapshot, changing nothing', () => {
    expect(editPreset(base(), { blocks: [{ ref: 'Eq', params: {} }, { ref: 'Cab' }, { ref: 'Delay' }, { ref: 'nope' }] })).toMatchObject({ ok: false });
    expect(editPreset(base(), { blocks: [{ ref: 'dsp0/block9', enabled: true }] })).toMatchObject({ ok: false, error: 'no block dsp0/block9' });
  });

  it('does not modify the preset it was given', () => {
    const b = base();
    const copy = structuredClone(b);
    editPreset(b, { name: 'Other' });
    expect(b).toEqual(copy);
  });
});

describe('validatePreset', () => {
  it('flags a block that would load in the wrong bypass state', () => {
    const p = ok(createPreset(donor(), spec(), catalog));
    const tone = getTone(p);
    (chain(tone.dsp0 as Json)[0][1] as Json)['@enabled'] = true; // drive is off at boot
    expect(validatePreset(p)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('base @enabled mismatch') }));
  });
});
