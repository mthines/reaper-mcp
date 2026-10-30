import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatDay,
  bucketize,
  historyTiers,
  inSpan,
  parseLogReply,
  parseLongHistoryReply,
  restoreLog,
  spanOfBars,
  timelineBars,
  clearedBefore,
  commandsPerMinute,
  deriveSeries,
  formatDuration,
  latencyStats,
  liveness,
  mergeLog,
  parseExtStateReply,
  parseHistoryReply,
  statusRequestUrl,
  commandKind,
  LONG_RUNNING,
  outcomeOf,
  SYSTEM_ERROR_PREFIXES,
  speedOf,
  measurementOf,
  measurementHistory,
  matchesQuery,
  parseQuery,
  termFromSelection,
  formatParams,
  webSocketLevel,
  groupByTool,
  hasToolCalls,
  isConnected,
  labelSessions,
  sessionName,
  settingUrl,
  type BridgeStatus,
  type CommandEntry,
} from './status.js';

const status: BridgeStatus = {
  v: 1,
  ts: 1000,
  startedAt: 0,
  reaperVersion: '7.27/macOS-arm64',
  project: 'Song',
  bridgeDir: '/x/Scripts/mcp_bridge_data/',
  commands: 2,
  errors: 1,
  deferMs: 33.3,
  recent: [{ n: 2, t: 900, c: 'add_fx', ms: 4.2, ok: false, e: 'FX "Pro-Q" not found' }],
};

describe('parseExtStateReply', () => {
  it('parses an unescaped value', () => {
    const body = `EXTSTATE\tMCPBridge\tstatus\t${JSON.stringify(status)}\n`;
    expect(parseExtStateReply(body)).toEqual(status);
  });

  it('parses a value with REAPER backslash escaping', () => {
    const escaped = JSON.stringify(status).replace(/\\/g, '\\\\');
    const body = `EXTSTATE\tMCPBridge\tstatus\t${escaped}\n`;
    expect(parseExtStateReply(body)).toEqual(status);
  });

  it('returns null when the key is empty or the reply is unrelated', () => {
    expect(parseExtStateReply('EXTSTATE\tMCPBridge\tstatus\t\n')).toBeNull();
    expect(parseExtStateReply('')).toBeNull();
    expect(parseExtStateReply('EXTSTATE\tMCPBridge\tstatus\t{broken\n')).toBeNull();
  });
});

describe('statusRequestUrl', () => {
  it('pings ui_seen and reads the status in one request', () => {
    expect(statusRequestUrl(123)).toBe(
      '/_/SET/EXTSTATE/MCPBridge/ui_seen/123;GET/EXTSTATE/MCPBridge/status;GET/EXTSTATE/MCPBridge/history',
    );
  });
});

describe('mergeLog', () => {
  const e = (n: number): CommandEntry => ({ n, t: n, c: 'x', ms: 1, ok: true });

  it('prepends only entries newer than the log head', () => {
    const log = [e(3), e(2), e(1)];
    expect(mergeLog(log, [e(5), e(4), e(3), e(2)]).map((x) => x.n)).toEqual([5, 4, 3, 2, 1]);
  });

  it('returns the same array when nothing is new', () => {
    const log = [e(2), e(1)];
    expect(mergeLog(log, [e(2), e(1)])).toBe(log);
  });
});

describe('liveness', () => {
  it('is offline without status, stale after 3s without a new ts', () => {
    expect(liveness(null, 0, 0)).toBe('offline');
    expect(liveness(status, 10_000, 12_000)).toBe('live');
    expect(liveness(status, 10_000, 13_500)).toBe('stale');
  });
});

describe('stats', () => {
  const entries: CommandEntry[] = [1, 2, 3, 4, 100].map((ms, i) => ({ n: i + 1, t: i * 20_000, c: 'x', ms, ok: true }));

  it('computes avg, p95 and max', () => {
    expect(latencyStats(entries)).toEqual({ avg: 22, p95: 100, max: 100 });
    expect(latencyStats([])).toBeNull();
  });

  it('counts commands in the last minute', () => {
    expect(commandsPerMinute(entries, 80_000)).toBe(4);
  });

  it('formats durations compactly', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
    expect(formatDuration(90_000_000)).toBe('1d 1h');
  });
});

