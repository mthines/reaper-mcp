import { describe, expect, it } from 'vitest';
import {
  commandsPerMinute,
  formatDuration,
  latencyStats,
  liveness,
  mergeLog,
  parseExtStateReply,
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
