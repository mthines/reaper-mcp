import { useEffect, useState } from 'react';
import { Toggle } from '../../components/index.js';
import { trackSite } from '../../lib/analytics.js';
import { REPO_URL } from '../../lib/links.js';
import { load, save } from '../../lib/storage.js';
import { isStringOrNull, useUrlState } from '../../lib/url-state.js';
import { BETAS_KEY, parseReleases, useReleases, visibleReleases, type ChangelogRelease, type ReleasesState } from './changelog.js';
import { highlightsFor, useHighlights, type Highlight } from './highlights.js';
import { ReleaseItem } from './ChangelogPanel.js';
import panelStyles from './ChangelogPanel.module.css';
import styles from './ChangelogPage.module.css';

/** The hosted build's releases: the snapshot taken at build time. Anywhere else the page fetches them live. */
const SNAPSHOT: ChangelogRelease[] | undefined = __HOSTED__ ? parseReleases(__RELEASES_SNAPSHOT__) : undefined;

/**
 * The changelog as a page of its own (`?page=changelog`, `/changelog` on the hosted site): every release, newest
 * first, in a column made to be linked to. `?release=0.79.1` and `#release-0.79.1` open and highlight one release.
 * No demo banner here, even on the hosted site: the page stays a clean read, with "Try the live demo" as its way in.
 */
export function ChangelogPage({
  releases,
  highlights = [],
  demoHref,
}: {
  releases: ReleasesState;
  highlights?: Highlight[];
  /** Where "Try the demo" goes */
  demoHref: string;
}) {
  const [betas, setBetas] = useState(() => load(BETAS_KEY) === '1');
  const [linked, setLinked] = useUrlState<string | null>('release', null, { validate: isStringOrNull });
  // `#release-0.79.1` is the same link in the form people copy from an anchor
  useEffect(() => {
    const fromHash = /^#release-(.+)$/.exec(location.hash)?.[1];
    if (fromHash && !new URLSearchParams(location.search).has('release')) setLinked(decodeURIComponent(fromHash), 'replace');
  }, [setLinked]);
  const ready = releases.status === 'ready' ? releases.releases : null;
  const shown = ready ? visibleReleases(ready, betas, linked) : [];
  const chooseBetas = (on: boolean) => {
    save(BETAS_KEY, on ? '1' : '0');
    setBetas(on);
    trackSite({ name: 'changelog_betas_toggled', shown: on });
  };
  const linkRelease = (version: string) => {
    setLinked(version);
    trackSite({ name: 'release_linked', version });
  };

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>What’s new in reaper-mcp</h1>
          <p className="muted">Every release, newest first. Link to one with its version.</p>
        </div>
        <a className="btn" href={demoHref}>
          Try the live demo
        </a>
      </header>
      <div className={styles.toolbar}>
        <Toggle label="Show betas" hint="One per pull request, before it ships in a release" on={betas} onChange={chooseBetas} />
      </div>
      {releases.status === 'loading' && <p className="muted">Loading releases…</p>}
      {releases.status === 'error' && (
        <p className="muted">
          Couldn’t load the releases. See the{' '}
          <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
            releases page on GitHub
          </a>
          .
        </p>
      )}
      {ready && shown.length === 0 && <p className="muted">No releases yet.</p>}
      {shown.length > 0 && (
        <ol className={panelStyles.timeline} aria-label="Releases">
          {shown.map((r) => (
            <ReleaseItem
              key={r.version}
              release={r}
              highlights={highlightsFor(r, highlights)}
              current={null}
              linked={r.version === linked}
              layout={`${shown.length}:${highlights.length}`}
              onLink={() => linkRelease(r.version)}
            />
          ))}
        </ol>
      )}
      <footer className={styles.foot}>
        <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
          All releases on GitHub
        </a>
      </footer>
    </main>
  );
}

/** The page with its data: the build's snapshot when hosted, GitHub's releases otherwise. */
export function ChangelogPageRoute() {
  const releases = useReleases(true, SNAPSHOT);
  const highlights = useHighlights(true);
  return <ChangelogPage releases={releases} highlights={highlights} demoHref={__HOSTED__ ? '/' : '?demo'} />;
}
