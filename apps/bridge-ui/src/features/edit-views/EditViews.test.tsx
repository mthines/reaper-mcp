import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditView } from './index.js';
import { editViewOf, focusOf } from './edit-views.js';
import type { CommandEntry } from '../../lib/commands.js';

const drawer = (c: string, r: Record<string, unknown>) => {
  const entry = { n: 1, t: 0, c, ms: 1, ok: true, r } as CommandEntry;
  return renderToStaticMarkup(<EditView.Section entry={entry} />);
};

describe('edit views in the drawer', () => {
  it('names a switch row by the words the bridge sent: automation modes and freeze', () => {
    const modes = drawer('set_automation_mode', { rows: [{ t: 'Vox', p: 'Automation', s: 'bool', a: 1, b: 4, at: 'read', bt: 'latch' }] });
    expect(modes).toContain('read');
    expect(modes).toContain('latch');
    const frozen = drawer('freeze_tracks', { rows: [{ t: 'Gtr', p: 'Freeze', s: 'bool', a: 0, b: 1, bt: 'frozen · stereo' }] });
    expect(frozen).toContain('live');
    expect(frozen).toContain('frozen · stereo');
  });

  it('titles a card by what it shows and marks a read-only listing as how things are, not a change', () => {
    const pins = drawer('get_fx_pins', { fx: 'ReaComp', ch: 2, in: [[1], [2]], out: [[1], [2]] });
    expect(pins).toContain('>Plugin pins<');
    expect(pins).toContain('as it is now');
    expect(pins).not.toContain('before → after');
  });
  it('counts the lanes past the drawn ones', () => {
    const html = drawer('get_track_lanes', { t: 'Vox', fixed: 1, lanes: [['Take 1', 1], ['Take 2', 0]], items: [], len: 4, more: 8 });
    expect(html).toContain('+8 more lanes not drawn');
    expect(html).toContain('>10<');
  });
  it('compares two tracks with the same name each with its own state before', () => {
    const html = drawer('set_track_record', {
      mode: 'normal',
      rows: [['Gtr', 1, 'In 1', 'auto', 'input'], ['Gtr', 1, 'In 2', 'auto', 'input']],
      was: { mode: 'normal', rows: [['Gtr', 0, 'In 1', 'auto', 'input'], ['Gtr', 1, 'In 2', 'auto', 'input']] },
    });
    expect(html).toContain('(was not armed)');
    expect(html).not.toMatch(/<s[ >]/);
  });
});

describe('where a timeline looks', () => {
  const timeline = (r: Record<string, unknown>) => editViewOf({ n: 1, t: 0, c: 'remove_time', ms: 1, ok: true, r } as CommandEntry);
  const base = { len: 200, regions: [], markers: [], tempo: [] };

  it('focuses on a cut with room around it, not the whole project', () => {
    const v = timeline({ ...base, op: 'remove', span: [144, 160] });
    expect(v?.kind === 'timeline' && focusOf(v, 200)).toEqual([136, 168]);
  });

  it('focuses on the edge a trim moved, not the length of the item', () => {
    const v = editViewOf({ n: 1, t: 0, c: 'trim_media_item', ms: 1, ok: true, r: { ...base, lanes: [{ t: 'Drums', items: [[12, 170, 0, 0, 0, 0]], was: [[10, 172, 0, 0, 0, 0]] }] } } as CommandEntry);
    expect(v?.kind === 'timeline' && focusOf(v, 200)).toEqual([2, 20]);
  });

  it('shows everything when the change fills most of the project, or nothing changed', () => {
    const wide = timeline({ ...base, op: 'remove', span: [10, 190] });
    expect(wide?.kind === 'timeline' && focusOf(wide, 200)).toBeNull();
    const listing = timeline({ ...base, markers: [[30, 'Drop', '', 1]] });
    expect(listing?.kind === 'timeline' && focusOf(listing, 200)).toBeNull();
  });
});
