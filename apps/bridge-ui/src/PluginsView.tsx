import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from './analytics.js';
import { contributable, contribution } from './contribute.js';
import { publishAll, type PublishOutcome } from './lorekit.js';
import { Markdown } from './markdown.js';
import { ResizeHandle, useDrawerWidth } from './ResizeHandle.js';
import { formatAgo } from './status.js';
import {
  fxFormat,
  groupByCreator,
  lorekitUrl,
  notInstalled,
  pluginCoverage,
  type Coverage,
  type KnowledgeFeed,
  type PluginRecord,
  type PluginRow,
  type PublishResult,
} from './plugins.js';

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

const GROUP_KEY = 'mcp_bridge.plugins_grouped';

function loadGrouped(): boolean {
  try {
    return localStorage.getItem(GROUP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Which installed plugins the mix skills know, and from where: your own LoreKit records win over the
 * built-in ones. Plugins in the open project are marked and listed first; unknown ones point at /learn-plugin.
 */
export function PluginsView({ feed, query, now, onOpenSettings }: { feed: KnowledgeFeed | undefined; query: string; now: number; onOpenSettings?: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [inProject, setInProject] = useState(false);
  const [grouped, setGrouped] = useState(loadGrouped);
  // Groups the viewer opened
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<PluginRow | null>(null);
  const [copied, copy] = useCopy();
  const [publishingAll, setPublishingAll] = useState(false);
  const mine = useMemo(() => contributable(feed?.records ?? []), [feed]);
  const contribute = (records: PluginRecord[]) => {
    const c = contribution(records);
    track({ name: 'plugin_contribute_clicked', count: records.length, prefilled: c.prefilled });
    copy(c.text, `contribute:${records.length}:${c.prefilled ? 'filled' : 'paste'}`);
    window.open(c.url, '_blank', 'noopener,noreferrer');
  };
  const rows = useMemo(() => (feed ? pluginCoverage(feed) : []), [feed]);
  const elsewhere = useMemo(() => (feed ? notInstalled(feed) : []), [feed]);
  const visibleRef = useRef<PluginRow[]>([]);
  const openRef = useRef(open);
  openRef.current = open;

  // ↑/↓ step through the list while a plugin is open, like the Calls tab
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') || !openRef.current) return;
      if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, [role="separator"], [role="menu"]')) return;
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
  const usedRows = rows.filter((r) => r.used > 0);
  const q = query.trim().toLowerCase();
  const matching = rows
    .filter(
      (r) =>
        (filter === 'all' || r.coverage === filter) &&
        (!inProject || r.used > 0) &&
        (!q || r.label.toLowerCase().includes(q) || r.creator.toLowerCase().includes(q) || r.record?.category.includes(q)),
    )
    .sort((a, b) => Number(b.used > 0) - Number(a.used > 0) || order(a) - order(b) || a.label.localeCompare(b.label));
  const groups = grouped ? groupByCreator(matching) : [];
  // Groups start collapsed; a search opens them all, and the group of the open plugin stays open
  const isOpen = (creator: string) => Boolean(q) || creator === open?.creator || toggled.has(creator);
  const shown = grouped ? groups.flatMap((g) => (isOpen(g.creator) ? g.rows : [])) : matching;
  visibleRef.current = shown;
  const known = rows.length - count('unknown');
  const unknownShown = matching.filter((r) => r.coverage === 'unknown');
  const unknownInProject = usedRows.filter((r) => r.coverage === 'unknown');

  const teach = (rows: PluginRow[], text: string, key: string) => {
    track({ name: 'plugin_teach_copied', scope: rows.length === 1 ? 'one' : 'many', count: rows.length });
    copy(text, key);
  };
  const openPlugin = (r: PluginRow) => {
    if (open?.fx.name === r.fx.name) return setOpen(null);
    track({ name: 'plugin_opened', coverage: r.coverage, in_project: r.used > 0, formats: r.variants.length });
    setOpen(r);
  };
  const chooseFilter = (f: Filter, project = inProject) => {
    track({ name: 'plugins_filtered', filter: f, in_project: project });
    setFilter(f);
    setInProject(project);
  };
  const chooseGrouped = (on: boolean) => {
    if (on !== grouped) track({ name: 'plugins_grouped', grouped: on });
    setGrouped(on);
    try {
      localStorage.setItem(GROUP_KEY, on ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
  };
  const toggleGroup = (creator: string) => {
    // Collapsing the group of the open plugin closes its details too
    if (open?.creator === creator) setOpen(null);
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(creator)) next.delete(creator);
      else if (open?.creator !== creator) next.add(creator);
      return next;
    });
  };

  const renderRow = (r: PluginRow) => (
    <div key={r.fx.name} data-fx={r.fx.name} className={`kn-row ${open?.fx.name === r.fx.name ? 'kn-row-open' : ''}`}>
      <button className="kn-row-main" onClick={() => openPlugin(r)}>
        <i className={`kdot cov-${r.coverage}`} />
        <span className="kn-name">
          <span className="kn-title">{r.label}</span>
          {!grouped && <span className="kn-vendor">{r.creator}</span>}
          {r.used > 0 && (
            <span className="kn-used" title={`${r.used} instance${r.used === 1 ? '' : 's'} in the open project`}>
              in project{r.used > 1 ? ` ×${r.used}` : ''}
            </span>
          )}
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
        <button className={`kn-teach ${copied === r.fx.name ? 'kn-teach-done' : ''}`} onClick={() => teach([r], learnPrompt(r), r.fx.name)} title={`Copy: ${learnPrompt(r)}`}>
          {copied === r.fx.name ? 'Copied' : <><SparkIcon /> Teach</>}
        </button>
      )}
    </div>
  );

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
            {feed.used && (
              <>
                {' · '}
                <b>{usedRows.length - unknownInProject.length}</b> of the <b>{usedRows.length}</b> in this project
              </>
            )}
          </p>
          <div className="kn-actions">
          {mine.length > 0 &&
            (feed.publish ? (
              <button
                className="btn btn-sm kn-contribute kn-publish-btn"
                onClick={() => setPublishingAll((o) => !o)}
                aria-expanded={publishingAll}
                title="Write the plugins you taught the mixer to the built-in layer in LoreKit, for everyone"
              >
                <ShareIcon /> Publish {mine.length} to built-in
              </button>
            ) : (
              <button
                className="btn btn-sm kn-contribute"
                onClick={() => contribute(mine)}
                title="Share the plugins you taught the mixer with everyone: opens a pull request on GitHub"
              >
                <ShareIcon /> Contribute {mine.length}
              </button>
            ))}
          <TeachMenu
            options={[
              { key: 'project', label: 'in this project', rows: unknownInProject },
              { key: 'shown', label: filter === 'all' && !inProject && !q ? 'unknown' : 'shown', rows: unknownShown },
            ]}
            onCopy={(key, list) => teach(list, learnAllPrompt(list), `all:${key}:${list.length}`)}
          />
          </div>
        </div>
        {publishingAll && feed.publish && (
          <PublishAll records={mine} builtIn={feed.records} publish={feed.publish} onClose={() => setPublishingAll(false)} />
        )}
        {feed.problem && <p className="kn-problem">{feed.problem}</p>}
        {feed.userLayer === 'off' && (
          <p className="kn-connect">
            Showing built-in records.{' '}
            {onOpenSettings ? (
              <button className="link-btn" onClick={onOpenSettings}>
                Connect your LoreKit
              </button>
            ) : (
              'Connect your LoreKit in Settings'
            )}{' '}
            to include the plugins you taught the mixer.
          </p>
        )}
        <div className="kn-controls">
          <div className="chips kn-chips" role="tablist" aria-label="Coverage">
            {(['all', 'learned', 'built-in', 'unknown'] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className="chip" onClick={() => chooseFilter(f)}>
                {f !== 'all' && <i className={`kdot cov-${f}`} />}
                {f === 'all' ? 'All' : COVERAGE_LABEL[f]}
                <span className="count">{f === 'all' ? rows.length : count(f)}</span>
              </button>
            ))}
            {feed.used && (
              <button className="chip chip-project" aria-pressed={inProject} onClick={() => chooseFilter(filter, !inProject)} title="Only plugins loaded in the open project">
                In this project <span className="count">{usedRows.length}</span>
              </button>
            )}
          </div>
          <div className="seg seg-sm" role="tablist" aria-label="Layout">
            <button role="tab" aria-selected={!grouped} onClick={() => chooseGrouped(false)}>
              List
            </button>
            <button role="tab" aria-selected={grouped} onClick={() => chooseGrouped(true)}>
              By creator
            </button>
          </div>
        </div>
      </div>

      {matching.length === 0 && <div className="empty">{inProject && usedRows.length === 0 ? 'The open project has no plugins loaded.' : 'No plugins match.'}</div>}

      {grouped
        ? groups.map((g) => {
            const expanded = isOpen(g.creator);
            const unknown = g.rows.filter((r) => r.coverage === 'unknown');
            const knownHere = g.rows.length - unknown.length;
            return (
              <section key={g.creator} className="kn-group" aria-label={g.creator}>
                <div className="kn-group-head">
                  <button className="kn-group-toggle-btn" aria-expanded={expanded} onClick={() => toggleGroup(g.creator)}>
                    <ChevronIcon className={`kn-chevron ${expanded ? 'kn-chevron-open' : ''}`} />
                    <span className="kn-group-name">{g.creator}</span>
                    <span className="kn-group-meta">
                      {knownHere} of {g.rows.length} known
                      {g.used > 0 && <span className="kn-used">{g.used} in project</span>}
                    </span>
                  </button>
                  {unknown.length > 0 && (
                    <button
                      className={`kn-teach ${copied === `group:${g.creator}` ? 'kn-teach-done' : ''}`}
                      onClick={() => teach(unknown, learnAllPrompt(unknown), `group:${g.creator}`)}
                      title={`Copy a prompt that teaches the ${unknown.length} unknown ${g.creator} plugin${unknown.length === 1 ? '' : 's'}`}
                    >
                      {copied === `group:${g.creator}` ? 'Copied' : <><SparkIcon /> Teach {unknown.length}</>}
                    </button>
                  )}
                </div>
                {expanded && g.rows.map(renderRow)}
              </section>
            );
          })
        : matching.map(renderRow)}

      {elsewhere.length > 0 && filter === 'all' && !inProject && !q && (
        <div className="kn-elsewhere">
          Also known but not installed here: {elsewhere.map((r) => r.name).join(', ')}
        </div>
      )}

      {open && <PluginDetails row={open} now={now} onClose={() => setOpen(null)} onContribute={(r) => contribute([r])} publish={feed.publish} />}
      {copied && (
        <div className="toast" role="status">
          {toastText(copied)}
        </div>
      )}
    </div>
  );
}

