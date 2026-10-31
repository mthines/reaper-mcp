import { describe, expect, it } from 'vitest';
import { editViewOf, fittingLabels, listDiff, normalizedGains, routeIds, timelineDiff, type Marker, type Route } from './edit-views.js';
import type { CommandEntry } from '../../lib/commands.js';

const entry = (c: string, r: Record<string, unknown> | undefined, ok = true): CommandEntry => ({ n: 1, t: 0, c, ms: 1, ok, r });

describe('edit views from the log', () => {
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

  it('render view: reads a render as file rows with their targets, versions grouped', () => {
    const f = ['mix.wav', 184.2, -14.1, -1, -1.4, [0.5, 0.6], [-0.5, -0.6]];
    expect(editViewOf(entry('render_project', { fmt: 'wav', bd: '24', src: 'master', norm: 'lufs_i', nt: -14, lim: -1, tp: true, groups: [{ v: '', m: [], f: [f, ['bad']] }] }))).toEqual({
      kind: 'render', fmt: 'wav', bd: '24', src: 'master', norm: 'lufs_i', nt: -14, lim: -1, tp: true, groups: [{ v: '', m: [], f: [f] }],
    });
    const v = editViewOf(entry('render_versions', { fmt: 'mp3', kbps: 320, src: 'master', groups: [{ v: 'Instrumental', m: ['Vox'], f: [f] }], more: 2 }));
    expect(v).toMatchObject({ kind: 'render', kbps: 320, more: 2, groups: [{ v: 'Instrumental', m: ['Vox'] }] });
    expect(v).not.toHaveProperty('norm');
  });

  it('render view: draws nothing when no file came back', () => {
    expect(editViewOf(entry('render_project', { fmt: 'wav', groups: [{ v: '', m: [], f: [] }] }))).toBeNull();
    expect(editViewOf(entry('render_project', { fmt: 'wav' }))).toBeNull();
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

  it('arrangement view: reads the op, the span, where it copied to and the item gains', () => {
    const v = editViewOf(entry('copy_section', {
      tempo: [[0, 120, 4, 4, 0]], len: 64, op: 'section', span: [8, 16], to: [32, 40], moreTracks: 3,
      lanes: [{ t: 'Gtr', items: [[8, 8, 0, 0, 0, 0], [32, 8, 0, 0, 0, 0]], was: [[8, 8, 0, 0, 0, 0]] }],
    }));
    expect(v).toMatchObject({ kind: 'timeline', op: 'section', span: [8, 16], to: [32, 40], moreTracks: 3 });
    const n = editViewOf(entry('process_items', {
      tempo: [[0, 120, 4, 4, 0]], len: 10, op: 'normalize',
      lanes: [{ t: 'Gtr', items: [[0, 4, 0, 0, 0, 0, 11]], was: [[0, 4, 0, 0, 0, 0, 'x']] }],
    }));
    expect(n).toMatchObject({ op: 'normalize', lanes: [{ items: [[0, 4, 0, 0, 0, 0, 11]], was: [[0, 4, 0, 0, 0, 0]] }] });
  });

  it('arrangement view: a normalize reports only the gains it changed, each with its before', () => {
    const gains = normalizedGains([
      { t: 'Gtr', items: [[0, 4, 0, 0, 0, 0, 11], [8, 4, 0, 0, 0, 0, 12], [16, 4, 0, 0, 0, 0, 5]], was: [[0, 4, 0, 0, 0, 0, 0], [8, 4, 0, 0, 0, 0, 12], [16, 4, 0, 0, 0, 0, -1]] },
      { t: 'Bass', items: [[2, 2, 0, 0, 0, 0]], was: [[2, 2, 0, 0, 0, 0]] },
    ]);
    expect(gains).toEqual([[11, 0], [5, -1]]);
  });

  it('arrangement view: drops an unknown op and a malformed span', () => {
    const v = editViewOf(entry('insert_time', { tempo: [[0, 120, 4, 4, 0]], len: 10, op: 'explode', span: [1] }));
    expect(v).not.toHaveProperty('op');
    expect(v).not.toHaveProperty('span');
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