describe('deriveSeries', () => {
  it('turns cumulative samples into per-interval deltas and latency averages', () => {
    const samples = [
      { t: 0, commands: 0, errors: 0, deferMs: 30 },
      { t: 1000, commands: 2, errors: 1, deferMs: 31 },
      { t: 2000, commands: 2, errors: 1, deferMs: 33 },
    ];
    const log: CommandEntry[] = [
      { n: 2, t: 900, c: 'b', ms: 6, ok: false },
      { n: 1, t: 400, c: 'a', ms: 2, ok: true },
    ];
    expect(deriveSeries(samples, log)).toEqual({
      commands: [2, 0],
      errors: [1, 0],
      latency: [4, null],
      loop: [31, 33],
    });
  });

  it('never goes negative when counters reset', () => {
    const s = deriveSeries([{ t: 0, commands: 9, errors: 3, deferMs: 30 }, { t: 1000, commands: 1, errors: 0, deferMs: 30 }], []);
    expect(s.commands).toEqual([0]);
    expect(s.errors).toEqual([0]);
  });
});

describe('history', () => {
  const history = { v: 1, size: 10_000, b: [[100, 4, 1, 1, 220], [102, 2, 0, 0, 3], [50, 9, 0, 0, 9]] as Array<[number, number, number, number, number]> };

  it('reads the history key from a combined reply', () => {
    const body = `EXTSTATE\tMCPBridge\tstatus\t${JSON.stringify(status)}\nEXTSTATE\tMCPBridge\thistory\t${JSON.stringify(history)}\n`;
    expect(parseHistoryReply(body)).toEqual(history);
    expect(parseExtStateReply(body)).toEqual(status);
    expect(parseHistoryReply('EXTSTATE\tMCPBridge\thistory\t\n')).toBeNull();
  });

  it('groups buckets into aligned bars and drops ones outside the range', () => {
    // 30s bars over 60s; now = 1_030_000 is inside the bar [1_020k, 1_050k), so the window starts at 990k
    const bars = bucketize(history, 60_000, 2, 1_030_000);
    expect(bars.map((b) => [b.start, b.total, b.errors, b.slow])).toEqual([
      [990_000, 4, 1, 1],
      [1_020_000, 2, 0, 0],
    ]);
    expect(bars[0].avgMs).toBe(55);
    expect(bars[1].avgMs).toBe(1.5);
    expect(bucketize(null, 60_000, 2, 1_030_000).every((b) => b.total === 0 && b.avgMs === null)).toBe(true);
  });
});

describe('groupByTool', () => {
  const log: CommandEntry[] = [
    { n: 4, t: 400, c: 'set_fx_parameter', ms: 2, ok: false, e: 'Track 9 not found' },
    { n: 3, t: 300, c: 'list_tracks', ms: 1, ok: true },
    { n: 2, t: 200, c: 'set_fx_parameter', ms: 4, ok: true },
    { n: 1, t: 100, c: 'set_fx_parameter', ms: 6, ok: false, e: 'Handler error: attempt to index nil' },
  ];

  it('counts calls, system errors (not refused requests) and latency per command type', () => {
    const [fx, tracks] = groupByTool(log);
    expect(fx).toMatchObject({ c: 'set_fx_parameter', kind: 'write', count: 3, errors: 1, avg: 4, max: 6, last: 400, lastError: 'Handler error: attempt to index nil' });
    expect(tracks).toMatchObject({ c: 'list_tracks', kind: 'read', count: 1, errors: 0 });
  });

  it('sorts by the chosen column', () => {
    expect(groupByTool(log, 'recent').map((g) => g.c)).toEqual(['set_fx_parameter', 'list_tracks']);
    expect(groupByTool(log, 'slowest')[0].c).toBe('set_fx_parameter');
  });
});

