import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GALLERY_NOW, SNAPSHOT_STORIES } from './gallery-stories.js';
import { SnapshotsView } from './SnapshotsView.js';

// Every tab body is the log panel's flex child, so only `.rows` (flex: 1; overflow-y: auto) lets a long list scroll
const rootClasses = (html: string) => (/^<div class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');

describe('the snapshots tab', () => {
  it('scrolls inside the log panel, in every state', () => {
    for (const s of SNAPSHOT_STORIES) {
      const html = renderToStaticMarkup(
        <SnapshotsView feed={s.feed} request={s.request} blocked={s.blocked} now={GALLERY_NOW} onSend={vi.fn()} keys={false} />,
      );
      expect(rootClasses(html), s.title).toContain('rows');
    }
  });
});
