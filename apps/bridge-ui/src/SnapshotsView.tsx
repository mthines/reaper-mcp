import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatAgo } from './status.js';
import { DESCRIPTION_MAX, nameProblem, replacedBy, type RequestState, type RowMode, type SnapshotInfo, type SnapshotOp, type SnapshotsFeed } from './snapshots.js';

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
  /** Number keys load snapshots (off in the gallery, where several views share the page) */
  keys?: boolean;
  /** Gallery: start with this row in rename or delete-confirm mode */
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
  const loadRef = useRef(load);
  loadRef.current = load;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!keys) return;
    const onKey = (ev: KeyboardEvent) => {
      const el = document.activeElement;
      // A held key auto-repeats: load once, not once per repeat (each load is an undo point)
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
      const n = Number(ev.key);
      const snap = Number.isInteger(n) && n >= 1 ? shownRef.current[n - 1] : undefined;
      if (!snap) return;
      ev.preventDefault();
      loadRef.current(snap);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  return (
    <div className="rows snaps">
      <SaveForm snapshots={feed?.snapshots ?? []} blocked={blocked} saving={pending?.op === 'save'} onSave={(name, desc) => onSend('save', name, desc)} />
      {blocked && (
        <p className="snap-blocked" role="note">
          {blocked}
        </p>
      )}
      <RequestLine request={request} />
      {feed === null ? (
        <div className="empty">Reading snapshots from the bridge…</div>
      ) : feed.snapshots.length === 0 ? (
        <div className="empty">No snapshots yet. Save the current mix to start comparing.</div>
      ) : shown.length === 0 ? (
        <div className="empty">No snapshot matches “{query.trim()}”.</div>
      ) : (
        <ol className="snap-list" aria-label="Snapshots">
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
              <li key={s.name} className="snap-item">
                <button
                  className={`snap-row${current ? ' snap-current' : ''}${loading ? ' snap-loading' : ''}`}
                  onClick={() => load(s)}
                  disabled={Boolean(blocked)}
                  aria-current={current ? 'true' : undefined}
                  title={blocked ?? `Load ${s.name}${i < 9 && keys ? ` (${i + 1})` : ''}`}
                >
                  {i < 9 && keys && <kbd className="snap-key">{i + 1}</kbd>}
                  <span className="snap-main">
                    <span className="snap-name">{s.name}</span>
                    {s.description && <span className="snap-desc">{s.description}</span>}
                  </span>
                  <span className="snap-meta">
                    <span title={new Date(s.timestamp).toLocaleString()}>{formatAgo(now - s.timestamp)}</span>
                    {s.trackCount !== undefined && (
                      <span>
                        {s.trackCount} track{s.trackCount === 1 ? '' : 's'}
                        {s.scoped ? ' only' : ''}
                      </span>
                    )}
                    {s.fullChunk && <span title="Exact track state: every plugin's internal state">exact</span>}
                  </span>
                  <span className="snap-state">{loading ? 'Loading…' : current ? 'Loaded' : 'Load'}</span>
                </button>
                {mode === 'delete' ? (
                  <span className="snap-actions snap-confirm" role="group" aria-label={`Delete ${s.name}?`}>
                    <span className="snap-confirm-text">Delete?</span>
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
                  <span className="snap-actions">
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
        <p className="snap-foot muted">
          {feed.storage === 'project' ? 'Saved next to the project, in .reaper-mcp/snapshots.' : 'The project isn’t saved yet: snapshots go to the bridge folder.'}{' '}
          Each load is one undo step.
        </p>
      )}
    </div>
  );
}

function SaveForm({
  snapshots,
  blocked,
  saving,
  onSave,
  initial,
}: {
  snapshots: SnapshotInfo[];
  blocked: string | null;
  saving: boolean;
  onSave: (name: string, description: string) => void;
  /** Gallery: start with these values */
  initial?: { name: string; description?: string; confirm?: boolean };
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [confirm, setConfirm] = useState(initial?.confirm ?? false);
  // A blank name saves under the date and time (the hook picks one no snapshot uses)
  const replaces = name.trim() ? replacedBy(snapshots, name) : null;
  const problem = name.trim() ? nameProblem(name) : null;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (blocked || saving || problem) return;
    if (replaces && !confirm) {
      setConfirm(true);
      return;
    }
    onSave(name.trim(), description.trim());
    setName('');
    setDescription('');
    setConfirm(false);
  };

  return (
    <form className="snap-save" onSubmit={submit} aria-label="Save a snapshot">
      <input
        className="snap-input"
        value={name}
        onChange={(ev) => {
          setName(ev.target.value);
          setConfirm(false);
        }}
        placeholder="Name (blank: date and time)"
        aria-label="Snapshot name"
        aria-invalid={problem ? true : undefined}
        spellCheck={false}
        disabled={Boolean(blocked)}
      />
      <input
        className="snap-input snap-input-desc"
        value={description}
        onChange={(ev) => setDescription(ev.target.value)}
        placeholder="Description (optional)"
        aria-label="Snapshot description"
        maxLength={DESCRIPTION_MAX}
        disabled={Boolean(blocked)}
      />
      <button className={`btn${confirm ? ' btn-warn' : ''}`} type="submit" disabled={Boolean(blocked) || saving || Boolean(problem)}>
        {saving ? 'Saving…' : confirm ? `Replace ${replaces?.name ?? ''}` : 'Save current mix'}
      </button>
      {(problem || (replaces && !confirm)) && (
        <span className={`snap-hint${problem ? ' snap-hint-bad' : ''}`} role="status">
          {problem ?? `Saving replaces “${replaces?.name}”.`}
        </span>
      )}
    </form>
  );
}

/** Rename a snapshot and change its description, in place of its row */
function EditForm({
  snapshot,
  snapshots,
  onSave,
  onCancel,
}: {
  snapshot: SnapshotInfo;
  snapshots: SnapshotInfo[];
  onSave: (newName: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(snapshot.name);
  const [description, setDescription] = useState(snapshot.description);
  const problem = nameProblem(name);
  // Another snapshot already saves to that file (the bridge refuses it too); its own file is fine
  const taken = !problem ? replacedBy(snapshots.filter((s) => s.name !== snapshot.name), name) : null;
  const unchanged = name.trim() === snapshot.name && description.trim() === snapshot.description;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (problem || taken) return;
    if (unchanged) return onCancel();
    onSave(name.trim(), description.trim());
  };

  return (
    <form
      className="snap-save snap-edit"
      onSubmit={submit}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') onCancel();
      }}
      aria-label={`Edit ${snapshot.name}`}
    >
      <input
        className="snap-input"
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        aria-label="New name"
        aria-invalid={problem || taken ? true : undefined}
        spellCheck={false}
        autoFocus
      />
      <input
        className="snap-input snap-input-desc"
        value={description}
        onChange={(ev) => setDescription(ev.target.value)}
        placeholder="Description (optional)"
        aria-label="Description"
        maxLength={DESCRIPTION_MAX}
      />
      <button className="btn" type="submit" disabled={Boolean(problem || taken)}>
        Save
      </button>
      <button className="btn" type="button" onClick={onCancel}>
        Cancel
      </button>
      {(problem || taken) && (
        <span className="snap-hint snap-hint-bad" role="status">
          {problem ?? `“${taken?.name}” already uses that name.`}
        </span>
      )}
    </form>
  );
}

/** Gallery: the save form with a name typed that would replace a snapshot */
export function SaveFormPreview(props: { snapshots: SnapshotInfo[]; name: string; confirm?: boolean }) {
  return <SaveForm snapshots={props.snapshots} blocked={null} saving={false} onSave={() => undefined} initial={{ name: props.name, confirm: props.confirm }} />;
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
    <div className={`snap-result snap-result-${tone}`} role="status">
      <span>{text}</span>
      {warnings.length > 0 && (
        <ul className="snap-warnings">
          {warnings.slice(0, 5).map((w) => (
            <li key={w}>{w}</li>
          ))}
          {warnings.length > 5 && <li>…and {warnings.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}
