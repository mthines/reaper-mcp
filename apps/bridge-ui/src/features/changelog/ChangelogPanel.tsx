import { useEffect, useState } from 'react';
import { Icon, ResizeHandle, Toggle, useDrawerWidth } from '../../components/index.js';
import { useCommand } from '../command/index.js';
import { REPO_URL } from '../../lib/links.js';
import { load, save } from '../../lib/storage.js';
import { track } from '../../lib/analytics.js';
import { updateLog } from '../../lib/update.js';
import type { BridgeUpdate } from '../../lib/status.js';
import { cx } from '../../lib/cx.js';
import drawerStyles from '../../styles/drawer.module.css';
import {
  availableUpdate,
  BETAS_KEY,
  groupChanges,
  isNewer,
  visibleReleases,
  type Change,
  type ChangelogRelease,
  type ReleasesState,
} from './changelog.js';
import { highlightsFor, type Highlight } from './highlights.js';
import { HighlightCard } from './HighlightCard.js';
import styles from './ChangelogPanel.module.css';

/**
 * What's new: the update reaper-mcp has waiting (with the button or the command that installs it) over the
 * repo's releases, newest first, each one's changes grouped the way the release notes list them.
 */
export function ChangelogPanel({
  releases,
  highlights = [],
  current,
  canUpdate,
  update,
  onUpdate,
  onClose,
}: {
  releases: ReleasesState;
  /** Hand-made entries with an animation, graphic or screenshot, shown on the release that shipped them */
  highlights?: Highlight[];
  /** The installed version (`__VERSION__`) */
  current: string;
  /** The bridge can update this install itself (a git clone with `mcp_update.conf`) */
  canUpdate: boolean;
  /** An update the bridge is running or just ran */
  update?: BridgeUpdate;
  onUpdate: () => void;
  onClose: () => void;
}) {
  const width = useDrawerWidth();
  const [betas, setBetas] = useState(() => load(BETAS_KEY) === '1');
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const chooseBetas = (on: boolean) => {
    track({ name: 'changelog_betas_toggled', shown: on });
    save(BETAS_KEY, on ? '1' : '0');
    setBetas(on);
  };
  useCommand({
    contextual: true,
    id: 'changelog-betas',
    label: betas ? 'Hide betas' : 'Show betas',
    group: 'What’s new',
    description: 'prerelease beta pull request changelog',
    onSelect: () => chooseBetas(!betas),
  });
  const ready = releases.status === 'ready' ? releases.releases : null;
  const shown = ready ? visibleReleases(ready, betas) : [];
  const waiting = ready ? availableUpdate(ready, current) : null;

  return (
    <aside className={cx(drawerStyles.drawer, styles.drawer)} aria-label="What’s new" style={width.style}>
      <ResizeHandle fraction={width.fraction} onCommit={width.setFraction} />
      <div className={drawerStyles.drawerHead}>
        <div className={drawerStyles.drawerTitle}>
          <Icon.Spark /> What’s new
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close what’s new" title="Close (Esc)">
          <Icon.Close />
        </button>
      </div>
      <div className={drawerStyles.drawerBody}>
        {/* Never "up to date" before the releases are in: the list says it is loading or couldn't reach GitHub */}
        {(ready || (update?.state === 'running' && update.kind !== 'rebuild')) && (
          <UpdateCard current={current} waiting={waiting} canUpdate={canUpdate} update={update} onUpdate={onUpdate} />
        )}
        <div className={styles.toolbar}>
          <Toggle label="Show betas" hint="One per pull request, before it ships in a release" on={betas} onChange={chooseBetas} />
        </div>
        {releases.status === 'loading' && <p className="muted">Loading releases from GitHub…</p>}
        {releases.status === 'error' && (
          <p className="muted">
            Couldn’t reach GitHub. See the{' '}
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
              releases page
            </a>
            .
          </p>
        )}
        {ready && shown.length === 0 && <p className="muted">No releases yet.</p>}
        {shown.length > 0 && (
          <ol className={styles.timeline} aria-label="Releases">
            {shown.map((r) => (
              <ReleaseItem
                key={r.version}
                release={r}
                highlights={highlightsFor(r, highlights)}
                current={current}
              />
            ))}
          </ol>
        )}
        <a className={styles.allLink} href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
          All releases on GitHub
        </a>
      </div>
    </aside>
  );
}

