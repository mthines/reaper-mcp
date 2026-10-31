import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { RequestState, RowMode, SnapshotInfo, SnapshotOp, SnapshotsFeed } from './snapshots.js';
import { EditForm } from './EditForm.js';
import { SaveForm } from './SaveForm.js';
import { formatAgo } from '../../lib/format.js';
import { cx } from '../../lib/cx.js';
import listStyles from '../../styles/list.module.css';
import styles from './SnapshotsView.module.css';

/**
 * The Snapshots view: the project's saved mixer snapshots. Click one (or press 1–9) to load it while
 * listening, for a quick A/B/C; save the current mix (a blank name saves under the date and time); rename
 * or delete one from its row. All go through the bridge's normal command path, so they show in the log and
 * are refused while read-only or paused.
 */
export function SnapshotsView({
  feed,
  request,
  blocked,
  query = '',
  now,
  onSend,
  keys = true,
  initialRow,
}: {
  /** Null until the bridge has published its list */
  feed: SnapshotsFeed | null;
  request: RequestState | null;
  /** Why restore and save are off (read-only, paused), or null */
  blocked: string | null;
  query?: string;
  now: number;
  onSend: (op: SnapshotOp, name: string, description?: string, newName?: string) => void;
  /** Number keys load snapshots (off in stories, where several views share the page) */
  keys?: boolean;
  /** Stories: start with this row in rename or delete-confirm mode */
  initialRow?: RowMode;
}) {
  const [row, setRow] = useState<RowMode | null>(initialRow ?? null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = feed?.snapshots ?? [];
    return q ? list.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : list;
  }, [feed, query]);
  const pending = request?.state === 'pending' ? request : null;

  const load = (s: SnapshotInfo) => {
    if (!blocked) onSend('restore', s.name);
  };
  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    const el = document.activeElement;
    // A held key auto-repeats: load once, not once per repeat (each load is an undo point)
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
    const n = Number(ev.key);
    const snap = Number.isInteger(n) && n >= 1 ? shown[n - 1] : undefined;
    if (!snap) return;
    ev.preventDefault();
    load(snap);
  });
  useEffect(() => {
    if (!keys) return;
    const listener = (ev: KeyboardEvent) => onKey(ev);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [keys]);

  return (
    <div className={cx(listStyles.rows, styles.snaps)}>
      <SaveForm snapshots={feed?.snapshots ?? []} blocked={blocked} saving={pending?.op === 'save'} onSave={(name, desc) => onSend('save', name, desc)} />
      {blocked && (
        <p className={styles.snapBlocked} role="note">
          {blocked}
        </p>
      )}
      <RequestLine request={request} />
      {feed === null ? (
        <div className={listStyles.empty}>Reading snapshots from the bridge…</div>
      ) : feed.snapshots.length === 0 ? (
        <div className={listStyles.empty}>No snapshots yet. Save the current mix to start comparing.</div>
      ) : shown.length === 0 ? (
        <div className={listStyles.empty}>No snapshot matches “{query.trim()}”.</div>
      ) : (
        <ol className={styles.snapList} aria-label="Snapshots">
          {shown.map((s, i) => {
            const current = feed.current === s.name;
            const loading = pending?.op === 'restore' && pending.name === s.name;
            const mode = row?.name === s.name ? row.mode : null;
            if (mode === 'edit') {
              return (
                <li key={s.name}>
                  <EditForm
                    snapshot={s}
                    snapshots={feed.snapshots}
                    onCancel={() => setRow(null)}
                    onSave={(newName, description) => {
                      onSend('edit', s.name, description, newName);
                      setRow(null);
                    }}
                  />
                </li>
              );
            }
            return (
              <li key={s.name} className={styles.snapItem}>
                <button
                  className={cx(styles.snapRow, current && styles.snapCurrent, loading && styles.snapLoading)}
                  onClick={() => load(s)}
                  disabled={Boolean(blocked)}
                  aria-current={current ? 'true' : undefined}
                  title={blocked ?? `Load ${s.name}${i < 9 && keys ? ` (${i + 1})` : ''}`}
                >
                  {i < 9 && keys && <kbd className={styles.snapKey}>{i + 1}</kbd>}
                  <span className={styles.snapMain}>
                    <span className={styles.snapName}>{s.name}</span>
                    {s.description && <span className={styles.snapDesc}>{s.description}</span>}
                  </span>
                  <span className={styles.snapMeta}>
                    <span title={new Date(s.timestamp).toLocaleString()}>{formatAgo(now - s.timestamp)}</span>
                    {s.trackCount !== undefined && (
                      <span>
                        {s.trackCount} track{s.trackCount === 1 ? '' : 's'}
                        {s.scoped ? ' only' : ''}
                      </span>
                    )}
                    {s.fullChunk && <span title="Exact track state: every plugin's internal state">exact</span>}
                  </span>
                  <span className={styles.snapState}>{loading ? 'Loading…' : current ? 'Loaded' : 'Load'}</span>
                </button>
                {mode === 'delete' ? (
                  <span className={styles.snapActions} role="group" aria-label={`Delete ${s.name}?`}>
                    <span className={styles.snapConfirmText}>Delete?</span>
                    <button
                      className="btn btn-sm btn-warn"
                      autoFocus
                      onClick={() => {
                        onSend('delete', s.name);
                        setRow(null);
                      }}
                    >
                      Delete
                    </button>
                    <button className="btn btn-sm" onClick={() => setRow(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className={styles.snapActions}>
                    <button className="btn btn-sm" disabled={Boolean(blocked)} onClick={() => setRow({ name: s.name, mode: 'edit' })} title={blocked ?? `Rename ${s.name} or change its description`}>
                      Rename
                    </button>
                    <button className="btn btn-sm" disabled={Boolean(blocked)} onClick={() => setRow({ name: s.name, mode: 'delete' })} title={blocked ?? `Delete ${s.name}`}>
                      Delete
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {feed && (
        <p className={cx(styles.snapFoot, 'muted')}>
          {feed.storage === 'project' ? 'Saved next to the project, in .reaper-mcp/snapshots.' : 'The project isn’t saved yet: snapshots go to the bridge folder.'}{' '}
          Each load is one undo step.
        </p>
      )}
    </div>
  );
}

function RequestLine({ request }: { request: RequestState | null }) {
  if (!request) return null;
  const verb = { restore: 'load', save: 'save', delete: 'delete', edit: 'rename' }[request.op];
  const done = { restore: 'loaded', save: 'saved', delete: 'deleted', edit: 'renamed' }[request.op];
  let tone = 'info';
  let text: string;
  let warnings: string[] = [];
  if (request.state === 'pending') {
    text = `${{ restore: 'Loading', save: 'Saving', delete: 'Deleting', edit: 'Saving' }[request.op]} ${request.name}…`;
  } else if (request.state === 'lost') {
    tone = 'bad';
    text = `No answer from the bridge: ${request.name} wasn’t ${done}. Is the bridge script running?`;
  } else if (request.result.ok) {
    tone = request.result.warnings?.length ? 'warn' : 'ok';
    warnings = request.result.warnings ?? [];
    const n = request.result.tracksRestored;
    text =
      request.op === 'restore'
        ? `Loaded ${request.name}${n !== undefined ? ` · ${n} track${n === 1 ? '' : 's'}` : ''}${warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`
        : `${{ save: 'Saved', delete: 'Deleted', edit: 'Saved' }[request.op]} ${request.name}`;
  } else {
    tone = 'bad';
    text = `Couldn’t ${verb} ${request.name}: ${request.result.error ?? 'refused by the bridge'}`;
  }
  return (
    <div className={styles.snapResult} data-tone={tone} role="status">
      <span>{text}</span>
      {warnings.length > 0 && (
        <ul className={styles.snapWarnings}>
          {warnings.slice(0, 5).map((w) => (
            <li key={w}>{w}</li>
          ))}
          {warnings.length > 5 && <li>…and {warnings.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}
