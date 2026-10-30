import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GroupedCombobox } from '../../components/Combobox.js';
import { track } from '../../lib/analytics.js';
import { PluginsView } from '../plugins/PluginsView.js';
import { SnapshotsView } from '../snapshots/SnapshotsView.js';
import type { SnapshotsHook } from '../snapshots/useSnapshots.js';
import { isNumberOrNull, isString, isStringOrNull, useUrlState } from '../../lib/url-state.js';
import type { KnowledgeFeed } from '../plugins/plugins.js';
import { SearchIcon } from '../../components/icons.js';
import { Details } from './Details.js';
import { LogRows } from './LogRows.js';
import { SessionsView } from './SessionsView.js';
import { ToolsView } from './ToolsView.js';
import { OUTCOME_TAG } from './outcome.js';
import { spanLabel } from '../timeline/Timeline.js';
import { RANGES, type RangeKey, rangeOf } from '../timeline/ranges.js';
import { load } from '../../lib/storage.js';
import { LOG_MAX } from '../../lib/log.js';
import { measurementHistory, outcomeOf, type CommandEntry } from '../../lib/commands.js';
import { matchesQuery, parseQuery } from '../../lib/search.js';
import { hasToolCalls, isConnected, sessionHue, sessionName, type Session } from '../../lib/sessions.js';
import type { Span } from '../../lib/timeline.js';

type Filter = 'all' | 'errors';
export type View = 'calls' | 'tools' | 'sessions' | 'plugins' | 'snapshots';
export const VIEW_KEY = 'mcp-bridge-view';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'calls', label: 'Calls' },
  { key: 'tools', label: 'Tools' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'plugins', label: 'Plugins' },
  { key: 'snapshots', label: 'Snapshots' },
];

export const isView = (v: unknown): v is View => VIEWS.some((x) => x.key === v);
const isFilter = (v: unknown): v is Filter => v === 'all' || v === 'errors';
export const isSpanOrNull = (v: unknown): v is Span | null =>
  v === null || (typeof v === 'object' && typeof (v as Span).start === 'number' && typeof (v as Span).end === 'number');

export function loadView(): View {
  const saved = load(VIEW_KEY);
  return isView(saved) ? saved : 'calls';
}

