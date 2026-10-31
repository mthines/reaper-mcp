import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics.js';
import { demoSnapshots, parseSnapshotsReply, replacedBy, settle, snapshotRequestUrl, snapshotsPollUrl, timeSnapshotName, type RequestState, type SnapshotOp, type SnapshotsFeed } from './snapshots.js';

const POLL_MS = 1_000;

export interface SnapshotsHook {
  /** Null until the bridge has published its list */
  feed: SnapshotsFeed | null;
  /** The latest request the page sent */
  request: RequestState | null;
  /** An edit takes the new name as `newName` (the same name changes only the description) */
  send: (op: SnapshotOp, name: string, description?: string, newName?: string) => void;
}

interface RequestMeta {
  replaced: boolean;
  described: boolean;
  /** Save: typed a name (else the date and time); edit: the name changed */
  named: boolean;
}

function report(req: RequestState, meta: RequestMeta) {
  const outcome = req.state === 'lost' ? 'lost' : req.state === 'done' && req.result.ok ? 'ok' : 'refused';
  if (req.op === 'restore') {
    track({ name: 'snapshot_restored', outcome, warnings: req.state === 'done' && Boolean(req.result.warnings?.length) });
  } else if (req.op === 'delete') {
    track({ name: 'snapshot_deleted', outcome });
  } else if (req.op === 'edit') {
    track({ name: 'snapshot_edited', outcome, renamed: meta.named });
  } else {
    track({ name: 'snapshot_saved', outcome, described: meta.described, replaced: meta.replaced, named: meta.named });
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
  const meta = useRef<RequestMeta>({ replaced: false, described: false, named: true });
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
      if (next.state !== 'pending') report(next, meta.current);
    };
    check();
    const id = setInterval(check, 1_000);
    return () => clearInterval(id);
  }, [feed, request?.state]);

  const send = useCallback(
    (op: SnapshotOp, name: string, description = '', newName = '') => {
      if (!demo && !token) return;
      const id = `${Date.now()}${String(++seq.current).padStart(2, '0')}`.slice(-15);
      const snapshots = feed?.snapshots ?? [];
      // A save without a name is named by the date and time, as the quick-save action does
      const typed = name.trim() !== '';
      const target = op === 'save' && !typed ? timeSnapshotName(snapshots) : name.trim();
      meta.current = {
        replaced: op === 'save' && replacedBy(snapshots, target) !== null,
        described: description.trim() !== '',
        named: op === 'edit' ? newName.trim() !== target : typed,
      };
      // The line under the form names what the request ends up as: an edit's new name
      setRequest({ id, op, name: op === 'edit' ? newName.trim() : target, at: Date.now(), state: 'pending' });
      if (demo) {
        setTimeout(() => setFeed((f) => (f ? demoAnswer(f, id, op, target, description.trim(), newName.trim()) : f)), 300);
        return;
      }
      fetch(snapshotRequestUrl(op, id, token ?? '', target, description, newName), { cache: 'no-store' }).catch(() => {
        // the request times out on the page if it never arrived
      });
    },
    [token, demo, feed],
  );

  return { feed, request, send };
}

function demoAnswer(f: SnapshotsFeed, id: string, op: SnapshotOp, name: string, description: string, newName: string): SnapshotsFeed {
  if (op === 'delete') {
    return { ...f, snapshots: f.snapshots.filter((s) => s.name !== name), result: { id, op, name, ok: true } };
  }
  if (op === 'edit') {
    const snapshots = f.snapshots.map((s) => (s.name === name ? { ...s, name: newName, description } : s));
    return { ...f, snapshots, current: f.current === name ? newName : f.current, result: { id, op, name: newName, ok: true } };
  }
  if (op === 'restore') {
    const snap = f.snapshots.find((s) => s.name === name);
    return { ...f, current: snap ? name : f.current, result: { id, op, name, ok: Boolean(snap), tracksRestored: snap?.trackCount, error: snap ? undefined : `Snapshot not found: ${name}` } };
  }
  const saved = { name, description, timestamp: Date.now(), trackCount: 24, scoped: false, fullChunk: false };
  return { ...f, snapshots: [saved, ...f.snapshots.filter((s) => s.name !== name)], result: { id, op, name, ok: true } };
}