describe('sessions', () => {
  it('names a session after its project folder', () => {
    expect(sessionName({ id: 'abc', dir: '/work/song-a/' })).toBe('song-a');
    expect(sessionName({ id: 'C:\\x', dir: 'C:\\Music\\demo' })).toBe('demo');
    expect(sessionName({ id: 'pid-4242' })).toBe('pid 4242');
  });

  it('treats a session as gone after a goodbye or two missed pings', () => {
    const s = { id: 'a', first: 0, last: 1000, commands: 0, errors: 0 };
    expect(isConnected(s, 30_000)).toBe(true);
    expect(isConnected(s, 60_000)).toBe(false);
    expect(isConnected({ ...s, ended: true }, 2000)).toBe(false);
  });
});

describe('settings and params', () => {
  it('keeps pause in memory and persists the rest', () => {
    expect(settingUrl('cfg_paused', true)).toBe('/_/SET/EXTSTATE/MCPBridge/cfg_paused/1');
    expect(settingUrl('cfg_readonly', false)).toBe('/_/SET/EXTSTATEPERSIST/MCPBridge/cfg_readonly/0');
  });

  it('classifies commands like the bridge read-only gate', () => {
    expect(commandKind('get_fx_parameters')).toBe('read');
    expect(commandKind('play')).toBe('transport');
    expect(commandKind('run_action')).toBe('write');
  });

  it('rates durations, never long-running commands', () => {
    expect(speedOf('list_tracks', 5)).toBe('fast');
    expect(speedOf('list_tracks', 100)).toBe('slow');
    expect(speedOf('set_fx_parameter', 500)).toBe('very-slow');
    expect(speedOf('render_track_to_wav', 4655)).toBe('long');
    expect(speedOf('add_fx', 2)).toBe('long');
  });

  it('types measuring results and ignores the rest', () => {
    const base = { n: 1, t: 0, ms: 1, ok: true };
    expect(measurementOf({ ...base, c: 'read_track_meters', r: { peakL: -6, peakR: 'x' } })).toEqual({ kind: 'meters', peakL: -6 });
    expect(measurementOf({ ...base, c: 'read_track_spectrum', r: { peakDb: -3, bands: [-20, -30] } })).toEqual({ kind: 'spectrum', peakDb: -3, bands: [-20, -30] });
    expect(measurementOf({ ...base, c: 'read_track_spectrum', r: { bands: ['x'] } })).toBeNull();
    expect(measurementOf({ ...base, c: 'render_track_to_wav', r: { peakDb: -1, hi: [0.5, 0.9], lo: [-0.4, -0.8] } })).toEqual({ kind: 'waveform', peakDb: -1, hi: [0.5, 0.9], lo: [-0.4, -0.8] });
    expect(measurementOf({ ...base, c: 'render_track_to_wav', r: { durationSeconds: 5 } })).toBeNull(); // the WAV couldn't be read
    expect(measurementOf({ ...base, c: 'read_track_meters', ok: false, r: { peakL: -6 } })).toBeNull();
    expect(measurementOf({ ...base, c: 'read_track_meters' })).toBeNull(); // logged before the bridge kept results
    expect(measurementOf({ ...base, c: 'list_tracks', r: { peakL: -6 } })).toBeNull();
  });

  it('finds the same measurement on the same track for the history', () => {
    const m = (n: number, c: string, track: number, ok = true): CommandEntry => ({ n, t: n, c, ms: 1, ok, p: JSON.stringify({ trackIndex: track }), r: { integrated: -14 } });
    const log = [m(6, 'read_track_lufs', 1), m(5, 'read_track_lufs', 2), m(4, 'read_track_crest', 1), m(3, 'read_track_lufs', 1, false), m(2, 'read_track_lufs', 1), m(1, 'read_track_lufs', 1)];
    expect(measurementHistory(log, log[0]).map((e) => e.n)).toEqual([6, 2, 1]);
    expect(measurementHistory(log, log[0], 2).map((e) => e.n)).toEqual([6, 2]);
    expect(measurementHistory(log, log[5], 2).map((e) => e.n)).toEqual([2, 1]);
    expect(measurementHistory([{ n: 1, t: 1, c: 'list_tracks', ms: 1, ok: true }], { n: 1, t: 1, c: 'list_tracks', ms: 1, ok: true })).toEqual([]);
  });

  it('empties bars from before a Clear', () => {
    const bar = (start: number) => ({ start, end: start + 10, total: 3, errors: 1, slow: 1, avgMs: 3 });
    const out = clearedBefore([bar(0), bar(10), bar(20)], 25);
    expect(out.map((b) => b.total)).toEqual([0, 0, 3]);
    expect(clearedBefore([bar(0)], 0)[0].total).toBe(3);
  });

  it('tells a system error from a refused request', () => {
    expect(outcomeOf({ ok: true })).toBe('ok');
    expect(outcomeOf({ ok: false, e: 'Track 99999 not found' })).toBe('refused');
    expect(outcomeOf({ ok: false, e: 'Handler error: attempt to index nil' })).toBe('error');
    expect(outcomeOf({ ok: false, e: 'Unknown command type: nope' })).toBe('error');
    expect(outcomeOf({ ok: false, e: 'Internal error: emitter not found' })).toBe('error');
  });

  it('treats the same failures as errors as the bridge timeline does', () => {
    const lua = readFileSync(new URL('../../../reaper/mcp_bridge.lua', import.meta.url), 'utf8');
    const block = lua.match(/local failed = not ok and \(([\s\S]*?)\) ~= nil/)?.[1] ?? '';
    expect(block.match(/"\^([^"]+)"/g)?.map((q) => q.slice(2, -1))).toEqual(SYSTEM_ERROR_PREFIXES);
  });

  it('keeps the long-running list in step with the bridge', () => {
    const lua = readFileSync(new URL('../../../reaper/mcp_bridge.lua', import.meta.url), 'utf8');
    const block = lua.match(/for _, c in ipairs\(\{([^}]*)\}\) do LONG_RUNNING/)?.[1] ?? '';
    expect(new Set(block.match(/"[a-z_]+"/g)?.map((q) => q.slice(1, -1)))).toEqual(LONG_RUNNING);
  });

  it('pretty-prints params and marks truncated ones', () => {
    expect(formatParams('{"trackIndex":0}')).toBe('{\n  "trackIndex": 0\n}');
    expect(formatParams('{"notes":"[1,2')).toBe('{"notes":"[1,2…');
    expect(formatParams(undefined)).toBeNull();
  });
});

