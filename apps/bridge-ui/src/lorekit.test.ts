import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRecords, parseInstalled, parseRecord, type LoreKitEntry } from './lorekit.js';

const builtIn: LoreKitEntry = {
  id: '84daa88a-5e98-4e52-8cf2-bb3f14ce1a6f',
  key: 'plugins::fabfilter/pro-q-3',
  updated_at: '2026-10-27T08:38:12.350973+00:00',
  tags: ['plugin-knowledge', 'category::eq', 'vendor::fabfilter', 'preference::90', 'style::transparent', 'fx::Pro-Q 3', 'fx::VST3: Pro-Q3 (FabFilter)', 'layer::built-in'],
  value: '# FabFilter Pro-Q 3\n\n**Category:** eq · **Style:** transparent · **Vendor:** FabFilter · **Preference:** 90/100  \n**Matches FX:** `Pro-Q 3`\n\n## What it does\n\nSurgical parametric EQ.\nDynamic bands too.\n\n| a | b |\n\n## When to prefer this\n\nAlways.',
};

const user: LoreKitEntry = {
  id: 'u1',
  key: 'user::plugins::auburn-sounds/graillon-3',
  tags: ['plugin-knowledge', 'layer::user', 'category::pitch', 'fx::Graillon 3'],
  value: '# Graillon 3\n\n## Learned notes\n\n- Correction at 60% for rap vocals\n  - nested detail\n- Bypass the pitch shifter\n\n## Other\n\n- not a note',
};

describe('parseRecord', () => {
  it('reads a built-in record from its tags and body', () => {
    expect(parseRecord(builtIn)).toEqual({
      id: builtIn.id,
      key: 'plugins::fabfilter/pro-q-3',
      name: 'FabFilter Pro-Q 3',
      vendor: 'FabFilter',
      category: 'eq',
      style: 'transparent',
      preference: 90,
      layer: 'built-in',
      matches: ['Pro-Q 3', 'VST3: Pro-Q3 (FabFilter)'],
      notes: undefined,
      updatedAt: Date.parse('2026-10-27T08:38:12.350973+00:00'),
      preview: '## What it does\n\nSurgical parametric EQ.\nDynamic bands too.\n\n| a | b |\n\n## When to prefer this\n\nAlways.',
    });
  });

  it('counts the learned notes on a user record', () => {
    const r = parseRecord(user);
    expect(r).toMatchObject({ layer: 'user', notes: 2, category: 'pitch', preference: undefined });
    expect(r?.preview).toContain('Correction at 60%');
  });

  it('skips rows that are not plugin records', () => {
    expect(parseRecord({ ...builtIn, key: 'mixing-lessons::x' })).toBeNull();
    expect(parseRecord({ ...builtIn, tags: ['plugin-knowledge'] })).toBeNull(); // built-in key without the layer tag
    expect(parseRecord({ ...user, tags: [] })).toBeNull();
  });
});

describe('fetchRecords', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pages through GET /memories with the token and keeps only that layer', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lk_ro_abc');
      const first = !url.includes('cursor=');
      return new Response(JSON.stringify(first ? { entries: [builtIn, user], hasMore: true, nextCursor: 'c2' } : { entries: [], hasMore: false }));
    });
    const records = await fetchRecords('https://lk.test/v1', 'lk_ro_abc', 'built-in');
    expect(records.map((r) => r.key)).toEqual(['plugins::fabfilter/pro-q-3']);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/memories?scope=project%3A%3Areaper-mcp&key_prefix=plugins%3A%3A&tags=plugin-knowledge%2Clayer%3A%3Abuilt-in&tags_mode=all');
    expect(calls[1]).toContain('cursor=c2');
  });

  it('refuses a token that could write', async () => {
    await expect(fetchRecords('https://lk.test/v1', 'lk_rw_abc', 'user')).rejects.toThrow(/read-only/);
  });

  it('says when LoreKit rejects the token', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    await expect(fetchRecords('https://lk.test/v1', 'lk_ro_bad', 'user')).rejects.toThrow(/refused the token/);
  });
});

describe('parseInstalled', () => {
  it('reads the bridge payload and drops malformed rows', () => {
    expect(parseInstalled({ v: 1, supported: true, fx: [{ n: 'VST3: Pro-Q 3 (FabFilter)', t: 'VST3' }, { t: 'JS' }, null] })).toEqual({
      supported: true,
      fx: [{ name: 'VST3: Pro-Q 3 (FabFilter)', type: 'VST3' }],
    });
    expect(parseInstalled({ v: 1, supported: false, fx: [] })).toEqual({ supported: false, fx: [] });
    expect(parseInstalled(null)).toBeNull();
  });
});
