import { useEffect, useState } from 'react';
import { cx } from '../lib/cx.js';
import { REPO_URL } from '../lib/links.js';
import { CheckIcon, CopyIcon } from './icons.js';
import styles from './InstallBanner.module.css';

export const INSTALL_COMMANDS = ['npm install -g @mthines/reaper-mcp', 'reaper-mcp setup && reaper-mcp init'];
export const INSTALL_GUIDE_URL = `${REPO_URL}#-install-in-3-steps`;

/**
 * The top of the public demo: this is a demo with example data, not a connected bridge, and the three steps to get
 * the real thing (the README's install in 3 steps). Both commands copy with one click. The changelog page goes
 * without it: it links to the demo instead.
 */
export function InstallBanner() {
  const [copied, setCopied] = useState(false);
  // On a phone the steps start folded so the demo itself is what the page opens on
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 720px)').matches);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    // Where the clipboard is blocked the commands are still on screen to select
    navigator.clipboard?.writeText(INSTALL_COMMANDS.join('\n')).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <aside className={styles.banner} aria-label="This is a demo">
      <div className={styles.head}>
        <span className={styles.pill}>Demo</span>
        <span className={styles.lead}>
          <b>You’re looking at example data.</b> Nothing here is connected to REAPER. Install reaper-mcp to control your own session from Claude Code.
        </span>
        <span className={styles.links}>
          <a className="btn btn-sm" href={INSTALL_GUIDE_URL} target="_blank" rel="noreferrer">
            Install guide
          </a>
          <a className="btn btn-sm" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </div>
      <details className={styles.more} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={styles.summary}>Install in 3 steps</summary>
        <div className={styles.body}>
          <ol className={styles.steps} aria-label="Get started">
            <li>
              <span className={styles.step}>1</span>
              <span className={styles.label}>Install</span>
              <code className={cx('mono', styles.cmd)}>{INSTALL_COMMANDS[0]}</code>
            </li>
            <li>
              <span className={styles.step}>2</span>
              <span className={styles.label}>Connect</span>
              <code className={cx('mono', styles.cmd)}>{INSTALL_COMMANDS[1]}</code>
            </li>
            <li>
              <span className={styles.step}>3</span>
              <span className={styles.text}>
                In REAPER, run <code className="mono">mcp_bridge.lua</code>, then ask Claude Code to mix
              </span>
            </li>
          </ol>
          <button className={cx('btn btn-sm', styles.copy)} onClick={copy} aria-label="Copy the install commands">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy commands'}
          </button>
        </div>
      </details>
    </aside>
  );
}
