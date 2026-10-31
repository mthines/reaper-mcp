import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditView } from './index.js';
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

  it('heads a read-only listing as a result, not a change', () => {
    const pins = drawer('get_fx_pins', { fx: 'ReaComp', ch: 2, in: [[1], [2]], out: [[1], [2]] });
    expect(pins).toContain('Result');
    expect(pins).not.toContain('>Change<');
  });
});
