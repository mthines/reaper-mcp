import { describe, expect, it } from 'vitest';
import { editViewOf, fittingLabels, listDiff, routeIds, timelineDiff, type Marker, type Route } from './edit-views.js';
import type { CommandEntry } from './status.js';

const entry = (c: string, r: Record<string, unknown> | undefined, ok = true): CommandEntry => ({ n: 1, t: 0, c, ms: 1, ok, r });

describe('edit views from the log', () => {
  it('reads a record change with the state before it, dropping malformed rows', () => {
    expect(editViewOf(entry('set_track_record', {
      mode: 'normal', path: 'Audio', rows: [['Vox', 1, 'In 3/4', 'auto', 'input'], ['bad']],
      was: { mode: 'normal', path: 'Audio', rows: [['Vox', 0, 'In 1', 'off', 'input']] },
    }))).toEqual({
      kind: 'record', mode: 'normal', path: 'Audio', rows: [['Vox', 1, 'In 3/4', 'auto', 'input']],
      was: { mode: 'normal', path: 'Audio', rows: [['Vox', 0, 'In 1', 'off', 'input']] },
    });
    expect(editViewOf(entry('set_record_mode', { path: 'x' }))).toBeNull();
  });

  it('reads lanes with a comp and what played before', () => {
    expect(editViewOf(entry('comp_lanes', {
      t: 'Vox', fixed: 1, lanes: [['Take 1', 0], ['Comp', 1]], items: [[0, 4, 0, 0], [0, 4, 1, 0]], len: 4,
      comp: 1, segs: [[0, 4, 0]], was: { fixed: 1, lanes: [['Take 1', 1]], items: [[0, 4, 0, 0]] },
    }))).toEqual({
      kind: 'lanes', t: 'Vox', fixed: true, lanes: [['Take 1', 0], ['Comp', 1]], items: [[0, 4, 0, 0], [0, 4, 1, 0]], len: 4,
      comp: 1, segs: [[0, 4, 0]], was: { fixed: true, lanes: [['Take 1', 1]], items: [[0, 4, 0, 0]] },
    });
  });

  it('reads a change as before and after', () => {
    expect(editViewOf(entry('set_track_property', { rows: [{ t: 'Kick', p: 'volume', s: 'db', a: -6, b: -4.5 }] }))).toEqual({
      kind: 'changes',
      rows: [{ t: 'Kick', p: 'volume', s: 'db', a: -6, b: -4.5 }],
    });
  });

  it('reads automation items and their pools, dropping malformed ones', () => {
    const v = editViewOf(entry('insert_automation_item', {
      env: 'Volume', unit: 'dB', from: 0, to: 40, pts: [[0, 0, 0]], count: 1, ai: 1,
      ais: [[10, 4, 7, 'Vox Chorus'], [30, 4, 7, 'Vox Chorus'], ['x']],
      pools: [[7, [[0, -1, 0], [4, -1, 0]]], ['bad']],
      wasAis: [[10, 4, 7, 'Vox Chorus']], wasPools: [[7, [[0, -1, 0]]]],
    }));
    expect(v).toMatchObject({
      kind: 'envelope', ai: 1,
      ais: [[10, 4, 7, 'Vox Chorus'], [30, 4, 7, 'Vox Chorus']],
      pools: [[7, [[0, -1, 0], [4, -1, 0]]]],
      wasAis: [[10, 4, 7, 'Vox Chorus']],
    });
    expect(editViewOf(entry('get_envelope_points', { env: 'Pan', unit: 'pan', from: 0, to: 4, pts: [], count: 0 }))).not.toHaveProperty('ais');
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

describe('fittingLabels', () => {
  it('keeps every label when they have room', () => {
    expect(fittingLabels([[0, 'Intro'], [0.5, 'Verse']], 400)).toEqual(new Set([0, 1]));
  });

  it('leaves out a label that would run into the one before it', () => {
    // 'Verse' needs ~38px; the next marker is 10px along on a 200px lane
    expect(fittingLabels([[0, 'Verse'], [0.05, 'Chorus'], [0.5, 'Bridge']], 200)).toEqual(new Set([0, 2]));
  });

  it('gives changed markers their label first', () => {
    expect(fittingLabels([[0, 'Verse'], [0.05, 'Drop']], 200, new Set([1]))).toEqual(new Set([1]));
  });

  it('shows more labels on a wider lane', () => {
    const marks: Array<[number, string]> = Array.from({ length: 12 }, (_, i) => [i / 12, `Mark ${i}`]);
    expect(fittingLabels(marks, 260).size).toBeLessThan(fittingLabels(marks, 900).size);
  });
});

describe('listDiff', () => {
  const id = (t: [string, string]) => t[0];
  const same = (a: [string, string], b: [string, string]) => a[1] === b[1];

  it('marks what a call added, changed in place and removed', () => {
    const { change, removed } = listDiff<[string, string]>(
      [['eq', ''], ['comp', 'B'], ['sat', '']],
      [['eq', ''], ['comp', ''], ['deess', '']],
      id, same,
    );
    expect([...change]).toEqual([[1, 'changed'], [2, 'new']]);
    expect(removed).toEqual([[2, ['deess', '']]]);
  });

  it('marks only the entry that moved, not the ones it passed', () => {
    const { change } = listDiff<[string, string]>([['c', ''], ['a', ''], ['b', '']], [['a', ''], ['b', ''], ['c', '']], id, same);
    expect([...change]).toEqual([[0, 'moved']]);
  });

  it('marks nothing without a before', () => {
    expect(listDiff<[string, string]>([['a', '']], undefined, id, same)).toEqual({ change: new Map(), removed: [] });
  });
});

describe('new edit views', () => {
  it('reads an FX chain before and after, dropping malformed slots', () => {
    const v = editViewOf(entry('set_fx_enabled', { chains: [{ t: 'Vox', fx: [['ReaEQ', 'B', 'a1', ''], ['bad']], was: [['ReaEQ', '', 'a1', '']] }] }));
    expect(v).toEqual({ kind: 'fxChain', chains: [{ t: 'Vox', fx: [['ReaEQ', 'B', 'a1', '']], was: [['ReaEQ', '', 'a1', '']] }] });
  });

  it('reads routes and keeps two sends to the same place apart', () => {
    const routes: Route[] = [['s', 'Verb', -12, 0, ''], ['s', 'Verb', -6, 0, '']];
    expect(editViewOf(entry('get_track_routing', { t: 'Vox', routes }))).toEqual({ kind: 'routing', t: 'Vox', routes });
    expect(routeIds(routes)).toEqual(['s:Verb#1', 's:Verb#2']);
  });

  it('reads item lanes and the time selection on the timeline', () => {
    const v = editViewOf(entry('move_media_item', { tempo: [[0, 120, 4, 4, 0]], len: 20, lanes: [{ t: 'Gtr', items: [[4, 2, 0, 0, 0, 0]], was: [[0, 2, 0, 0, 0, 0]] }] }));
    expect(v).toMatchObject({ kind: 'timeline', lanes: [{ t: 'Gtr', items: [[4, 2, 0, 0, 0, 0]], was: [[0, 2, 0, 0, 0, 0]] }] });
    const t = editViewOf(entry('set_cursor_position', { tempo: [[0, 120, 4, 4, 0]], len: 20, cur: 8, wasCur: 2 }));
    expect(t).toMatchObject({ cur: 8, wasCur: 2, wasSel: null });
  });

  it('diffs a structure edit only when ids match the tracks', () => {
    const row = ['Kick', 0, '', 0, 0, ''];
    const ok = editViewOf(entry('add_track', { tracks: [row, row], total: 2, ids: ['a', 'b'], was: { tracks: [row], ids: ['a'] } }));
    expect(ok).toMatchObject({ ids: ['a', 'b'], was: { ids: ['a'] } });
    const short = editViewOf(entry('add_track', { tracks: [row, row], total: 2, ids: ['a'], was: { tracks: [row], ids: ['a'] } }));
    expect(short).not.toHaveProperty('was');
  });

  it('keeps where a windowed mixer starts in a big project', () => {
    const row = ['Kick', 0, '', 0, 0, ''];
    const windowed = editViewOf(entry('add_track', { tracks: [row, row], total: 123, from: 117, ids: ['a', 'b'], was: { tracks: [row], ids: ['a'] } }));
    expect(windowed).toMatchObject({ from: 117, total: 123 });
    expect(editViewOf(entry('list_tracks', { tracks: [row], total: 1 }))).not.toHaveProperty('from');
  });
});
