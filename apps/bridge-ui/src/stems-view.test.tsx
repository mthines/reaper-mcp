import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasurementView } from './Measurement.js';
import type { CommandEntry } from './status.js';

const view = (stems: unknown[]) => {
  const entry = { n: 1, t: 0, c: 'separate_stems', ms: 1, ok: true, r: { model: 'htdemucs', device: 'cpu', secs: 30, proc: 20, stems } } as CommandEntry;
  return renderToStaticMarkup(<MeasurementView entry={entry} history={[]} now={0} onPick={() => undefined} />);
};

describe('separated stems', () => {
  it('shows a silent stem as silent, without a loudness unit', () => {
    const html = view([['drums', -14.2, -1.8], ['piano', null, null]]);
    expect(html).toContain('<b>−14.2</b> LUFS');
    expect(html).toContain('<b>silent</b>');
    expect(html).not.toContain('silent</b> LUFS');
  });
});
