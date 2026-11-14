import { describe, expect, it } from 'vitest';
import { SHARE, withShareMeta, type SharePage } from './share-meta.js';

const page = '<!doctype html><head><title>MCP Bridge</title><meta name="theme-color" content="#000"></head><body></body>';

describe('share tags', () => {
  it('give every kind of page its own title and an absolute picture', () => {
    const titles = new Set<string>();
    for (const kind of Object.keys(SHARE) as SharePage[]) {
      const out = withShareMeta(page, kind, 'https://example.test');
      expect(out).toContain(`<meta property="og:image" content="https://example.test/share/og-${kind}.png">`);
      expect(out).toContain('name="twitter:card" content="summary_large_image"');
      expect(out).toContain('<meta name="theme-color" content="#000">'); // the rest of the head is kept
      titles.add(out.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
    }
    expect(titles.size).toBe(3);
  });

  it('names the home page as canonical but leaves guides and releases to their own link', () => {
    expect(withShareMeta(page, 'bridge', 'https://example.test')).toContain('property="og:url" content="https://example.test/"');
    expect(withShareMeta(page, 'docs', 'https://example.test')).not.toContain('og:url');
    expect(withShareMeta(page, 'changelog', 'https://example.test')).not.toContain('og:url');
  });

  it('refuses a page it cannot put the tags into', () => {
    expect(() => withShareMeta('<head></head>', 'docs', 'https://example.test')).toThrow(/no <title>/);
  });

  it('keeps a quote in the text from breaking out of the attribute', () => {
    const out = withShareMeta(page, 'changelog', 'https://example.test"><script>');
    expect(out).not.toContain('"><script>');
  });
});
