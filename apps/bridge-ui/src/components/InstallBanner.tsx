import { REPO_URL } from '../lib/links.js';
import styles from './InstallBanner.module.css';

/** The hosted documentation's install guide, on the same site as the demo. */
export const INSTALL_GUIDE_URL = '/docs/install';

/** The hosted demo's top banner: says the data is fake and points to the install guide. */
export function InstallBanner() {
  return (
    <aside className={styles.banner} aria-label="This is a demo">
      <div className={styles.head}>
        <span className={styles.pill}>Demo</span>
        <span className={styles.lead}>
          You’re looking at example data. Nothing here is connected to REAPER. Install reaper-mcp to control your own
          session from Claude Code.
        </span>
        <span className={styles.links}>
          <a className="btn btn-sm" href={INSTALL_GUIDE_URL}>
            Install guide
          </a>
          <a className="btn btn-sm" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </div>
    </aside>
  );
}