describe('labelSessions', () => {
  const at = (id: string, dir: string, first: number) => ({ id, dir, first, last: first, commands: 0, errors: 0 });

  it('keeps folder names when they are unique', () => {
    expect(labelSessions([at('a', '/w/song-a', 1), at('b', '/w/song-b', 2)]).map((x) => x.label)).toEqual(['song-a', 'song-b']);
  });

  it('adds the parent folder when two folders share a name', () => {
    const labels = labelSessions([at('a', '/w/one/main', 1), at('b', '/w/two/main', 2)]).map((x) => x.label);
    expect(labels).toEqual(['one/main', 'two/main']);
  });

  it('numbers agents in the same folder by start time', () => {
    const labels = labelSessions([at('late', '/w/repo/main', 5), at('early', '/w/repo/main', 1)]).map((x) => x.label);
    expect(labels).toEqual(['main #2', 'main #1']);
  });
});

describe('hasToolCalls', () => {
  it('leaves out agents that have only pinged', () => {
    expect(hasToolCalls({ commands: 0 })).toBe(false);
    expect(hasToolCalls({ commands: 3 })).toBe(true);
  });
});

describe('persisted log', () => {
  const e = (n: number, t = n * 1000): CommandEntry => ({ n, t, c: 'list_tracks', ms: 1, ok: true });

  it('restores the persisted log beyond the live window', () => {
    const saved = Array.from({ length: 120 }, (_, i) => e(120 - i)); // newest first
    const live = [e(122), e(121), e(120), e(119)];
    const body = `EXTSTATE\tMCPBridge\tlog\t${JSON.stringify({ v: 1, req: '42', entries: saved })}\n`;
    const reply = parseLogReply(body);
    expect(reply?.req).toBe('42');
    const restored = restoreLog(live, reply?.entries ?? []);
    expect(restored).toHaveLength(122);
    expect(restored.slice(0, 3).map((x) => x.n)).toEqual([122, 121, 120]);
    expect(restored[121].n).toBe(1);
  });

  it('keeps entries the user cleared out', () => {
    expect(restoreLog([e(5)], [e(4), e(3), e(2)], 3).map((x) => x.n)).toEqual([5, 4]);
  });

  it('ignores a missing log key', () => {
    expect(parseLogReply('EXTSTATE\tMCPBridge\tstatus\t{}\n')).toBeNull();
  });
});

