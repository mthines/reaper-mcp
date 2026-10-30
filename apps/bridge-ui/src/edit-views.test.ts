import { describe, expect, it } from 'vitest';
import { editViewOf, timelineDiff, type Marker } from './edit-views.js';
import type { CommandEntry } from './status.js';

const entry = (c: string, r: Record<string, unknown> | undefined, ok = true): CommandEntry => ({ n: 1, t: 0, c, ms: 1, ok, r });

describe('edit views from the log', () => {
  it('reads a change as before and after', () => {
    expect(editViewOf(entry('set_track_property', { rows: [{ t: 'Kick', p: 'volume', s: 'db', a: -6, b: -4.5 }] }))).toEqual({
      kind: 'changes',
      rows: [{ t: 'Kick', p: 'volume', s: 'db', a: -6, b: -4.5 }],
    });
  });

  it('draws nothing for a failed call, another command, or an entry from an older bridge', () => {
    expect(editViewOf(entry('set_track_property', { rows: [{ t: 'Kick', p: 'volume', s: 'db', b: 0 }] }, false))).toBeNull();
    expect(editViewOf(entry('get_project_info', { rows: [] }))).toBeNull();
    expect(editViewOf(entry('list_tracks', undefined))).toBeNull();
  });

  it('drops malformed rows and keeps the rest', () => {
    const v = editViewOf(entry('get_midi_notes', { total: 3, notes: [[60, 0, 1, 100, 0], ['x'], [62, 1, 1, 90, 1]] }));
    expect(v).toMatchObject({ kind: 'midi', total: 3, more: 0, notes: [[60, 0, 1, 100, 0], [62, 1, 1, 90, 1]] });
  });

  it('keeps the timeline before a write, for comparison', () => {
    const v = editViewOf(entry('add_marker', {
      regions: [], markers: [[8, 'Drop', '', 2]], tempo: [[0, 120, 4, 4, 0]], len: 16,
      was: { regions: [], markers: [], tempo: [[0, 120, 4, 4, 0]] },
    }));
    expect(v).toMatchObject({ kind: 'timeline', len: 16, markers: [[8, 'Drop', '', 2]], was: { markers: [] } });
  });
});

describe('what a timeline write changed', () => {
  it('finds the marks added or moved, and the ones removed', () => {
    const intro: Marker = [0, 'Intro', '', 1];
    const drop: Marker = [80, 'Drop', '', 2];
    const moved: Marker = [84, 'Drop', '', 2];
    const { added, removed } = timelineDiff([intro, moved], [intro, drop]);
    expect([...added]).toEqual([moved]);
    expect(removed).toEqual([drop]);
  });

  it('marks nothing on a listing', () => {
    const { added, removed } = timelineDiff<Marker>([[0, 'Intro', '', 1]], undefined);
    expect(added.size).toBe(0);
    expect(removed).toEqual([]);
  });
});
