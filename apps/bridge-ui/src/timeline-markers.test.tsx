import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditViewSection } from './EditViews.js';
import type { CommandEntry } from './status.js';

const view = (c: string, r: Record<string, unknown>) =>
  renderToStaticMarkup(<EditViewSection entry={{ n: 1, t: 0, c, ms: 1, ok: true, r } as CommandEntry} />);
const markers = [[8, 'Drop', '', 1], [40, 'Outro', '', 2]];
const tempo = [[0, 120, 4, 4, 0]];
// A marker whose name is hidden until hovered carries `ev-quiet`
const quiet = (html: string) => (html.match(/class="ev-marker[^"]*ev-quiet/g) ?? []).length;

describe('marker names on the timeline', () => {
  it('labels the markers when they are what the call is about', () => {
    const html = view('list_markers', { regions: [], markers, tempo, len: 60 });
    expect(quiet(html)).toBe(0);
    expect(html).toContain('<b>Drop</b>');
  });

  it('keeps marker names for hover when the call is about items or the selection', () => {
    const items = view('list_media_items', { regions: [], markers, tempo, len: 60, lanes: [{ t: 'Keys', items: [[0, 4, 0, 0, 1, 0]] }] });
    expect(quiet(items)).toBe(2);
    expect(items).toContain('title="Drop at');
    const selection = view('set_time_selection', { regions: [], markers, tempo, len: 60, sel: [8, 16] });
    expect(quiet(selection)).toBe(2);
  });
});
