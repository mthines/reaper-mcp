import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupGuides, neighbours, pageHeadings, parseGuide, renderLlmsFull, renderLlmsTxt, sortGuides, type Guide } from './docs.js';

const file = (extra = '', body = '## Hello\n\nText.') =>
  `---\ntitle: Install\nsummary: Get it running.\nsection: start\norder: 3\n${extra}---\n\n${body}\n`;

describe('parseGuide', () => {
  it('reads a guide with its video and poster', () => {
    const g = parseGuide('install', file('youtube: dQw4w9WgXcQ\nposter: media/install.webp\nduration: 3 min\n'));
    expect(g).toMatchObject({ slug: 'install', title: 'Install', section: 'start', order: 3, youtube: 'dQw4w9WgXcQ', poster: 'media/install.webp', duration: '3 min' });
    expect(g.body.startsWith('## Hello')).toBe(true);
  });

  it('refuses what would break the site, naming the guide', () => {
    expect(() => parseGuide('install', 'no frontmatter')).toThrow(/guide "install": missing frontmatter/);
    expect(() => parseGuide('Install', file())).toThrow(/file name/);
    expect(() => parseGuide('install', file().replace('section: start', 'section: nope'))).toThrow(/section must be one of/);
    expect(() => parseGuide('install', file().replace('order: 3', 'order: x'))).toThrow(/order/);
    expect(() => parseGuide('install', file('youtube: https://youtu.be/abc\n'))).toThrow(/video id, not a URL/);
    expect(() => parseGuide('install', file('poster: https://x.test/a.png\n'))).toThrow(/under media/);
    expect(() => parseGuide('install', file('', ''))).toThrow(/empty/);
  });
});

const g = (slug: string, section: Guide['section'], order: number): Guide => ({ slug, title: slug, summary: `About ${slug}.`, section, order, body: 'x' });

describe('reading order', () => {
  const guides = [g('c', 'try', 1), g('b', 'start', 2), g('a', 'start', 1), g('d', 'know', 1)];

  it('lists sections in their fixed order and guides by order within them', () => {
    expect(sortGuides(guides).map((x) => x.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(groupGuides(guides).map((s) => [s.title, s.guides.map((x) => x.slug)])).toEqual([
      ['Getting started', ['a', 'b']],
      ['Things to try', ['c']],
      ['Reference', ['d']],
    ]);
  });

  it('knows the guide before and after, across sections, and nothing for an unknown slug', () => {
    expect(neighbours(guides, 'b')).toMatchObject({ previous: { slug: 'a' }, next: { slug: 'c' } });
    expect(neighbours(guides, 'a').previous).toBeUndefined();
    expect(neighbours(guides, 'd').next).toBeUndefined();
    expect(neighbours(guides, 'nope')).toEqual({});
  });
});

describe('pageHeadings', () => {
  it('lists ## headings with anchors and ignores the ones inside code', () => {
    const body = '## Say this\n\ntext\n\n```md\n## not a heading\n```\n\n## What `happens` next\n\n### Small one';
    expect(pageHeadings(body)).toEqual([
      { id: 'say-this', text: 'Say this' },
      { id: 'what-happens-next', text: 'What happens next' },
    ]);
  });
});

describe('llms.txt', () => {
  const guides = [g('install', 'start', 1), g('critique', 'try', 1)];

  it('lists every guide under its section with a link to the raw Markdown', () => {
    const out = renderLlmsTxt(guides, 'https://example.test');
    expect(out).toContain('## Getting started');
    expect(out).toContain('- [install](https://example.test/docs/install.md): About install.');
    expect(out).toContain('- [critique](https://example.test/docs/critique.md): About critique.');
    expect(out.indexOf('Getting started')).toBeLessThan(out.indexOf('Things to try'));
  });

  it('puts every guide in the full file, in reading order', () => {
    const out = renderLlmsFull([g('critique', 'try', 1), g('install', 'start', 1)]);
    expect(out.indexOf('# install')).toBeLessThan(out.indexOf('# critique'));
  });
});

// The real guides in docs/guides: the checks that keep the site from shipping a broken page
describe('the guides in docs/guides', () => {
  const dir = join(__dirname, '../../../../../docs/guides');
  const guides = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'CLAUDE.md')
    .map((f) => parseGuide(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf-8')));
  const slugs = new Set(guides.map((x) => x.slug));

  it('has a unique position in every section', () => {
    const seen = new Set<string>();
    for (const x of guides) {
      const at = `${x.section}:${x.order}`;
      expect(seen.has(at), `two guides at ${at}`).toBe(false);
      seen.add(at);
    }
  });

  it('only links to guides and images that exist', () => {
    for (const x of guides) {
      for (const m of x.body.matchAll(/(?<!!)\[[^\]]+\]\(([a-z0-9-]+)\.md(#[\w-]+)?\)/g)) expect(slugs.has(m[1]), `${x.slug} links to missing guide ${m[1]}`).toBe(true);
      for (const m of x.body.matchAll(/!\[[^\]]*\]\((media\/[^)\s]+)\)/g)) expect(existsSync(join(dir, m[1])), `${x.slug} uses missing image ${m[1]}`).toBe(true);
      if (x.poster) expect(existsSync(join(dir, x.poster)), `${x.slug} has a missing poster`).toBe(true);
    }
  });

  it('gives every recipe a prompt to copy and a line on what stays the user\'s call', () => {
    for (const x of guides.filter((g) => g.section === 'try')) {
      expect(x.body, `${x.slug} needs "> say:"`).toMatch(/^> say: .+/m);
      expect(x.body, `${x.slug} needs "> your-call:"`).toMatch(/^> your-call: .+/m);
    }
  });

  it('keeps emoji out of the pages and every guide short enough to read', () => {
    for (const x of guides) {
      expect(x.body, `${x.slug} has an emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(x.body.split(/\s+/).length, `${x.slug} is long`).toBeLessThan(900);
    }
  });
});
