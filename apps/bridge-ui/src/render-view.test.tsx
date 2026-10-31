import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditViewSection } from './EditViews.js';
import type { CommandEntry } from './status.js';

const view = (r: Record<string, unknown>) =>
  renderToStaticMarkup(<EditViewSection entry={{ n: 1, t: 0, c: 'render_project', ms: 1, ok: true, r } as CommandEntry} />);
// A file rendered 4 LU louder than a -14 target
const loud = { fmt: 'wav', src: 'master', nt: -14, groups: [{ v: '', m: [], f: [['song.wav', 200, -10, -1.5, -1.6, [], []]] }] };
const lufsZone = (html: string) => html.match(/ev-render-lufs mono zone-(\w+)/)?.[1];

describe('render result loudness grading', () => {
  it('marks a file off an integrated LUFS target', () => {
    expect(lufsZone(view({ ...loud, norm: 'lufs_i' }))).toBe('hot');
  });

  it('does not grade integrated loudness against a momentary or short-term max target', () => {
    expect(lufsZone(view({ ...loud, norm: 'lufs_m_max' }))).toBe('ok');
    expect(lufsZone(view({ ...loud, norm: 'lufs_s_max' }))).toBe('ok');
  });
});
