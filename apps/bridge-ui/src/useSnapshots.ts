import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from './analytics.js';
import {
  demoSnapshots,
  parseSnapshotsReply,
  replacedBy,
  settle,
  snapshotRequestUrl,
  snapshotsPollUrl,
  type RequestState,
  type SnapshotOp,
  type SnapshotsFeed,
} from './snapshots.js';

const POLL_MS = 1_000;

export interface SnapshotsHook {
  /** Null until the bridge has published its list */
  feed: SnapshotsFeed | null;
  /** The latest restore or save the page sent */
  request: RequestState | null;
  send: (op: SnapshotOp, name: string, description?: string) => void;
}

function report(req: RequestState, replaced: boolean, described: boolean) {
  const outcome = req.state === 'lost' ? 'lost' : req.state === 'done' && req.result.ok ? 'ok' : 'refused';
  if (req.op === 'restore') {
    track({ name: 'snapshot_restored', outcome, warnings: req.state === 'done' && Boolean(req.result.warnings?.length) });
  } else {
    track({ name: 'snapshot_saved', outcome, described, replaced });
  }
}

/**
 * The live Snapshots feed while the view is open: pings `snap_seen` so the bridge watches the snapshot
 * folder, and reads ExtState `snapshots` once a second (the bridge rewrites it only when it changed).
 * `send` restores or saves with the bridge's per-run control token; only the latest request is tracked.
 */
export function useSnapshots(enabled: boolean, token: string | undefined, demo: boolean): SnapshotsHook {
  const [feed, setFeed] = useState<SnapshotsFeed | null>(null);
  const [request, setRequest] = useState<RequestState | null>(null);
  const meta = useRef({ replaced: false, described: false });
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (demo) {
      setFeed((f) => f ?? demoSnapshots(Date.now()));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const res = await fetch(snapshotsPollUrl(Date.now()), { cache: 'no-store' });
          const next = parseSnapshotsReply(await res.text());
          if (!cancelled && next) setFeed(next);
        } catch {
          // bridge unreachable: keep the last list
        }
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, demo]);

  // Settle the pending request from each new feed, and time it out if the bridge never answers
  const latest = useRef({ request, feed });
  latest.current = { request, feed };
  useEffect(() => {
    if (request?.state !== 'pending') return;
    const check = () => {
      const r = latest.current.request;
      const next = settle(r, latest.current.feed, Date.now());
      if (!next || next === r) return;
      latest.current.request = next;
      setRequest(next);
      if (next.state !== 'pending') report(next, meta.current.replaced, meta.current.described);
    };
    check();
    const id = setInterval(check, 1_000);
    return () => clearInterval(id);
  }, [feed, request?.state]);

  const send = useCallback(
    (op: SnapshotOp, name: string, description = '') => {
      if (!demo && !token) return;
      const id = `${Date.now()}${String(++seq.current).padStart(2, '0')}`.slice(-15);
      meta.current = { replaced: op === 'save' && feed !== null && replacedBy(feed.snapshots, name) !== null, described: description.trim() !== '' };
      setRequest({ id, op, name: name.trim(), at: Date.now(), state: 'pending' });
      if (demo) {
        setTimeout(() => setFeed((f) => (f ? demoAnswer(f, id, op, name.trim(), description.trim()) : f)), 300);
        return;
      }
      fetch(snapshotRequestUrl(op, id, token ?? '', name, description), { cache: 'no-store' }).catch(() => {
        // the request times out on the page if it never arrived
      });
    },
    [token, demo, feed],
  );

  return { feed, request, send };
}

function demoAnswer(f: SnapshotsFeed, id: string, op: SnapshotOp, name: string, description: string): SnapshotsFeed {
  if (op === 'restore') {
    const snap = f.snapshots.find((s) => s.name === name);
    return { ...f, current: snap ? name : f.current, result: { id, op, name, ok: Boolean(snap), tracksRestored: snap?.trackCount, error: snap ? undefined : `Snapshot not found: ${name}` } };
  }
  const saved = { name, description, timestamp: Date.now(), trackCount: 24, scoped: false, fullChunk: false };
  return { ...f, snapshots: [saved, ...f.snapshots.filter((s) => s.name !== name)], result: { id, op, name, ok: true } };
}
