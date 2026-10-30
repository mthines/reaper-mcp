import { describe, expect, it } from 'vitest';
import { measurementOf, type CommandEntry } from './status.js';
import { editViewOf } from './edit-views.js';

const entry = (c: string, r: Record<string, unknown>): CommandEntry => ({ n: 1, t: 0, c, ms: 2400, ok: true, r });

describe('sidecar results on the page', () => {
  it('reads an offline analysis, dropping malformed sections and keeping silent bands as gaps', () => {
    const m = measurementOf(entry('analyze_track_offline', {
      name: 'Master', lufs: -10.4, lra: 6.8, sections: [[0, 15, -16.2], [15, 30]], bands: [-15, null, -6], res: [[315, 6.2]],
      ref: { lufs: -8.6, delta: -1.8, bands: [1, null, -2] },
    }));
    expect(m).toEqual({
      kind: 'offline', name: 'Master', lufs: -10.4, lra: 6.8, sections: [[0, 15, -16.2]], bands: [-15, null, -6], res: [[315, 6.2]],
      ref: { lufs: -8.6, delta: -1.8, bands: [1, null, -2] },
    });
  });

  it('draws nothing for an analysis without loudness', () => {
    expect(measurementOf(entry('analyze_audio_file', { name: 'x' }))).toBeNull();
  });

  it('reads an alignment and the aesthetics scores', () => {
    expect(measurementOf(entry('measure_track_alignment', { ref: 'Top', name: 'Btm', delayMs: 0.84, inv: 1, offset: -0.84, phase: 1 })))
      .toEqual({ kind: 'alignment', ref: 'Top', name: 'Btm', delayMs: 0.84, inv: 1, offset: -0.84, phase: 1 });
    expect(measurementOf(entry('analyze_track_aesthetics', { name: 'Mix', pq: 7.4, pc: 5.8, ce: 6.7, cu: 7 })))
      .toEqual({ kind: 'aesthetics', name: 'Mix', pq: 7.4, pc: 5.8, ce: 6.7, cu: 7 });
  });

  it('reads a MIDI CC lane as automation in beats', () => {
    expect(editViewOf(entry('get_midi_cc', { env: 'CC 7 · Volume', unit: 'cc', beats: 1, from: 0, to: 5, count: 2, pts: [[0, 100, 1], [2, 80, 1]], otherCcs: 1 })))
      .toEqual({ kind: 'envelope', env: 'CC 7 · Volume', unit: 'cc', beats: true, from: 0, to: 5, count: 2, pts: [[0, 100, 1], [2, 80, 1]], otherCcs: 1 });
  });
});
