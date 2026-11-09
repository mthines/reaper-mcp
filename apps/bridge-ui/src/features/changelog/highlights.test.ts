import { describe, expect, it } from 'vitest';
import { parseReleases } from './changelog.js';
import { highlightsFor, parseHighlights } from './highlights.js';

const INDEX = 'https://raw.githubusercontent.com/mthines/reaper-mcp/main/apps/bridge-ui/changelog/highlights.json';
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'drawer',
  pr: 101,
  kind: 'animation',
  group: 'new',
  title: 'What’s new',
  blurb: 'A drawer.',
  media: 'media/drawer.mp4',
  poster: 'media/drawer.webp',
  alt: 'The drawer opening',
  ...over,
});

describe('highlights', () => {
  it('resolves media next to the index', () => {
    const [h] = parseHighlights({ highlights: [entry()] }, INDEX);
    expect(h.media).toBe('https://raw.githubusercontent.com/mthines/reaper-mcp/main/apps/bridge-ui/changelog/media/drawer.mp4');
    expect(h.poster).toMatch(/media\/drawer\.webp$/);
  });

  it('leaves out an entry with anything wrong, keeping the rest', () => {
    const list = [
      entry({ id: 'ok' }),
      entry({ id: 'outside', media: '../secrets.svg' }),
      entry({ id: 'remote', media: 'https://example.com/x.png' }),
      entry({ id: 'no-target', pr: undefined }),
      entry({ id: 'bad-kind', kind: 'gif' }),
      entry({ id: 'video-screenshot', kind: 'screenshot' }),
      entry({ id: 'long', title: 'x'.repeat(61) }),
      null,
    ];
    expect(parseHighlights({ highlights: list }, INDEX).map((h) => h.id)).toEqual(['ok']);
  });

  it('reads anything that is not an index as no highlights', () => {
    expect(parseHighlights({ message: 'Not Found' }, INDEX)).toEqual([]);
    expect(parseHighlights(null, INDEX)).toEqual([]);
  });

  it('shows a highlight on the release that lists its pull request, or on its version', () => {
    const [stable] = parseReleases([
      { tag_name: 'v0.80.0', html_url: 'u', published_at: '2026-11-08T00:00:00Z', body: "## What's Changed\n\n- feat: drawer (#101)\n" },
    ]);
    const highlights = parseHighlights(
      { highlights: [entry({ id: 'by-pr' }), entry({ id: 'by-version', pr: undefined, version: '0.80.0' }), entry({ id: 'other', pr: 7 })] },
      INDEX,
    );
    expect(highlightsFor(stable, highlights).map((h) => h.id)).toEqual(['by-pr', 'by-version']);
  });
});
