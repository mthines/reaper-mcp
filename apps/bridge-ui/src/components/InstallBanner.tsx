import { useEffect, useState } from 'react';
import { REPO_URL } from '../lib/links.js';
import styles from './InstallBanner.module.css';

export const INSTALL_COMMANDS = ['npm install -g @mthines/reaper-mcp', 'reaper-mcp setup && reaper-mcp init'];
export const INSTALL_GUIDE_URL = `${REPO_URL}#-install-in-3-steps`;

/**
 * The top of the public demo and changelog: this is a demo with example data, not a connected bridge, and the three
 * steps to get the real thing (the README's install in 3 steps). Both commands copy with one click.
 */
export function InstallBanner() {
  const [copied, setCopied] = useState(false);
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
      <ol className={styles.steps} aria-label="Get started">
        <li>
          <span className={styles.step}>1</span>
          <span>Install</span>
          <code className="mono">{INSTALL_COMMANDS[0]}</code>
        </li>
        <li>
          <span className={styles.step}>2</span>
          <span>Connect</span>
          <code className="mono">{INSTALL_COMMANDS[1]}</code>
        </li>
        <li>
          <span className={styles.step}>3</span>
          <span>In REAPER, run <code className="mono">mcp_bridge.lua</code>, then ask Claude Code to mix</span>
        </li>
      </ol>
      <button className="btn btn-sm" onClick={copy} aria-label="Copy the install commands">
        {copied ? 'Copied' : 'Copy commands'}
      </button>
    </aside>
  );
}
