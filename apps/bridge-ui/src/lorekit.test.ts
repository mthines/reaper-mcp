import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRecords, parseInstalled, parseRecord, publishAll, publishRecord, type LoreKitEntry } from './lorekit.js';

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

describe('publishRecord', () => {
  afterEach(() => vi.unstubAllGlobals());
  const parsed = parseRecord({ ...user, value: '# Graillon 3\n\nPitch correction.' });
  if (!parsed?.source) throw new Error('fixture must parse as a user record');
  const mine = { ...parsed, source: parsed.source };
  type Call = { url: string; method?: string; body?: Record<string, unknown> };

  function stub(answer: (c: Call) => Response) {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lk_rw_abc');
      const c = { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      return answer(c);
    });
    return calls;
  }

  it('writes the record under the reaper-mcp org as a built-in record, then archives the copy', async () => {
    const calls = stub(() => new Response(JSON.stringify({ id: 'x' })));
    expect(await publishRecord('https://lk.test/v1', 'lk_rw_abc', mine, { removeCopy: true })).toEqual({ key: 'plugins::auburn-sounds/graillon-3', removedCopy: true });
    expect(calls[0]).toMatchObject({
      url: 'https://lk.test/v1/memories',
      method: 'POST',
      body: {
        scope: 'project::reaper-mcp',
        org: 'reaper-mcp',
        key: 'plugins::auburn-sounds/graillon-3',
        value: '# Graillon 3\n\nPitch correction.',
        tags: ['plugin-knowledge', 'category::pitch', 'fx::Graillon 3', 'layer::built-in'],
      },
    });
    expect(calls[1].method).toBe('DELETE');
    expect(calls[1].url).toBe('https://lk.test/v1/memories?scope=project%3A%3Areaper-mcp&key=user%3A%3Aplugins%3A%3Aauburn-sounds%2Fgraillon-3');
  });

  it('keeps the copy when asked', async () => {
    const calls = stub(() => new Response('{}'));
    expect(await publishRecord('https://lk.test/v1', 'lk_rw_abc', mine, { removeCopy: false })).toMatchObject({ removedCopy: false });
    expect(calls).toHaveLength(1);
  });

  it('says when the token is not a writer in the org, and archives nothing', async () => {
    const calls = stub(() => new Response('{}', { status: 403 }));
    await expect(publishRecord('https://lk.test/v1', 'lk_rw_abc', mine, { removeCopy: true })).rejects.toThrow(/member of the reaper-mcp org/);
    expect(calls).toHaveLength(1);
  });

  it('treats a write LoreKit routed elsewhere as a failure', async () => {
    stub(() => new Response(JSON.stringify({ id: 'x', notice: 'fell back to personal' })));
    await expect(publishRecord('https://lk.test/v1', 'lk_rw_abc', mine, { removeCopy: true })).rejects.toThrow(/fell back to personal/);
  });

  it('reports a failed archive as a warning, not a failed publish', async () => {
    stub((c) => new Response('{}', { status: c.method === 'DELETE' ? 500 : 200 }));
    expect(await publishRecord('https://lk.test/v1', 'lk_rw_abc', mine, { removeCopy: true })).toMatchObject({ removedCopy: false, warning: expect.stringMatching(/wasn't archived/) });
  });

  it('runs the contribution checks before writing anything', async () => {
    const calls = stub(() => new Response('{}'));
    const bad = { ...mine, source: { ...mine.source, tags: ['plugin-knowledge', 'secret::x'] } };
    await expect(publishRecord('https://lk.test/v1', 'lk_rw_abc', bad, { removeCopy: true })).rejects.toThrow(/not allowed/);
    await expect(publishRecord('https://lk.test/v1', 'lk_ro_abc', mine, { removeCopy: true })).rejects.toThrow(/lk_rw_/);
    expect(calls).toHaveLength(0);
  });
});

describe('publishAll', () => {
  const rec = (key: string) => ({ key }) as Parameters<typeof publishAll>[0][number];
  it('publishes in order and carries on past a failure', async () => {
    const order: string[] = [];
    const progress: number[] = [];
    const outcomes = await publishAll(
      [rec('user::plugins::a/x'), rec('user::plugins::b/y'), rec('user::plugins::c/z')],
      async (r) => {
        order.push(r.key);
        if (r.key.includes('b/y')) throw new Error('LoreKit answered 500');
        return { key: r.key.replace(/^user::/, ''), removedCopy: true };
      },
      (n) => progress.push(n),
    );
    expect(order).toEqual(['user::plugins::a/x', 'user::plugins::b/y', 'user::plugins::c/z']);
    expect(progress).toEqual([1, 2, 3]);
    expect(outcomes.map((o) => ('error' in o ? o.error : o.result.key))).toEqual(['plugins::a/x', 'LoreKit answered 500', 'plugins::c/z']);
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
