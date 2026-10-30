import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../lib/analytics.js';
import { contributable, contribution } from './contribute.js';
import { groupByCreator, notInstalled, pluginCoverage, type Coverage, type KnowledgeFeed, type PluginRecord, type PluginRow } from './plugins.js';
import { isBoolean, isStringOrNull, useUrlState } from '../../lib/url-state.js';
import { PluginDetails, order } from './PluginDetails.js';
import { PublishAll } from './PublishAll.js';
import { TeachMenu, toastText } from './TeachMenu.js';
import { ChevronIcon, ShareIcon, SparkIcon } from '../../components/icons.js';
import { learnAllPrompt, learnPrompt } from './teach.js';
import { useCopy } from '../../lib/useCopy.js';

type Filter = 'all' | Coverage;
const isFilter = (v: unknown): v is Filter => v === 'all' || v === 'learned' || v === 'built-in' || v === 'unknown';

export const COVERAGE_LABEL: Record<Coverage, string> = {
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
  const [filter, setFilter] = useUrlState<Filter>('coverage', 'all', { validate: isFilter });
  const [inProject, setInProject] = useUrlState('inProject', false, { validate: isBoolean });
  const [grouped, setGrouped] = useState(loadGrouped);
  // Groups the viewer opened
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  // The open plugin, by FX name: it opens once the feed has listed it (also after a reload)
  const [openName, setOpenName] = useUrlState<string | null>('plugin', null, { validate: isStringOrNull });
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
  const open = useMemo(() => (openName === null ? null : (rows.find((r) => r.fx.name === openName) ?? null)), [rows, openName]);
  const setOpen = (r: PluginRow | null, mode?: 'push' | 'replace') => setOpenName(r ? r.fx.name : null, mode);
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
      if (next) setOpenName(next.fx.name, 'replace'); // stepping through rows doesn't add history
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
    setOpen(r, 'push');
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