export function Log({
  log,
  selection,
  rangeKey,
  onRange,
  oldestKept,
  onClearSelection,
  sessions,
  knowledge,
  snapshots,
  view,
  onView,
  paused,
  onTogglePause,
  onClear,
  now,
  onOpenSettings,
}: {
  log: CommandEntry[];
  /** The timeline span the log is filtered to, if any */
  selection: Span | null;
  /** The timeline range the calls and tools views are windowed to; null while a span is selected */
  rangeKey: RangeKey | null;
  onRange: (key: RangeKey) => void;
  /** Time of the oldest entry the page holds, before the selection filter */
  oldestKept: number | null;
  onClearSelection: () => void;
  sessions: Map<string, Session>;
  knowledge?: KnowledgeFeed;
  /** The Snapshots tab's feed, when the bridge serves it; `blocked` says why restore and save are off */
  snapshots?: SnapshotsHook & { blocked: string | null };
  onOpenSettings?: () => void;
  view: View;
  onView: (v: View) => void;
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  now: number;
}) {
  const [filter, setFilter] = useUrlState<Filter>('filter', 'all', { validate: isFilter });
  // Typing replaces the history entry instead of adding one per keystroke
  const [query, setQuery] = useUrlState('q', '', { validate: isString, navigationMode: 'replace' });
  const [sessionFilter, setSessionFilter] = useUrlState<string | null>('agent', null, { validate: isStringOrNull });
  // The open command, by sequence number: it opens once the log holds it (also after a reload)
  const [selectedN, setSelectedN] = useUrlState<number | null>('entry', null, { validate: isNumberOrNull });
  const selected = useMemo(() => (selectedN === null ? null : (log.find((e) => e.n === selectedN) ?? null)), [log, selectedN]);
  const setSelected = useCallback(
    (e: CommandEntry | null, mode?: 'push' | 'replace') => setSelectedN(e ? e.n : null, mode),
    [setSelectedN],
  );
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const choose = (v: View) => {
    onView(v);
    if (v !== 'calls') setSelected(null);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === '/' && document.activeElement !== searchRef.current) {
        ev.preventDefault();
        searchRef.current?.focus();
      } else if (ev.key === 'Escape') {
        // Close the details sidebar first, then clear the chart selection, then the filter
        if (selectedRef.current) setSelected(null);
        else if (!clearChartSelection.current()) {
          setQuery('');
          searchRef.current?.blur();
        }
      } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && selectedRef.current) {
        ev.preventDefault();
        const list = rowsRef.current;
        const i = list.findIndex((e) => e.n === selectedRef.current?.n);
        const next = list[i + (ev.key === 'ArrowDown' ? 1 : -1)];
        if (next) setSelected(next, 'replace'); // stepping through rows doesn't add history
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sessions seen in this window's log, plus any the bridge knows about
  const sessionIds = useMemo(() => {
    // Agents that have only pinged are left out: no calls to filter by
    const ids = new Set([...sessions.values()].filter(hasToolCalls).map((x) => x.id));
    for (const e of log) if (e.s) ids.add(e.s);
    // Oldest first, so chips don't reshuffle as agents take turns
    const first = (id: string) => sessions.get(id)?.first ?? Infinity;
    return [...ids].sort((a, b) => first(a) - first(b));
  }, [log, sessions]);
  const multiSession = sessionIds.length > 1;
  const sessionOf = (id: string): Session => sessions.get(id) ?? { id, first: 0, last: 0, commands: 0, errors: 0 };

  const range = rangeKey ? rangeOf(rangeKey) : null;
  const since = range ? now - range.ms : null;
  const windowed = useMemo(() => (since === null ? log : log.filter((e) => e.t >= since)), [log, since]);
  const scoped = useMemo(() => (sessionFilter ? windowed.filter((e) => e.s === sessionFilter) : windowed), [windowed, sessionFilter]);
  const errorCount = useMemo(() => scoped.filter((e) => outcomeOf(e) === 'error').length, [scoped]);
  // Every match the page holds, then the ones inside the range: the rest are offered at the end of the list
  const matches = useMemo(() => {
    const terms = parseQuery(query);
    return log.filter(
      (e) =>
        (!sessionFilter || e.s === sessionFilter) &&
        (filter === 'all' || outcomeOf(e) === 'error') &&
        matchesQuery(e, terms),
    );
  }, [log, sessionFilter, filter, query]);
  const rows = useMemo(() => (since === null ? matches : matches.filter((e) => e.t >= since)), [matches, since]);
  const older = matches.length - rows.length;
  // The smallest wider range that brings in the next older match
  const wider = useMemo(() => {
    const next = matches[rows.length];
    if (!range || !next) return null;
    return RANGES.find((r) => r.ms > range.ms && next.t >= now - r.ms) ?? RANGES[RANGES.length - 1];
  }, [matches, rows.length, range, now]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Esc clears the chart selection where its banner shows; true when there was one to clear
  const clearChartSelection = useRef((): boolean => false);
  clearChartSelection.current = () => {
    if (!selection || view === 'plugins' || view === 'snapshots') return false;
    track({ name: 'timeline_span_selected', selected: false });
    onClearSelection();
    return true;
  };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const selectRow = useCallback(
    (e: CommandEntry) => {
      const open = selectedRef.current?.n === e.n;
      if (!open) track({ name: 'log_entry_opened', ok: e.ok });
      // Every click is a step Back undoes (opening, closing or switching rows); only ↑/↓ replaces
      setSelected(open ? null : e, 'push');
    },
    [setSelected],
  );
  // Start of today: the rows only need to re-render when "Today" becomes "Yesterday"
  const today = new Date(now).setHours(0, 0, 0, 0);

  const chooseFilter = (f: 'all' | 'errors') => {
    if (f !== filter) track({ name: 'log_filtered', filter: f });
    setFilter(f);
  };
  // One event per search, when the box goes from empty to typed in; the text itself is never sent
  const search = (q: string) => {
    if (!query.trim() && q.trim()) track({ name: 'log_searched', view });
    setQuery(q);
  };

  const copy = async () => {
    track({ name: 'log_copied', what: 'rows' });
    const text = rows
      .map((e) => `${new Date(e.t).toISOString()}  #${e.n}  ${OUTCOME_TAG[outcomeOf(e)]}  ${e.c}  ${e.ms}ms${e.s ? `  [${sessionName(sessionOf(e.s))}]` : ''}${e.e ? `  ${e.e}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard needs a secure context (localhost is fine; LAN IPs are not)
    }
  };

  const clear = () => {
    track({ name: 'log_cleared' });
    setSelected(null);
    onClear();
  };
  const chooseSession = (id: string | null) => {
    if (id !== null && sessionFilter !== id) track({ name: 'session_filtered' });
    setSessionFilter(id);
  };
  const shownViews = VIEWS.filter((v) => (v.key !== 'plugins' || knowledge) && (v.key !== 'snapshots' || snapshots));
  const agentsShown = multiSession && (view === 'calls' || view === 'tools');

  const showCalls = (opts: { tool?: string; session?: string; errors?: boolean }) => {
    if (opts.tool !== undefined) setQuery(opts.tool);
    if (opts.session !== undefined) setSessionFilter(opts.session);
    setFilter(opts.errors ? 'errors' : 'all');
    choose('calls');
  };

  return (
    <section className="log">
      <div className="toolbar">
        <GroupedCombobox
          className="log-menu"
          label="View, filters and actions"
          triggerLabel={[
            VIEWS.find((v) => v.key === view)?.label,
            view === 'calls' && filter === 'errors' ? 'Errors' : null,
            agentsShown && sessionFilter ? sessionName(sessionOf(sessionFilter)) : null,
            view === 'calls' && paused ? 'Paused' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          groups={[
            { label: 'View', items: shownViews.map((v) => ({ key: v.key, label: v.label, selected: view === v.key, onPick: () => choose(v.key) })) },
            {
              label: 'Show',
              items:
                view === 'calls'
                  ? [
                      { key: 'all', label: <>All <span className="count">{scoped.length}</span></>, selected: filter === 'all', onPick: () => chooseFilter('all') },
                      {
                        key: 'errors',
                        label: <>Errors <span className={`count ${errorCount ? 'count-bad' : ''}`}>{errorCount}</span></>,
                        selected: filter === 'errors',
                        onPick: () => chooseFilter('errors'),
                      },
                    ]
                  : [],
            },
            {
              label: 'Agent',
              items: agentsShown
                ? [
                    { key: '', label: 'All agents', selected: sessionFilter === null, onPick: () => chooseSession(null) },
                    ...sessionIds.map((id) => ({
                      key: id,
                      label: (
                        <>
                          <i className={`sdot hue-${sessionHue(id)} ${isConnected(sessionOf(id), now) ? '' : 'sdot-off'}`} />
                          {sessionName(sessionOf(id))}
                          <span className="count">{windowed.filter((e) => e.s === id).length}</span>
                        </>
                      ),
                      selected: sessionFilter === id,
                      onPick: () => chooseSession(id),
                    })),
                  ]
                : [],
            },
            {
              label: 'Actions',
              items:
                view === 'calls'
                  ? [
                      { key: 'pause', label: paused ? 'Resume' : 'Pause', hint: paused ? undefined : 'Freeze the log to read it', onPick: onTogglePause },
                      { key: 'copy', label: 'Copy visible rows', disabled: rows.length === 0, onPick: () => void copy() },
                      { key: 'clear', label: 'Clear', hint: 'The bridge keeps its history', disabled: log.length === 0, onPick: clear },
                    ]
                  : [],
            },
          ]}
        />
        <div className="seg" role="tablist" aria-label="View">
          {shownViews.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => choose(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        {view === 'calls' && (
          <div className="seg" role="tablist" aria-label="Result">
            <button role="tab" aria-selected={filter === 'all'} onClick={() => chooseFilter('all')}>
              All <span className="count">{scoped.length}</span>
            </button>
            <button role="tab" aria-selected={filter === 'errors'} onClick={() => chooseFilter('errors')}>
              Errors <span className={`count ${errorCount ? 'count-bad' : ''}`}>{errorCount}</span>
            </button>
          </div>
        )}
        {view !== 'sessions' && (
          <label className="search">
            <SearchIcon />
            <input
              ref={searchRef}
              value={query}
              onChange={(ev) => search(ev.target.value)}
              placeholder={
                view === 'tools'
                  ? 'Filter tools'
                  : view === 'plugins'
                    ? 'Filter plugins or categories'
                    : view === 'snapshots'
                      ? 'Filter snapshots'
                      : 'Filter commands or errors'
              }
              spellCheck={false}
            />
            {!query && <kbd>/</kbd>}
          </label>
        )}
        {view === 'calls' && (
          <div className="actions">
            <button className={`btn ${paused ? 'btn-on' : ''}`} onClick={onTogglePause} title="Freeze the log to read it">
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn" onClick={copy} disabled={rows.length === 0} title="Copy visible rows">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              className="btn"
              onClick={clear}
              disabled={log.length === 0}
              title="Clear the log and the chart in this window (the bridge keeps its history and the counters)"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {selection && view !== 'plugins' && view !== 'snapshots' && (
        <div className="selection-bar" role="status">
          <span>
            Showing <b>{log.length.toLocaleString()}</b> command{log.length === 1 ? '' : 's'} from{' '}
            <span className="mono">{spanLabel(selection)}</span>
            {(oldestKept === null || selection.start < oldestKept) && (
              <span className="selection-note"> · the log keeps the latest {LOG_MAX.toLocaleString()}; older commands are only counted in the chart</span>
            )}
          </span>
          <button className="btn" onClick={onClearSelection} title="Clear selection (Esc)">
            Clear selection
          </button>
        </div>
      )}

      {agentsShown && (
        <div className="chips" role="tablist" aria-label="Agent session">
          <button role="tab" aria-selected={sessionFilter === null} className="chip" onClick={() => chooseSession(null)}>
            All agents
          </button>
          {sessionIds.map((id) => {
            const x = sessionOf(id);
            const n = windowed.filter((e) => e.s === id).length;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={sessionFilter === id}
                className="chip"
                title={x.dir ?? id}
                onClick={() => chooseSession(sessionFilter === id ? null : id)}
              >
                <i className={`sdot hue-${sessionHue(id)} ${isConnected(x, now) ? '' : 'sdot-off'}`} />
                {sessionName(x)}
                <span className="count">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'plugins' && knowledge ? (
        <PluginsView feed={knowledge} query={query} now={now} onOpenSettings={onOpenSettings} />
      ) : view === 'snapshots' && snapshots ? (
        <SnapshotsView feed={snapshots.feed} request={snapshots.request} blocked={snapshots.blocked} query={query} now={now} onSend={snapshots.send} />
      ) : view === 'tools' ? (
        <ToolsView log={scoped} query={query} now={now} onPick={(tool, errors) => {
            track({ name: 'tool_picked', errors_only: errors });
            showCalls({ tool, errors });
          }} />
      ) : view === 'sessions' ? (
        <SessionsView ids={sessionIds} sessionOf={sessionOf} log={log} now={now} onPick={(session) => {
            track({ name: 'session_picked' });
            showCalls({ session, tool: '' });
          }} />
      ) : (
        <div className="rows" role="log" aria-live="off">
          {rows.length === 0 ? (
            <div className="empty">
              {log.length === 0
                ? 'No commands yet. New ones show up here as your agent sends them.'
                : older > 0 && range
                  ? `Nothing in the ${range.label.toLowerCase()}.`
                  : filter === 'errors' && !query
                    ? 'No errors. Nice.'
                    : 'Nothing matches that filter.'}
            </div>
          ) : (
            <LogRows
              rows={rows}
              today={today}
              selectedN={selected?.n}
              sessionOf={multiSession && !sessionFilter ? sessionOf : null}
              onSelect={selectRow}
            />
          )}
          {wider && (
            <div className="log-more">
              <span>
                {older.toLocaleString()} older {older === 1 ? 'command' : 'commands'}
              </span>
              <button className="btn btn-sm" onClick={() => onRange(wider.key)}>
                Show {wider.label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
      {paused && view === 'calls' && <div className="paused-banner">Paused · new commands are still counted, the log is frozen</div>}
      {selected && (
        <Details
          entry={selected}
          session={selected.s ? sessionOf(selected.s) : null}
          now={now}
          filtered={query.trim() === selected.c}
          // A step Back undoes, unlike typing in the search box
          onFilter={() => {
            const off = query.trim() === selected.c;
            if (!off && !query.trim()) track({ name: 'log_searched', view });
            setQuery(off ? '' : selected.c, 'push');
          }}
          onAddTerm={(term) => {
            if (!query.trim()) track({ name: 'log_searched', view });
            setQuery((q) => (parseQuery(q).some((t) => JSON.stringify(t) === JSON.stringify(parseQuery(term)[0])) ? q : `${q.trim()} ${term}`.trim()), 'push');
          }}
          onClose={() => setSelected(null)}
          history={measurementHistory(log, selected)}
          onPick={(e) => setSelected(e, 'push')}
        />
      )}
    </section>
  );
}
