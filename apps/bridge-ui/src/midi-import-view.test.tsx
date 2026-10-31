import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditViewSection } from './EditViews.js';
import type { CommandEntry } from './status.js';

const view = (r: Record<string, unknown>) =>
  renderToStaticMarkup(<EditViewSection entry={{ n: 1, t: 0, c: 'import_midi_file', ms: 1, ok: true, r } as CommandEntry} />);
const notes = [[0, 1, 60, 100, 1], [1, 1, 64, 100, 1]];

describe('MIDI import view', () => {
  it('says how many other imported items it does not draw', () => {
    expect(view({ notes, total: 2, beats: 4, more: 0, items: 2 })).toContain('+2 more imported items not drawn');
  });

  it('says nothing more for a one-item import', () => {
    expect(view({ notes, total: 2, beats: 4, more: 0 })).not.toContain('imported item');
  });
});