function toastText(copied: string): string {
  const mine = copied.match(/^contribute:(\d+):(filled|paste)$/);
  if (mine) {
    const what = `${mine[1]} record${mine[1] === '1' ? '' : 's'}`;
    return mine[2] === 'filled'
      ? `Opened GitHub with your ${what} · review the file, then propose it`
      : `Your ${what} ${mine[1] === '1' ? 'is' : 'are'} copied · paste over the placeholder on GitHub, then propose it`;
  }
  const paste = ' · paste it into Claude Code';
  const all = copied.match(/^all:[^:]+:(\d+)$/);
  if (all) return `Prompt for ${all[1]} plugin${all[1] === '1' ? '' : 's'} copied${paste}`;
  if (copied.startsWith('group:')) return `Prompt for the unknown ${copied.slice(6)} plugins copied${paste}`;
  return `Prompt copied${paste}`;
}

interface TeachOption {
  key: string;
  label: string;
  rows: PluginRow[];
}

/** Split button: teach the first non-empty option; the menu offers every option. */
function TeachMenu({ options, onCopy }: { options: TeachOption[]; onCopy: (key: string, rows: PluginRow[]) => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const available = options.filter((o) => o.rows.length > 0);

  useEffect(() => {
    if (!menu) return;
    const close = (ev: Event) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !ref.current?.contains(ev.target as Node)) {
        ev.stopPropagation();
        setMenu(false);
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [menu]);

  if (available.length === 0) return null;
  const primary = available[0];
  return (
    <div className="split" ref={ref}>
      <button className="btn btn-sm kn-teach-all split-main" onClick={() => onCopy(primary.key, primary.rows)} title="Copy a /learn-plugin prompt for these plugins">
        <SparkIcon /> Teach {primary.rows.length} {primary.label}
      </button>
      {available.length > 1 && (
        <button className="btn btn-sm kn-teach-all split-caret" aria-haspopup="menu" aria-expanded={menu} aria-label="More teach options" onClick={() => setMenu((m) => !m)}>
          <ChevronIcon className={`split-chevron ${menu ? 'kn-chevron-open' : ''}`} />
        </button>
      )}
      {menu && (
        <div className="split-menu" role="menu">
          {available.map((o) => (
            <button
              key={o.key}
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onCopy(o.key, o.rows);
              }}
            >
              Teach all {o.rows.length} {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const order = (r: PluginRow) => (r.coverage === 'learned' ? 0 : r.coverage === 'built-in' ? 1 : 2);

function PluginDetails({
  row,
  now,
  onClose,
  onContribute,
  publish,
}: {
  row: PluginRow;
  now: number;
  onClose: () => void;
  onContribute: (record: PluginRecord) => void;
  publish?: KnowledgeFeed['publish'];
}) {
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
      setTimeout(() => setCopied(false), 2000);
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
        {row.variants.length > 1 && (
          <p className="drawer-note" title={row.variants.map((v) => v.name).join('\n')}>
            Installed as {row.variants.map((v) => fxFormat(v.name) || v.type).join(', ')}, shown as one plugin.
          </p>
        )}
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
            <div className="code-block kn-record">
              <div className="code-head">
                <span>{r.layer === 'user' ? 'Your notes' : 'What the mixer knows'}</span>
              </div>
              <Markdown className="kn-md" source={r.preview} />
            </div>
            {lorekitUrl(r) && (
              <a className="btn btn-block kn-open" href={lorekitUrl(r)} target="_blank" rel="noreferrer">
                Read the full record in LoreKit ↗
              </a>
            )}
            {r.layer === 'user' && r.source && publish && <PublishRecord key={r.key} record={r} shadows={row.shadows} publish={publish} />}
            {r.layer === 'user' && r.source && (
              <button className="btn btn-block kn-contribute" onClick={() => onContribute(r)} title="Opens a pull request on GitHub">
                <ShareIcon /> Contribute this record to everyone
              </button>
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
            <div className="code-block">
              <div className="code-head">
                <span>Prompt</span>
              </div>
              <pre className="kn-prompt">{learnCmd}</pre>
            </div>
            <button className={`btn btn-block kn-teach-drawer ${copied ? 'kn-teach-done' : ''}`} onClick={copy}>
              {copied ? (
                'Copied'
              ) : (
                <>
                  <SparkIcon /> Teach · copy prompt
                </>
              )}
            </button>
            <p className="drawer-hint">Paste into Claude Code. It researches the plugin and probes it on a scratch track.</p>
          </>
        )}
      </div>
    </aside>
  );
}

type PublishState = { step: 'idle' | 'confirm' | 'busy' } | { step: 'done'; result: PublishResult } | { step: 'error'; message: string };

/** Publish one of the viewer's records into the built-in layer (reaper-mcp org members), confirmed inline. */
function PublishRecord({ record, shadows, publish }: { record: PluginRecord; shadows?: PluginRecord; publish: NonNullable<KnowledgeFeed['publish']> }) {
  const [state, setState] = useState<PublishState>({ step: 'idle' });
  const [removeCopy, setRemoveCopy] = useState(true);
  const target = record.key.replace(/^user::/, '');
  const run = async () => {
    setState({ step: 'busy' });
    try {
      const result = await publish(record, { removeCopy });
      track({ name: 'plugin_publish_completed', outcome: 'published', removed_copy: result.removedCopy, replaced: Boolean(shadows) });
      setState({ step: 'done', result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // "refused" = LoreKit or the record checks said no; "failed" = network or server trouble
      const refused = /refused|not allowed|must|needs/i.test(message);
      track({ name: 'plugin_publish_completed', outcome: refused ? 'refused' : 'failed', removed_copy: false, replaced: Boolean(shadows) });
      setState({ step: 'error', message });
    }
  };

  if (state.step === 'done') {
    return (
      <div className="kn-publish kn-publish-done" role="status">
        <div>
          Published as <span className="mono">{state.result.key}</span>
          {state.result.removedCopy ? '. Your copy is archived (restorable in LoreKit).' : '.'}
        </div>
        {state.result.warning && <div className="kn-publish-warn">{state.result.warning}</div>}
      </div>
    );
  }
  if (state.step === 'idle') {
    return (
      <button className="btn btn-block kn-contribute kn-publish-btn" onClick={() => setState({ step: 'confirm' })} title="Writes the record to the built-in layer in LoreKit">
        <ShareIcon /> Publish to built-in
      </button>
    );
  }
  return (
    <div className="kn-publish">
      <p className="drawer-note">
        Writes <span className="mono">{target}</span> to the built-in layer for everyone
        {shadows ? ', replacing the current built-in record' : ''}.
      </p>
      <label className="kn-publish-check">
        <input type="checkbox" checked={removeCopy} disabled={state.step === 'busy'} onChange={(ev) => setRemoveCopy(ev.target.checked)} />
        Archive my copy afterwards (it would keep overriding the built-in one)
      </label>
      {state.step === 'error' && (
        <div className="kn-publish-warn" role="alert">
          {state.message}
        </div>
      )}
      <div className="kn-publish-actions">
        <button className="btn btn-sm kn-publish-btn" onClick={run} disabled={state.step === 'busy'}>
          {state.step === 'busy' ? 'Publishing…' : state.step === 'error' ? 'Try again' : 'Publish'}
        </button>
        <button className="btn btn-sm" onClick={() => setState({ step: 'idle' })} disabled={state.step === 'busy'}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type PublishAllState = { step: 'confirm' } | { step: 'busy'; done: number; total: number } | { step: 'done'; outcomes: PublishOutcome[] };

/**
 * Publish every one of the viewer's records into the built-in layer in one go (the header's Publish N), confirmed
 * inline. The list is fixed when confirmed: archiving copies changes the feed underneath while it runs.
 */
function PublishAll({
  records,
  builtIn,
  publish,
  onClose,
}: {
  records: PluginRecord[];
  builtIn: PluginRecord[];
  publish: NonNullable<KnowledgeFeed['publish']>;
  onClose: () => void;
}) {
  const [state, setState] = useState<PublishAllState>({ step: 'confirm' });
  const [removeCopy, setRemoveCopy] = useState(true);
  const builtInKeys = useMemo(() => new Set(builtIn.filter((r) => r.layer === 'built-in').map((r) => r.key)), [builtIn]);
  const replacing = records.filter((r) => builtInKeys.has(r.key.replace(/^user::/, ''))).length;
  const run = async (list: PluginRecord[]) => {
    setState({ step: 'busy', done: 0, total: list.length });
    const outcomes = await publishAll(list, (r) => publish(r, { removeCopy }), (done) => setState({ step: 'busy', done, total: list.length }));
    setState({ step: 'done', outcomes });
  };

  if (state.step === 'done') {
    const failed = state.outcomes.filter((o): o is Extract<PublishOutcome, { error: string }> => 'error' in o);
    const ok = state.outcomes.length - failed.length;
    const warnings = state.outcomes.flatMap((o) => ('result' in o && o.result.warning ? [`${o.record.name}: ${o.result.warning}`] : []));
    return (
      <div className="kn-publish kn-publish-done" role="status">
        <div>
          Published {ok} of {state.outcomes.length} to the built-in layer
          {ok > 0 && state.outcomes.some((o) => 'result' in o && o.result.removedCopy) ? '; your copies are archived (restorable in LoreKit)' : ''}.
        </div>
        {[...failed.map((o) => `${o.record.name}: ${o.error}`), ...warnings].map((line) => (
          <div key={line} className="kn-publish-warn">
            {line}
          </div>
        ))}
        <div className="kn-publish-actions">
          {failed.length > 0 && (
            <button className="btn btn-sm kn-publish-btn" onClick={() => run(failed.map((o) => o.record))}>
              Retry {failed.length} failed
            </button>
          )}
          <button className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }
  const busy = state.step === 'busy';
  return (
    <div className="kn-publish">
      <p className="drawer-note">
        Writes your {records.length} record{records.length === 1 ? '' : 's'} to the built-in layer for everyone
        {replacing > 0 ? `, replacing ${replacing} current built-in record${replacing === 1 ? '' : 's'}` : ''}:{' '}
        {records.map((r) => r.name).join(', ')}.
      </p>
      <label className="kn-publish-check">
        <input type="checkbox" checked={removeCopy} disabled={busy} onChange={(ev) => setRemoveCopy(ev.target.checked)} />
        Archive my copies afterwards (they would keep overriding the built-in ones)
      </label>
      <div className="kn-publish-actions">
        <button className="btn btn-sm kn-publish-btn" onClick={() => run(records)} disabled={busy}>
          {busy ? `Publishing ${state.done + 1} of ${state.total}…` : `Publish ${records.length}`}
        </button>
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0l1.8 5.2L15 7l-5.2 1.8L8 14l-1.8-5.2L1 7l5.2-1.8z" />
    </svg>
  );
}

/** Points right; rotated down when open. */
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V2.5M5 5.5l3-3 3 3M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}
