import { useEffect, useMemo, useRef, useState } from 'react';
import { ResizeHandle, useDrawerWidth } from './ResizeHandle.js';
import { formatAgo } from './status.js';
import { lorekitUrl, notInstalled, pluginCoverage, type Coverage, type KnowledgeFeed, type PluginRecord, type PluginRow } from './plugins.js';

type Filter = 'all' | Coverage;

/** Prompt for one plugin: the exact FX name so the agent loads the right one on its scratch track. */
export const learnPrompt = (row: PluginRow) => `/learn-plugin ${row.fx.name}`;

/** One prompt for several: /learn-plugin handles one plugin per run, so ask for them in turn. */
export const learnAllPrompt = (rows: PluginRow[]) =>
  rows.length === 1
    ? learnPrompt(rows[0])
    : `Run /learn-plugin for each of these installed plugins, one at a time:\n${rows.map((r) => `- ${r.fx.name}`).join('\n')}`;

function useCopy(): [string | null, (text: string, what: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2200);
    } catch {
      // clipboard needs a secure context (localhost is fine)
    }
  };
  return [copied, copy];
}

const COVERAGE_LABEL: Record<Coverage, string> = {
  learned: 'Learned by you',
  'built-in': 'Built-in',
  unknown: 'Unknown',
};

/**
 * Which installed plugins the mix skills know, and from where: your own LoreKit records win over the
 * built-in ones. Read-only; unknown plugins point at /learn-plugin.
 */
