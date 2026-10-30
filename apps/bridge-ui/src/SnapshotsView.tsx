import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatAgo } from './status.js';
import { DESCRIPTION_MAX, nameProblem, replacedBy, type RequestState, type SnapshotInfo, type SnapshotOp, type SnapshotsFeed } from './snapshots.js';

/**
 * The Snapshots view: the project's saved mixer snapshots. Click one (or press 1–9) to load it while
 * listening, for a quick A/B/C; save the current mix under a new name. Both go through the bridge's normal
 * command path, so they show in the log, are one undo point, and are refused while read-only or paused.
 */
export function SnapshotsView({
  feed,
  request,
  blocked,
  query = '',
  now,
  onSend,
  keys = true,
}: {
  /** Null until the bridge has published its list */
  feed: SnapshotsFeed | null;
  request: RequestState | null;
  /** Why restore and save are off (read-only, paused), or null */
  blocked: string | null;
  query?: string;
  now: number;
  onSend: (op: SnapshotOp, name: string, description?: string) => void;
  /** Number keys load snapshots (off in the gallery, where several views share the page) */
  keys?: boolean;
}) {
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
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
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
    <div className="snaps">
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
            return (
              <li key={s.name}>
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
  const replaces = name.trim() ? replacedBy(snapshots, name) : null;
  const problem = name ? nameProblem(name) : null;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (blocked || saving || nameProblem(name)) return;
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
        placeholder="Name, e.g. mix-D"
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
      <button className={`btn${confirm ? ' btn-warn' : ''}`} type="submit" disabled={Boolean(blocked) || saving || !name.trim() || Boolean(problem)}>
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

/** Gallery: the save form with a name typed that would replace a snapshot */
export function SaveFormPreview(props: { snapshots: SnapshotInfo[]; name: string; confirm?: boolean }) {
  return <SaveForm snapshots={props.snapshots} blocked={null} saving={false} onSave={() => undefined} initial={{ name: props.name, confirm: props.confirm }} />;
}

function RequestLine({ request }: { request: RequestState | null }) {
  if (!request) return null;
  const verb = request.op === 'restore' ? 'load' : 'save';
  let tone = 'info';
  let text: string;
  let warnings: string[] = [];
  if (request.state === 'pending') {
    text = request.op === 'restore' ? `Loading ${request.name}…` : `Saving ${request.name}…`;
  } else if (request.state === 'lost') {
    tone = 'bad';
    text = `No answer from the bridge: ${request.name} wasn’t ${verb === 'load' ? 'loaded' : 'saved'}. Is the bridge script running?`;
  } else if (request.result.ok) {
    tone = request.result.warnings?.length ? 'warn' : 'ok';
    warnings = request.result.warnings ?? [];
    const n = request.result.tracksRestored;
    text =
      request.op === 'restore'
        ? `Loaded ${request.name}${n !== undefined ? ` · ${n} track${n === 1 ? '' : 's'}` : ''}${warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`
        : `Saved ${request.name}`;
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
