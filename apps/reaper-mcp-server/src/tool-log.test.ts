import { describe, expect, it } from 'vitest';
import { aestheticsSummary, alignmentSummary, curveSummary, maskingSummary, offlineSummary, stemsSummary, stereoBandsSummary } from './tool-log.js';

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

  it('keeps the short-term curve, headline numbers and spans of a loudness curve, capped at 240 points', () => {
    const r = curveSummary('Master', {
      integratedLufs: -9.5, truePeakDbtp: -0.6, loudnessRangeLu: 4.2, plrDb: 8.9, maxMomentaryLufs: -6.1, targetLufs: -14, startTime: 60,
      shortTerm: { step: 1, lufs: Array.from({ length: 300 }, (_, i) => -20 + (i % 10)) },
      momentary: { step: 0.25, lufs: [-1] },
      loudest: { start: 62, end: 65, lufs: -8 }, quietest: { start: 60, end: 63, lufs: -14 },
      overTarget: [{ start: 61.5, end: 66, maxLufs: -8 }],
    });
    expect(r).toMatchObject({ name: 'Master', lufs: -9.5, tp: -0.6, lra: 4.2, plr: 8.9, maxM: -6.1, target: -14, start: 60, step: 1, term: 's',
      loud: [62, 65, -8], quiet: [60, 63, -14], over: [[61.5, 66, -8]] });
    expect((r['curve'] as number[]).length).toBe(240);
  });

  it('falls back to the momentary curve for a clip too short for short-term loudness', () => {
    expect(curveSummary('x', { momentary: { step: 0.1, lufs: [-20, null] } })).toMatchObject({ term: 'm', curve: [-20, -70], over: [], loud: null });
  });

  it('keeps each stereo band as a row and the flags', () => {
    expect(stereoBandsSummary('Mix', { bands: [{ band: 'low', correlation: -0.8, worst: -0.95, negativeShare: 0.9, sideToMidDb: 3 }, { band: 'air', silent: true }], flags: ['low end wide'], durationSeconds: 30 }))
      .toEqual({ name: 'Mix', bands: [['low', -0.8, -0.95, 0.9, 3], ['air', null, null, null, null]], flags: ['low end wide'], dur: 30 });
  });

  it('keeps the ten most masked pairs, most masked first, and the top conflicts', () => {
    const pairs = Array.from({ length: 12 }, (_, i) => ({ a: `A${i}`, b: 'B', overall: i / 20, scores: [i / 20] }));
    const r = maskingSummary({ tracks: ['A', 'B'], bandsHz: [100], pairs, conflicts: [{ a: 'A', b: 'B', hz: 100, score: 0.9, suggestion: 'cut A around 100 Hz' }] });
    expect((r['pairs'] as unknown[]).length).toBe(10);
    expect((r['pairs'] as unknown[][])[0]).toEqual(['A11', 'B', 0.55, [0.55]]);
    expect(r['conflicts']).toEqual([['A', 'B', 100, 0.9, 'cut A around 100 Hz']]);
  });

  it('keeps each stem\'s loudness and peak, and how many tracks were inserted', () => {
    expect(stemsSummary('Mix', { model: 'htdemucs', device: 'mps', seconds: 20, processingSeconds: 8, stems: [{ stem: 'drums', lufs: -16, peakDbfs: -1 }], inserted: { folderName: 'Mix stems', tracks: [{}] } }))
      .toEqual({ name: 'Mix', model: 'htdemucs', device: 'mps', secs: 20, proc: 8, stems: [['drums', -16, -1]], inserted: 1, folder: 'Mix stems' });
  });
});