function UpdateCard({
  current,
  waiting,
  canUpdate,
  update,
  onUpdate,
}: {
  current: string;
  waiting: ChangelogRelease | null;
  canUpdate: boolean;
  update?: BridgeUpdate;
  onUpdate: () => void;
}) {
  if (update?.state === 'running' && update.kind !== 'rebuild') {
    const log = updateLog(update);
    return (
      <section className={styles.card} data-tone="busy" aria-label="Update">
        <b>Updating reaper-mcp…</b>
        <span className="muted">The bridge restarts and this page reloads when it’s done.</span>
        {log.length > 0 && <span className={cx(styles.cardLog, 'mono')}>{log[log.length - 1]}</span>}
      </section>
    );
  }
  if (!waiting) {
    return (
      <section className={styles.card} data-tone="ok" aria-label="Update">
        <b>You’re up to date</b>
        <span className="muted">reaper-mcp v{current}</span>
      </section>
    );
  }
  const failed = update?.state === 'failed' && update.kind !== 'rebuild';
  return (
    <section className={styles.card} data-tone="new" aria-label="Update">
      <div className={styles.cardHead}>
        <div>
          <b>v{waiting.version} is available</b>
          <span className="muted"> · you have v{current}</span>
        </div>
        {canUpdate && (
          <button
            className="btn btn-sm"
            onClick={() => {
              track({ name: 'update_clicked', source: 'changelog' });
              onUpdate();
            }}
          >
            {failed ? 'Try again' : 'Update'}
          </button>
        )}
      </div>
      {failed && <span className={cx(styles.cardLog, 'mono')}>{updateLog(update).at(-1) ?? 'The update didn’t finish.'}</span>}
      {!canUpdate && (
        <dl className={styles.commands}>
          <dt>From a clone</dt>
          <dd className="mono">git pull &amp;&amp; ./scripts/install.sh</dd>
          <dt>From npm</dt>
          <dd className="mono">npm install -g @mthines/reaper-mcp@latest &amp;&amp; reaper-mcp setup</dd>
        </dl>
      )}
    </section>
  );
}

function ReleaseItem({ release, highlights, current }: { release: ChangelogRelease; highlights: Highlight[]; current: string }) {
  const newer = isNewer(release, current);
  const installed = release.version === current;
  const groups = groupChanges(release.changes);
  return (
    <li className={styles.release} data-state={newer ? 'new' : installed ? 'installed' : 'old'} data-kind={release.prerelease ? 'beta' : 'stable'}>
      <h3 className={styles.releaseHead}>
        <span className={styles.version}>v{release.version}</span>
        <a className={styles.notesLink} href={release.url} target="_blank" rel="noreferrer" aria-label={`Release notes for v${release.version}`} title="Release notes on GitHub">
          <Icon.External />
        </a>
        {newer && <span className={styles.badge} data-badge="new">New</span>}
        {installed && <span className={styles.badge} data-badge="installed">Installed</span>}
        {release.prerelease && <span className={styles.badge} data-badge="beta">Beta</span>}
        <time className={styles.date} dateTime={release.date}>
          {formatDate(release.date)}
        </time>
      </h3>
      <div className={styles.releaseBody}>
        {highlights.length > 0 && (
          <div className={styles.highlights}>
            {highlights.map((h) => (
              <HighlightCard key={h.id} highlight={h} />
            ))}
          </div>
        )}
        {groups.length === 0 && highlights.length === 0 && <p className="muted">No changes listed.</p>}
        {groups.map((g) =>
          g.id === 'internal' ? (
            <details key={g.id} className={styles.group} data-group={g.id}>
              <summary className={styles.groupTitle}>
                {g.title} <span className="count">{g.changes.length}</span>
              </summary>
              <ChangeList changes={g.changes} />
            </details>
          ) : (
            <section key={g.id} className={styles.group} data-group={g.id}>
              <h4 className={styles.groupTitle}>{g.title}</h4>
              <ChangeList changes={g.changes} />
            </section>
          ),
        )}
      </div>
    </li>
  );
}

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul className={styles.changes}>
      {changes.map((c, i) => (
        <li key={i}>
          {c.breaking && <span className={styles.badge} data-badge="breaking">Breaking</span>}
          {c.scope && <span className={styles.scope}>{c.scope}</span>}
          <span>{sentence(c.subject)}</span>
          {c.pr !== null && (
            <a className={cx(styles.pr, 'mono')} href={`${REPO_URL}/pull/${c.pr}`} target="_blank" rel="noreferrer">
              #{c.pr}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