describe('long timeline', () => {
  const hour = 3_600_000;
  const day = 24 * hour;
  const now = 1_000 * day;
  const short = { v: 1, size: 10_000, b: [[Math.floor((now - 60_000) / 10_000), 2, 0, 0, 4]] as Array<[number, number, number, number, number]> };
  const longBody = `EXTSTATE\tMCPBridge\thistory_long\t${JSON.stringify({
    v: 1,
    tiers: [
      { size: 60_000, b: [[Math.floor((now - 60_000) / 60_000), 2, 0, 0, 4], [Math.floor((now - 5 * hour) / 60_000), 3, 1, 0, 9]] },
      { size: 600_000, b: [[Math.floor((now - 60_000) / 600_000), 2, 0, 0, 4], [Math.floor((now - 5 * hour) / 600_000), 3, 1, 0, 9], [Math.floor((now - 3 * day) / 600_000), 7, 0, 2, 20]] },
    ],
  })}\n`;
  const tiers = historyTiers(short, parseLongHistoryReply(longBody));

  const sum = (bars: { total: number }[]) => bars.reduce((s, b) => s + b.total, 0);

  it('uses 10s buckets for the last hour', () => {
    expect(sum(timelineBars(tiers, hour, 60, now))).toBe(2);
  });

  it('covers the past day from the 1m buckets', () => {
    const bars = timelineBars(tiers, day, 96, now);
    expect(bars).toHaveLength(96);
    expect(sum(bars)).toBe(5);
  });

  it('covers the past week from the 10m buckets', () => {
    const bars = timelineBars(tiers, 7 * day, 168, now);
    expect(bars).toHaveLength(168);
    expect(bars[1].end - bars[1].start).toBe(hour);
    expect(sum(bars)).toBe(12);
    expect(bars.find((b) => b.start <= now - 3 * day && now - 3 * day < b.end)?.total).toBe(7);
  });

  it('draws empty bars before the bridge published any history', () => {
    expect(sum(timelineBars([], 7 * day, 168, now))).toBe(0);
  });
});

describe('chart selection', () => {
  it('filters to the selection, whichever way it was dragged', () => {
    const bars = bucketize(null, 60_000, 6, 60_000); // six 10s bars: 0..60s
    const span = spanOfBars(bars, 3, 1);
    expect(span).toEqual({ start: 10_000, end: 40_000 });
    const log: CommandEntry[] = [5_000, 10_000, 25_000, 39_999, 40_000].map((t, i) => ({ n: i + 1, t, c: 'x', ms: 1, ok: true }));
    expect(inSpan(log, span).map((e) => e.t)).toEqual([10_000, 25_000, 39_999]);
    expect(inSpan(log, null)).toBe(log);
  });
});