export function PluginsView({ feed, query, now }: { feed: KnowledgeFeed | undefined; query: string; now: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<PluginRow | null>(null);
  const [copied, copy] = useCopy();
  const rows = useMemo(() => (feed ? pluginCoverage(feed) : []), [feed]);
  const elsewhere = useMemo(() => (feed ? notInstalled(feed) : []), [feed]);
  const visibleRef = useRef<PluginRow[]>([]);
  const openRef = useRef(open);
  openRef.current = open;

  // ↑/↓ step through the list while a plugin is open, like the Calls tab
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') || !openRef.current) return;
      if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, [role="separator"]')) return;
      ev.preventDefault();
      const list = visibleRef.current;
      const i = list.findIndex((r) => r.fx.name === openRef.current?.fx.name);
      const next = list[i + (ev.key === 'ArrowDown' ? 1 : -1)];
      if (next) setOpen(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) document.querySelector(`[data-fx="${CSS.escape(open.fx.name)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  if (!feed) {
    return (
      <div className="rows">
        <div className="empty">Plugin knowledge isn’t available from this bridge yet.</div>
      </div>
    );
  }

  const count = (c: Coverage) => rows.filter((r) => r.coverage === c).length;
  const q = query.trim().toLowerCase();
  const visible = rows
    .filter((r) => (filter === 'all' || r.coverage === filter) && (!q || r.label.toLowerCase().includes(q) || r.record?.category.includes(q)))
    .sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label));
  visibleRef.current = visible;
  const known = rows.length - count('unknown');
  const unknown = rows.filter((r) => r.coverage === 'unknown');

  return (
    <div className="rows plugins">
      <div className="kn-summary">
        <div className="kn-meter" aria-label={`${known} of ${rows.length} installed plugins known`}>
          <span className="kn-seg kn-learned" style={{ flexGrow: count('learned') }} />
          <span className="kn-seg kn-builtin" style={{ flexGrow: count('built-in') }} />
          <span className="kn-seg kn-unknown" style={{ flexGrow: count('unknown') }} />
        </div>
        <div className="kn-head">
          <p className="kn-headline">
            The mixer knows <b>{known}</b> of your <b>{rows.length}</b> installed plugins
          </p>
          {unknown.length > 0 && (
            <button className="btn btn-sm kn-teach-all" onClick={() => copy(learnAllPrompt(unknown), 'all')} title="Copy a prompt that teaches the agent every unknown plugin">
              <SparkIcon /> Teach all {unknown.length}
            </button>
          )}
        </div>
        <div className="chips kn-chips" role="tablist" aria-label="Coverage">
          {(['all', 'learned', 'built-in', 'unknown'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className="chip" onClick={() => setFilter(f)}>
              {f !== 'all' && <i className={`kdot cov-${f}`} />}
              {f === 'all' ? 'All' : COVERAGE_LABEL[f]}
              <span className="count">{f === 'all' ? rows.length : count(f)}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.map((r) => (
        <div key={r.fx.name} data-fx={r.fx.name} className={`kn-row ${open?.fx.name === r.fx.name ? 'kn-row-open' : ''}`}>
        <button className="kn-row-main" onClick={() => setOpen(open?.fx.name === r.fx.name ? null : r)}>
          <i className={`kdot cov-${r.coverage}`} />
          <span className="kn-name">
            <span className="kn-title">{r.label}</span>
            <span className="kn-vendor">{r.record?.vendor ?? vendorOf(r.fx.name)}</span>
          </span>
          {r.record ? <span className="tag">{r.record.category}</span> : <span />}
          {r.record?.preference !== undefined ? (
            <span className="kn-pref" title={`Preference ${r.record.preference}/100 within ${r.record.category}`}>
              <span style={{ width: `${r.record.preference}%` }} />
            </span>
          ) : (
            <span />
          )}
          {r.coverage !== 'unknown' && (
            <span className={`kn-state cov-text-${r.coverage}`}>
              {r.coverage === 'learned' ? `${r.record?.notes ?? 0} note${r.record?.notes === 1 ? '' : 's'}` : COVERAGE_LABEL[r.coverage]}
            </span>
          )}
        </button>
        {r.coverage === 'unknown' && (
          <button className={`kn-teach ${copied === r.fx.name ? 'kn-teach-done' : ''}`} onClick={() => copy(learnPrompt(r), r.fx.name)} title={`Copy: ${learnPrompt(r)}`}>
            {copied === r.fx.name ? 'Copied' : <><SparkIcon /> Teach</>}
          </button>
        )}
        </div>
      ))}

      {elsewhere.length > 0 && filter === 'all' && !q && (
        <div className="kn-elsewhere">
          Also known but not installed here: {elsewhere.map((r) => r.name).join(', ')}
        </div>
      )}

      {open && <PluginDetails row={open} now={now} onClose={() => setOpen(null)} />}
      {copied && (
        <div className="toast" role="status">
          {copied === 'all' ? `Prompt for ${unknown.length} plugins copied` : 'Prompt copied'} · paste it into Claude Code
        </div>
      )}
    </div>
  );
}

const order = (r: PluginRow) => (r.coverage === 'learned' ? 0 : r.coverage === 'built-in' ? 1 : 2);
const vendorOf = (name: string) => name.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';

function PluginDetails({ row, now, onClose }: { row: PluginRow; now: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const width = useDrawerWidth();
  const r: PluginRecord | undefined = row.record;

  useEffect(() => {
    // Capture phase on window, so the list's Esc (clear the filter) doesn't also run
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const learnCmd = learnPrompt(row);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(learnCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard needs a secure context
    }
  };

  return (
    <aside className="drawer" aria-label={`Plugin ${row.label}`} style={width.style}>
      <ResizeHandle fraction={width.fraction} onCommit={width.setFraction} />
      <div className="drawer-head">
        <div className="drawer-title">
          <i className={`kdot cov-${row.coverage}`} />
          <span>{row.label}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <div className={`result-badge cov-badge-${row.coverage}`}>{COVERAGE_LABEL[row.coverage]}</div>
        {r ? (
          <>
            <dl className="facts">
              <dt>Category</dt>
              <dd>
                {r.category}
                {r.style && <span className="muted"> · {r.style}</span>}
              </dd>
              <dt>Preference</dt>
              <dd>{r.preference ?? '—'}/100</dd>
              <dt>Matches FX</dt>
              <dd className="mono">{r.matches.join(', ')}</dd>
              <dt>Record</dt>
              <dd className="mono">{r.key}</dd>
              <dt>Updated</dt>
              <dd>{formatAgo(now - r.updatedAt)}</dd>
            </dl>
            <div className="code-block">
              <div className="code-head">
                <span>{r.layer === 'user' ? 'Your notes' : 'What the mixer knows'}</span>
              </div>
              <pre className="kn-preview">{r.preview}</pre>
            </div>
            {lorekitUrl(r) && (
              <a className="btn btn-block kn-open" href={lorekitUrl(r)} target="_blank" rel="noreferrer">
                Read the full record in LoreKit ↗
              </a>
            )}
            {row.shadows && (
              <p className="drawer-note">
                Your record overrides the{' '}
                {lorekitUrl(row.shadows) ? (
                  <a href={lorekitUrl(row.shadows)} target="_blank" rel="noreferrer">
                    built-in one
                  </a>
                ) : (
                  'built-in one'
                )}{' '}
                (<span className="mono">{row.shadows.key}</span>).
              </p>
            )}
          </>
        ) : (
          <>
            <p className="drawer-note">
              The mixer has no record for this plugin, so it falls back to a stock plugin in the same category. Teach
              it once and it’ll use this one:
            </p>
            <button className="btn btn-block mono" onClick={copy}>
              {copied ? 'Copied' : learnCmd}
            </button>
            <p className="drawer-hint">Paste into Claude Code. It researches the plugin and probes it on a scratch track.</p>
          </>
        )}
      </div>
    </aside>
  );
}

function SparkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0l1.8 5.2L15 7l-5.2 1.8L8 14l-1.8-5.2L1 7l5.2-1.8z" />
    </svg>
  );
}
