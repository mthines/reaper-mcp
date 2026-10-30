import { useMemo } from 'react';
import { track } from '../../lib/analytics.js';
import { useUrlState } from '../../lib/url-state.js';
import { formatAgo, formatMs, matchesQuery, parseQuery, speedOf, groupByTool, type CommandEntry, type ToolSort } from '../../lib/status.js';
import { TOOL_TONE } from './speed.js';

const isToolSort = (v: unknown): v is ToolSort => TOOL_SORTS.some((x) => x.key === v);

const TOOL_SORTS: Array<{ key: ToolSort; label: string }> = [
  { key: 'count', label: 'Calls' },
  { key: 'errors', label: 'Errors' },
  { key: 'slowest', label: 'p95' },
  { key: 'recent', label: 'Last' },
];

/** One row per command type: how often, how reliable, how fast. Click a row to see its calls. */
export function ToolsView({
  log,
  query,
  now,
  onPick,
}: {
  log: CommandEntry[];
  query: string;
  now: number;
  onPick: (tool: string, errors: boolean) => void;
}) {
  const [sort, setSort] = useUrlState<ToolSort>('sort', 'count', { validate: isToolSort });
  // Param terms narrow the calls counted, words the tools shown
  const groups = useMemo(() => {
    const terms = parseQuery(query);
    const params = terms.filter((t) => t.key !== undefined);
    const words = terms.filter((t) => t.key === undefined);
    const calls = params.length ? log.filter((e) => matchesQuery(e, params)) : log;
    return groupByTool(calls, sort).filter((g) => words.every((w) => g.c.includes(w.value)));
  }, [log, sort, query]);
  const top = Math.max(1, ...groups.map((g) => g.count));
  const kinds = useMemo(() => {
    const k = { read: 0, write: 0, transport: 0 };
    for (const g of groupByTool(log)) k[g.kind] += g.count;
    return k;
  }, [log]);

  if (log.length === 0) return <div className="rows"><div className="empty">No commands yet. Tools show up here once your agent calls them.</div></div>;

  return (
    <div className="rows tools">
      <div className="mix" aria-label="Calls by kind">
        {(['read', 'write', 'transport'] as const).map((k) =>
          kinds[k] ? <span key={k} className={`mix-seg kind-${k}`} style={{ flexGrow: kinds[k] }} title={`${kinds[k]} ${k}`} /> : null,
        )}
      </div>
      <div className="mix-legend">
        <span><i className="kdot kind-read" /> inspect {kinds.read}</span>
        <span><i className="kdot kind-write" /> change {kinds.write}</span>
        <span><i className="kdot kind-transport" /> transport {kinds.transport}</span>
        <span className="mix-note">{groups.length} tools · last {log.length} calls</span>
      </div>
      <div className="tool-head" role="row">
        <span>Tool</span>
        {TOOL_SORTS.map((x) => (
          <button key={x.key} className={`th ${sort === x.key ? 'th-on' : ''}`} onClick={() => {
            if (x.key !== sort) track({ name: 'tools_sorted', sort: x.key });
            setSort(x.key);
          }} aria-pressed={sort === x.key}>
            {x.label}
            {sort === x.key && ' ↓'}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="empty">No tool matches that filter.</div>
      ) : (
        groups.map((g) => (
          <button key={g.c} className="tool-row" onClick={() => onPick(g.c, false)} title={g.lastError ? `Last error: ${g.lastError}` : `Show ${g.c} calls`}>
            <span className="tool-name">
              <i className={`kdot kind-${g.kind}`} />
              <span className="mono">{g.c}</span>
              <span className="share" aria-hidden>
                <span style={{ width: `${(g.count / top) * 100}%` }} />
              </span>
            </span>
            <span className="mono num">{g.count}</span>
            <span
              className={`mono num ${g.errors ? 'tone-bad err-link' : 'muted'}`}
              onClick={(ev) => {
                if (!g.errors) return;
                ev.stopPropagation();
                onPick(g.c, true);
              }}
            >
              {g.errors ? `${g.errors} · ${Math.round((g.errors / g.count) * 100)}%` : '0'}
            </span>
            <span className={`mono num ${TOOL_TONE[speedOf(g.c, g.p95)]}`}>{formatMs(g.p95)}</span>
            <span className="num muted">{formatAgo(now - g.last)}</span>
          </button>
        ))
      )}
    </div>
  );
}