describe('formatDay', () => {
  const now = new Date(2026, 9, 29, 9, 0).getTime();
  it('names today and yesterday by calendar day, not 24h', () => {
    expect(formatDay(new Date(2026, 9, 29, 0, 5).getTime(), now)).toBe('Today');
    expect(formatDay(new Date(2026, 9, 28, 20, 56).getTime(), now)).toBe('Yesterday');
    expect(formatDay(new Date(2026, 9, 28, 0, 1).getTime(), now)).toBe('Yesterday');
  });
  it('shows a date when older, with the year only when it differs', () => {
    const older = formatDay(new Date(2026, 9, 27, 12).getTime(), now);
    expect(older).toMatch(/27/);
    expect(older).not.toMatch(/26/);
    expect(formatDay(new Date(2025, 11, 31, 12).getTime(), now)).toMatch(/25/);
  });
});

describe('search terms', () => {
  const call = (n: number, c: string, params: Record<string, unknown>, e?: string): CommandEntry => ({ n, t: n, c, ms: 1, ok: !e, e, p: JSON.stringify(params) });
  const log = [
    call(1, 'read_track_spectrum', { trackIndex: 6, fftSize: 4096 }),
    call(2, 'read_track_spectrum', { trackIndex: 16 }),
    call(3, 'read_track_lufs', { trackIndex: 6 }),
    call(4, 'add_fx', { trackIndex: 3, fxName: 'VST3: Pro-Q 3' }, 'FX not found'),
  ];
  const find = (q: string) => log.filter((e) => matchesQuery(e, parseQuery(q))).map((e) => e.n);

  it('finds the calls on one track, not on tracks whose index merely contains it', () => {
    expect(find('trackIndex:6')).toEqual([1, 3]);
  });

  it('needs every term to match', () => {
    expect(find('spectrum trackIndex:6')).toEqual([1]);
    expect(find('read_track_spectrum trackIndex:3')).toEqual([]);
  });

  it('matches plain words in the name, the error and the params', () => {
    expect(find('lufs')).toEqual([3]);
    expect(find('not found')).toEqual([4]);
    expect(find('pro-q')).toEqual([4]);
  });

  it('takes a quoted value with spaces as one param', () => {
    expect(find('fxName:"VST3: Pro-Q 3"')).toEqual([4]);
    expect(find('fxname:"VST3: Pro-Q 3"')).toEqual([]); // param names are exact
  });

  it('turns a selection in the params into a filter for that param', () => {
    const text = JSON.stringify({ fftSize: 4096, trackIndex: 6, fxName: 'VST3: Pro-Q 3' }, null, 2);
    const sel = (s: string, skip = 0) => [text.indexOf(s) + skip, text.indexOf(s) + s.length] as const;
    const six = sel(': 6', 2);
    expect(termFromSelection(text, ...six)).toBe('trackIndex:6'); // just the value
    expect(termFromSelection(text, ...sel('trackIndex'))).toBe('trackIndex:6'); // just the name
    expect(termFromSelection(text, ...sel('Pro-Q'))).toBe('fxName:"VST3: Pro-Q 3"');
    expect(termFromSelection(text, ...sel('4096,\n  "track'))).toBe('4096, track'); // across lines: the words
    expect(termFromSelection(text, 0, 0)).toBeNull();
    // Whatever it returns finds the call it came from
    expect(log.filter((e) => matchesQuery(e, parseQuery(termFromSelection(text, ...six) ?? ''))).map((e) => e.n)).toEqual([1, 3]);
  });
});

describe('webSocketLevel', () => {
  it('warns from half the limit, urgently from 80%', () => {
    expect(webSocketLevel(undefined)).toBe('ok');
    expect(webSocketLevel({ stuck: 49, limit: 100 })).toBe('ok');
    expect(webSocketLevel({ stuck: 50, limit: 100 })).toBe('filling');
    expect(webSocketLevel({ stuck: 80, limit: 100 })).toBe('full');
    expect(webSocketLevel({ stuck: 5, limit: 0 })).toBe('ok');
  });
});
