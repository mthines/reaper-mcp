import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasurementView } from './Measurement.js';
import type { CommandEntry } from './status.js';

const keyCall = (n: number, conf: number) =>
  ({ n, t: n * 1000, c: 'detect_key', ms: 1, ok: true, r: { key: 'A minor', tonic: 'A', mode: 'minor', r: 0.8, conf, chroma: [1, 0, 0, 0, 0.5, 0, 0, 0.6, 0, 0.9, 0, 0] } }) as CommandEntry;

describe('key result', () => {
  it('shows the previous call\'s confidence in percent, like the readout', () => {
    const now = keyCall(2, 0.6);
    const html = renderToStaticMarkup(<MeasurementView entry={now} history={[now, keyCall(1, 0.45)]} now={5000} onPick={() => {}} />);
    expect(html).toContain('Confidence 45 %');
    expect(html).toContain('+15');
    expect(html).not.toContain('0.45');
  });
});
