import { describe, expect, it } from 'vitest';
import { parseContribution } from './plugin-contributions.mjs';
import { contributable, contribution, contributionFileName } from './contribute.js';
import { DEMO_KNOWLEDGE } from './demo-plugins.js';

const mine = contributable(DEMO_KNOWLEDGE.records);
const header = (key: string, tags: string) => `<!-- lorekit-record\nkey: ${key}\ntags: ${tags}\n-->\n`;

describe('contribution', () => {
  it('offers only your own records', () => {
    expect(mine.map((r) => r.key)).toEqual(['user::plugins::auburn-sounds/graillon-3', 'user::plugins::joey-sturgis-tones/gain-reduction-2']);
  });

  it('writes a file the publish workflow accepts, as built-in records', () => {
    const { text } = contribution(mine);
    const { records, errors } = parseContribution(text);
    expect(errors).toEqual([]);
    expect(records.map((r) => r.key)).toEqual(['plugins::auburn-sounds/graillon-3', 'plugins::joey-sturgis-tones/gain-reduction-2']);
    expect(records[0].tags).toContain('layer::built-in');
    expect(records[0].tags).not.toContain('layer::user');
    expect(records[0].value).toMatch(/^# Graillon 3\n/);
  });

  it('prefills GitHub’s new-file page, or leaves the file for pasting when the URL gets too long', () => {
    const small = contribution(mine, 'knowledge/contributions/x.md');
    expect(small.prefilled).toBe(true);
    const url = new URL(small.url);
    expect(url.pathname).toBe('/mthines/reaper-mcp/new/main');
    expect(url.searchParams.get('filename')).toBe('knowledge/contributions/x.md');
    expect(url.searchParams.get('value')).toBe(small.text);

    const long = mine.map((r) => ({ ...r, source: r.source && { ...r.source, value: `${r.source.value}\n${'x'.repeat(6000)}` } }));
    const big = contribution(long);
    expect(big.prefilled).toBe(false);
    expect(new URL(big.url).searchParams.has('value')).toBe(false);
  });

  it('names the file by date and plugin', () => {
    expect(contributionFileName(mine.slice(0, 1), new Date('2026-10-27T10:00:00Z'), 'ab12')).toBe('knowledge/contributions/2026-10-27-graillon-3-ab12.md');
    expect(contributionFileName(mine, new Date('2026-10-27T10:00:00Z'), 'ab12')).toBe('knowledge/contributions/2026-10-27-2-plugins-ab12.md');
  });
});

describe('parseContribution refuses', () => {
  const ok = '["plugin-knowledge"]';
  it.each([
    ['a user:: key', header('user::plugins::a/b', ok) + '# B', /key must look like/],
    ['a key outside plugins::', header('mixing-lessons::x', ok) + '# B', /key must look like/],
    ['a tag outside the plugin vocabulary', header('plugins::a/b', '["plugin-knowledge","loop::mixing-lessons"]') + '# B', /not allowed/],
    ['tags that are not JSON', header('plugins::a/b', 'plugin-knowledge') + '# B', /JSON array/],
    ['a record without a title', header('plugins::a/b', ok) + 'no title', /title/],
    ['a duplicate key', header('plugins::a/b', ok) + '# B\n\n' + header('plugins::a/b', ok) + '# B', /twice/],
    ['a file without records', 'just text', /No records/],
  ])('%s', (_, text, error) => {
    expect(parseContribution(text).errors.join('\n')).toMatch(error);
  });

  it('keeps Markdown rules inside a record', () => {
    const { records, errors } = parseContribution(header('plugins::a/b', ok) + '# B\n\n---\n\nafter the rule');
    expect(errors).toEqual([]);
    expect(records[0].value).toContain('after the rule');
  });
});
