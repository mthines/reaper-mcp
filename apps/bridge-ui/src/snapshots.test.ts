import { describe, expect, it } from 'vitest';
import {
  REQUEST_TIMEOUT_MS,
  blockedBy,
  nameProblem,
  parseSnapshotsReply,
  replacedBy,
  settle,
  snapshotRequestUrl,
  snapshotsPollUrl,
  type RequestState,
  type SnapshotsFeed,
} from './snapshots.js';

const unhex = (h: string) => new TextDecoder().decode(Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16)));
const reply = (value: unknown) => `EXTSTATE\tMCPBridge\tsnapshots\t${JSON.stringify(value)}\n`;

describe('snapshot requests the page sends', () => {
  it('watches the folder and reads the list in one web-interface call', () => {
    expect(snapshotsPollUrl(42)).toBe('/_/SET/EXTSTATE/MCPBridge/snap_seen/42;GET/EXTSTATE/MCPBridge/snapshots');
  });

  it('carries id, token, op and the name and description hex-encoded, so nothing needs URL escaping', () => {
    const url = snapshotRequestUrl('save', '17', 'ab12', ' Más; brillo/2 ', 'Wide & "loud"\n');
    const m = url.match(/^\/_\/SET\/EXTSTATE\/MCPBridge\/snap_req\/(\d+)-([0-9a-f]+)-(save)-([0-9a-f]+)-([0-9a-f]+)$/);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('17');
    expect(m?.[2]).toBe('ab12');
    expect(unhex(m?.[4] ?? '')).toBe('Más; brillo/2');
    expect(unhex(m?.[5] ?? '')).toBe('Wide & "loud"');
  });

  it('sends no description with a restore, or an empty one', () => {
    expect(snapshotRequestUrl('restore', '1', 'ab', 'mix-A', 'ignored')).toBe(`/_/SET/EXTSTATE/MCPBridge/snap_req/1-ab-restore-${Buffer.from('mix-A').toString('hex')}`);
    expect(snapshotRequestUrl('save', '1', 'ab', 'mix-A', '  ')).toBe(`/_/SET/EXTSTATE/MCPBridge/snap_req/1-ab-save-${Buffer.from('mix-A').toString('hex')}`);
  });

  it('cuts a long description at a character boundary within what the bridge keeps', () => {
    const url = snapshotRequestUrl('save', '1', 'ab', 'x', 'é'.repeat(400));
    const desc = unhex(url.split('-').pop() ?? '');
    expect(desc).toBe('é'.repeat(250)); // 500 bytes
  });
});

describe('the list the bridge publishes', () => {
  const feed = {
    v: 1,
    storage: 'project',
    current: 'mix-A',
    snapshots: [
      { name: 'mix-B', description: 'Quieter kick', timestamp: 2, trackCount: 1, scoped: false, fullChunk: false },
      { name: 'mix-A', description: '', timestamp: 1, scoped: true, fullChunk: true },
    ],
    result: { id: '7', op: 'restore', name: 'mix-A', ok: true, tracksRestored: 1, warnings: [] },
  };

  it('parses snapshots, the current one and the answer to a request', () => {
    const parsed = parseSnapshotsReply(reply(feed));
    expect(parsed?.snapshots.map((s) => s.name)).toEqual(['mix-B', 'mix-A']);
    expect(parsed?.snapshots[1]).toEqual({ name: 'mix-A', description: '', timestamp: 1, trackCount: undefined, scoped: true, fullChunk: true });
    expect(parsed?.current).toBe('mix-A');
    expect(parsed?.result).toMatchObject({ id: '7', ok: true, tracksRestored: 1, warnings: undefined });
  });

  it('reads an empty list the way Lua encodes it, and nothing before the bridge published', () => {
    expect(parseSnapshotsReply(reply({ v: 1, storage: 'global', snapshots: {} }))).toEqual({ v: 1, storage: 'global', current: undefined, snapshots: [], result: undefined });
    expect(parseSnapshotsReply('EXTSTATE\tMCPBridge\tsnapshots\t\n')).toBeNull();
    expect(parseSnapshotsReply(reply({ v: 2, snapshots: [] }))).toBeNull();
  });
});

describe('a request the page is waiting on', () => {
  const pending: RequestState = { id: '9', op: 'restore', name: 'mix-B', at: 1_000, state: 'pending' };
  const withResult = (id: string): SnapshotsFeed => ({ v: 1, storage: 'project', snapshots: [], result: { id, op: 'restore', name: 'mix-B', ok: false, error: 'Read-only' } });

  it('settles on the answer to that request only', () => {
    expect(settle(pending, withResult('8'), 2_000)).toBe(pending); // an older answer
    expect(settle(pending, withResult('9'), 2_000)).toMatchObject({ state: 'done', result: { ok: false, error: 'Read-only' } });
  });

  it('is lost when the bridge never answers', () => {
    expect(settle(pending, null, 1_000 + REQUEST_TIMEOUT_MS + 1)).toMatchObject({ state: 'lost' });
  });
});

describe('saving', () => {
  const list = [{ name: 'mix B', description: '', timestamp: 1, scoped: false, fullChunk: false }];

  it('needs a name', () => {
    expect(nameProblem('  ')).not.toBeNull();
    expect(nameProblem('mix-C')).toBeNull();
  });

  it('warns before replacing a snapshot saved to the same file, also under another spelling', () => {
    expect(replacedBy(list, 'mix B')?.name).toBe('mix B');
    expect(replacedBy(list, 'mix_B')?.name).toBe('mix B'); // both save to mix_B.json
    expect(replacedBy(list, 'mix C')).toBeNull();
    // the bridge replaces each byte of a non-ASCII character: "Más" and "Mxxs" share no file, "M__s" does
    const accented = [{ name: 'Más', description: '', timestamp: 1, scoped: false, fullChunk: false }];
    expect(replacedBy(accented, 'M__s')?.name).toBe('Más');
    expect(replacedBy(accented, 'M_s')).toBeNull();
  });

  it('is off while read-only or paused, as the bridge would refuse it', () => {
    expect(blockedBy({ readonly: true })).toMatch(/Read-only/);
    expect(blockedBy({ paused: true })).toMatch(/Paused/);
    expect(blockedBy({ readonly: false, paused: false })).toBeNull();
    expect(blockedBy(null)).toBeNull();
  });
});
