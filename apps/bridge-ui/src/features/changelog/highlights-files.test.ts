import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_PATH, parseHighlights } from './highlights.js';

// The committed highlights the page fetches from main: every entry valid, its media present, small and safe
const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../changelog');
const index = JSON.parse(readFileSync(join(DIR, 'highlights.json'), 'utf8'));
const entries: Record<string, unknown>[] = index.highlights;
const KB = 1024;
const LIMIT: Record<string, number> = { svg: 60 * KB, webp: 400 * KB, png: 600 * KB, mp4: 1500 * KB, webm: 1500 * KB };

describe('changelog/highlights.json', () => {
  it('is version 1 with unique ids', () => {
    expect(index.version).toBe(1);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no entry the page would leave out', () => {
    expect(parseHighlights(index, 'https://example.com/changelog/highlights.json')).toHaveLength(entries.length);
  });

  for (const e of entries) {
    describe(String(e.id), () => {
      const files = [e.media, e.poster].filter((f): f is string => typeof f === 'string');

      it('keeps its media present and within the size limit', () => {
        for (const f of files) {
          expect(f).toMatch(MEDIA_PATH);
          const size = statSync(join(DIR, f)).size;
          expect(size, `${f} is ${Math.round(size / KB)} KB`).toBeLessThanOrEqual(LIMIT[f.split('.').pop() as string]);
        }
      });

      it('gives an animation a still for reduced motion', () => {
        if (e.kind === 'animation') expect(e.poster).toBeTruthy();
      });

      it('draws an SVG with no script, link or outside resource', () => {
        for (const f of files.filter((x) => x.endsWith('.svg'))) {
          const svg = readFileSync(join(DIR, f), 'utf8');
          expect(svg).toMatch(/<svg[^>]*viewBox="0 0 1600 1000"/);
          expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:href|src)\s*=\s*["'](?!#)|@import|url\((?!#)/i);
        }
      });
    });
  }
});
