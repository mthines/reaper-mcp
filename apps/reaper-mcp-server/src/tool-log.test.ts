import { describe, expect, it } from 'vitest';
import { aestheticsSummary, alignmentSummary, offlineSummary } from './tool-log.js';

describe('tool results for the status page', () => {
  it('keeps the loudness, sections, band balance and reference deltas of an analysis', () => {
    const r = offlineSummary('Mix', {
      loudness: { integratedLufs: -9.8, loudnessRangeLu: 5.1, truePeakDbtp: -0.4, samplePeakDbfs: -0.9, crestFactorDb: 8.2, durationSeconds: 30, sections: [{ start: 0, end: 10, lufs: -10.2 }] },
      spectrum: { bandBalanceDb: { sub: -14, bass: -4.1, mid: -6 }, resonances: [{ hz: 315, excessDb: 6.2 }], sibilance: { spikeCount: 3 } },
      reference: { referenceIntegratedLufs: -8, loudnessDeltaLu: -1.8, bandDeltaDb: { bass: 2.5 } },
    });
    expect(r).toEqual({
      name: 'Mix', lufs: -9.8, lra: 5.1, tp: -0.4, peak: -0.9, crest: 8.2, dur: 30,
      sections: [[0, 10, -10.2]],
      bands: [-14, -4.1, null, -6, null, null, null],
      res: [[315, 6.2]], sib: 3,
      ref: { lufs: -8, delta: -1.8, bands: [null, 2.5, null, null, null, null, null] },
    });
  });

  it('survives a result missing whole sections', () => {
    expect(offlineSummary('x', {})).toMatchObject({ name: 'x', sections: [], res: [], bands: [null, null, null, null, null, null, null] });
  });

  it('keeps the delay, polarity and suggested fix of an alignment', () => {
    expect(alignmentSummary({ referenceName: 'Top', trackName: 'Bottom', delayMs: 0.84, delaySamples: 37, correlation: 0.93, polarityInverted: true, currentPlayOffsetMs: 0, suggestedPlayOffsetMs: -0.84, suggestedPhase: 1 }))
      .toEqual({ ref: 'Top', name: 'Bottom', delayMs: 0.84, samples: 37, corr: 0.93, inv: 1, cur: 0, offset: -0.84, phase: 1 });
  });

  it('keeps the four aesthetics scores', () => {
    expect(aestheticsSummary({ trackName: 'Mix', productionQuality: 7.1, productionComplexity: 5, contentEnjoyment: 6.4, contentUsefulness: 6.9, normalizedToLufs: -18, durationSeconds: 30 }))
      .toEqual({ name: 'Mix', pq: 7.1, pc: 5, ce: 6.4, cu: 6.9, lufs: -18, dur: 30 });
  });
});
