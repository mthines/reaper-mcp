import { describe, expect, it } from 'vitest';
import { lorekitUrl, type PluginRecord } from './plugins.js';
import { DEMO_KNOWLEDGE } from './demo-plugins.js';

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
