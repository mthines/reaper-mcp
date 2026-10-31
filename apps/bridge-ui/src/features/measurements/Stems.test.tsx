import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasurementView } from './Measurement.js';
import type { CommandEntry } from '../../lib/commands.js';

const view = (stems: unknown[], extra: Record<string, unknown> = {}) => {
  const entry = { n: 1, t: 0, c: 'separate_stems', ms: 1, ok: true, r: { model: 'htdemucs', device: 'cpu', secs: 30, proc: 20, stems, ...extra } } as CommandEntry;
  return renderToStaticMarkup(<MeasurementView entry={entry} history={[]} now={0} onPick={() => undefined} />);
};

describe('separated stems', () => {
  it('shows a silent stem as silent, without a loudness unit', () => {
    const html = view([['drums', -14.2, -1.8], ['piano', null, null]]);
    expect(html).toContain('<b>−14.2</b> LUFS');
    expect(html).toContain('<b>silent</b>');
    expect(html).not.toContain('silent</b> LUFS');
  });

  it('says the inserted stems start muted', () => {
    expect(view([['drums', -14.2, -1.8]], { inserted: 4, folder: 'Mix stems', muted: 1 })).toContain('4 tracks added under “Mix stems”, muted');
  });
});
