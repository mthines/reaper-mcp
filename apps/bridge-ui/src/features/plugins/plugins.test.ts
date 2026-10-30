import { describe, expect, it } from 'vitest';
import { lorekitUrl, type PluginRecord } from './plugins.js';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';

const record = (over: Partial<PluginRecord>): PluginRecord => ({
  key: 'plugins::fabfilter/pro-q-3',
  name: 'FabFilter Pro-Q 3',
  vendor: 'FabFilter',
  category: 'eq',
  layer: 'built-in',
  matches: [],
  updatedAt: 0,
  preview: '',
  ...over,
});

describe('lorekitUrl', () => {
  it('opens the record by its row id', () => {
    const url = lorekitUrl(record({ id: '84daa88a-5e98-4e52-8cf2-bb3f14ce1a6f' }));
    expect(url).toBe('https://www.lorekit.io/lore?scope=%22project%3A%3Areaper-mcp%22&memoryId=84daa88a-5e98-4e52-8cf2-bb3f14ce1a6f');
  });

  it('gives no link without an id rather than guessing by search', () => {
    expect(lorekitUrl(record({ key: 'user::plugins::joey-sturgis-tones/gain-reduction-2' }))).toBeUndefined();
  });

  it('links each demo record to its own row only', () => {
    const ids = DEMO_KNOWLEDGE.records.flatMap((r) => (r.id ? [r.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DEMO_KNOWLEDGE.records) {
      expect(lorekitUrl(r)).toBe(r.id ? `https://www.lorekit.io/lore?scope=%22project%3A%3Areaper-mcp%22&memoryId=${r.id}` : undefined);
    }
  });
});

import { creatorOf, groupByCreator, pluginCoverage } from './plugins.js';
import { parseUsed } from './lorekit.js';

describe('plugins in the open project', () => {
  const feed = {
    installed: [
      { name: 'VST3: Pro-Q 3 (FabFilter)', type: 'VST3' },
      { name: 'VST3: Pro-C 2 (FabFilter)', type: 'VST3' },
      { name: 'JS: Dynamics/1175_compressor', type: 'JS' },
      { name: 'VST3: Melodyne (Celemony)', type: 'VST3' },
      { name: 'Mystery', type: 'VST' },
    ],
    records: [],
    used: [
      { name: 'VST3: Pro-Q3 (FabFilter)', count: 3 }, // REAPER spells it without the space here
      { name: 'VST3: Melodyne (Celemony)', count: 1 },
    ],
  };

  it('counts instances per installed plugin, tolerating spacing differences', () => {
    const used = Object.fromEntries(pluginCoverage(feed).map((r) => [r.label, r.used]));
    expect(used).toMatchObject({ 'Pro-Q 3': 3, Melodyne: 1, 'Pro-C 2': 0 });
  });

  it('names the creator from the record, the (Vendor) suffix, or the FX type', () => {
    expect(creatorOf({ name: 'VST3: Pro-Q 3 (FabFilter)', type: 'VST3' })).toBe('FabFilter');
    expect(creatorOf({ name: 'JS: Dynamics/1175_compressor', type: 'JS' })).toBe('JSFX');
    expect(creatorOf({ name: 'JS: Channel mapper (18 out)', type: 'JS' })).toBe('JSFX'); // a title, not a vendor
    expect(creatorOf({ name: 'Mystery', type: 'VST' })).toBe('Other');
    expect(creatorOf({ name: 'VST: ReaEQ (Cockos)', type: 'VST' }, { vendor: 'Cockos (stock)' } as never)).toBe('Cockos (stock)');
  });

  it('groups by creator with project creators first and Other last', () => {
    const groups = groupByCreator(pluginCoverage(feed));
    expect(groups.map((g) => [g.creator, g.rows.length, g.used])).toEqual([
      ['Celemony', 1, 1],
      ['FabFilter', 2, 1],
      ['JSFX', 1, 0],
      ['Other', 1, 0],
    ]);
  });

  it('lists a plugin installed in several formats once, preferring VST3, with the instances of every format', () => {
    const rows = pluginCoverage({
      installed: [
        { name: 'VSTi: Vital (Vital Audio)', type: 'VST' },
        { name: 'CLAPi: Vital (Vital Audio)', type: 'CLAP' },
        { name: 'VST3i: Vital (Vital Audio)', type: 'VST3' },
        { name: 'VST: Vital (Someone Else)', type: 'VST' }, // same title, another maker: its own row
      ],
      records: [],
      used: [
        { name: 'VST3i: Vital (Vital Audio)', count: 7 },
        { name: 'CLAPi: Vital (Vital Audio)', count: 2 },
      ],
    });
    expect(rows.map((r) => [r.fx.name, r.used, r.variants.map((v) => v.name)])).toEqual([
      ['VST3i: Vital (Vital Audio)', 9, ['VST3i: Vital (Vital Audio)', 'CLAPi: Vital (Vital Audio)', 'VSTi: Vital (Vital Audio)']],
      ['VST: Vital (Someone Else)', 0, ['VST: Vital (Someone Else)']],
    ]);
  });

  it('reads the bridge payload of FX in the project', () => {
    expect(parseUsed({ v: 1, fx: [{ n: 'VST: ReaComp (Cockos)', c: 2 }, { n: 'x' }, { n: 'y', c: 0 }] })).toEqual([{ name: 'VST: ReaComp (Cockos)', count: 2 }]);
    expect(parseUsed({ v: 1 })).toBeNull();
  });
});

import { parseFxName } from './plugins.js';

describe('parseFxName', () => {
  it.each([
    ['VST3: Pro-C 2 (FabFilter) (Comp)', 'VST3', 'Pro-C 2', 'FabFilter'],
    ['VST3: Acon Digital Remix (Acon Digital) (2->12ch) (Stem Splitter)', 'VST3', 'Acon Digital Remix', 'Acon Digital'],
    ['VST3i: Kontakt 7 (Native Instruments) (64 out)', 'VST3', 'Kontakt 7', 'Native Instruments'],
    ['VST: Ozone 9 (x86_64) (iZotope)', 'VST', 'Ozone 9', 'iZotope'],
    ['VST: FabFilter Pro-C 2 (Mono) (FabFilter)', 'VST', 'FabFilter Pro-C 2 (Mono)', 'FabFilter'],
    ['VST: ReaFir (FFT EQ+Dynamics Processor) (Cockos)', 'VST', 'ReaFir (FFT EQ+Dynamics Processor)', 'Cockos'],
    ['VST: ReaStream (Cockos) (8ch)', 'VST', 'ReaStream', 'Cockos'],
    ['VSTi: ReaSynDr (Cockos) (4 out)', 'VST', 'ReaSynDr', 'Cockos'],
    ['JS: Channel mapper (18 out)', 'JS', 'Channel mapper (18 out)', undefined],
    ['ReaEQ', '', 'ReaEQ', undefined], // no prefix: the type comes from the bridge
  ])('%s', (name, type, title, vendor) => {
    expect(parseFxName(name)).toEqual({ type, title, vendor });
  });
});
