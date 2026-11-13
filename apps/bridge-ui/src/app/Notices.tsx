import { useState, type ReactNode } from 'react';
import { updateLog, type Release } from '../lib/update.js';
import { track } from '../lib/analytics.js';
import { type BridgeSettings, type BridgeStatus, type SettingKey, webSocketLevel } from '../lib/status.js';
import type { BridgeRequest } from './useBridgeRequest.js';
import { load, save } from '../lib/storage.js';
import { Icon, Notice } from '../components/index.js';
import { cx } from '../lib/cx.js';
import styles from './Notices.module.css';

const SWS_DISMISS_KEY = 'mcp-bridge-sws-dismissed';

/** Things the user should act on: control is restricted, or the install is stale or incomplete. */
export function Notices({
  status,
  settings,
  onSet,
  request,
  release,
  onSkip,
  onWhatsNew,
}: {
  status: BridgeStatus;
  settings: BridgeSettings | null;
  onSet: (key: SettingKey, on: boolean) => void;
  request: BridgeRequest;
  /** A stable release newer than this install that the user hasn't skipped (never in developer mode), or null */
  release: Release | null;
  /** Skip this version: no more offers until a newer one */
  onSkip: (version: string) => void;
  /** Opens the What's new drawer */
  onWhatsNew: () => void;
}) {
  const [swsDismissed, setSwsDismissed] = useState(() => load(SWS_DISMISS_KEY) === '1');
  const [updateDoneDismissed, setUpdateDoneDismissed] = useState(false);
  // Between the click and the bridge's first "running" status: a second click would send a second request
  const [updateRequested, setUpdateRequested] = useState(false);
  const health = status.health;
  const control = status.control;
  const update = control?.update;
  const rebuild = update?.kind === 'rebuild';
  const notices: ReactNode[] = [];

  // A release update reports through toasts (UpdateToasts); only a developer's rebuild is a notice
  if (update?.state === 'done' && rebuild && !updateDoneDismissed) {
    notices.push(
      <Notice
        key="update"
        tone="info"
        action={
          <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => setUpdateDoneDismissed(true)}>
            <Icon.Close />
          </button>
        }
      >
        <b>Rebuilt from your working tree.</b> Restart Claude Code, or run <code>/mcp</code> there, to use the new tools.
      </Notice>,
    );
  } else if (update?.state === 'running' && rebuild) {
    const log = updateLog(update);
    notices.push(
      <Notice key="update" tone="info">
        <b>Rebuilding from your working tree…</b> The bridge restarts and this page reloads when it’s done.
        {log.length > 0 && <span className={cx(styles.noticeLog, 'mono')}>{log[log.length - 1]}</span>}
      </Notice>,
    );
  } else if (update?.state === 'failed') {
    const log = updateLog(update);
    notices.push(
      <Notice key="update" tone="bad" action={<button className="btn btn-sm" onClick={() => request(rebuild ? 'rebuild' : 'update')}>Try again</button>}>
        <b>{rebuild ? 'The rebuild didn’t finish.' : 'The update didn’t finish.'}</b> {log[log.length - 1] ?? 'See tmp/install.log in your reaper-mcp folder.'}
        {log.length > 1 && (
          <details className={styles.noticeDetails}>
            <summary>Show log</summary>
            <pre className="mono">{log.join('\n')}</pre>
          </details>
        )}
      </Notice>,
    );
  } else if (release) {
    notices.push(
      <Notice
        key="update"
        tone="info"
        action={
          <span className={styles.noticeActions}>
            {control?.canUpdate && (
              <button
                className="btn btn-sm"
                disabled={updateRequested}
                onClick={() => {
                  track({ name: 'update_clicked', source: 'notice' });
                  request('update');
                  setUpdateRequested(true);
                  // The bridge answers within a second; if it never does, let the person try again
                  setTimeout(() => setUpdateRequested(false), 8000);
                }}
              >
                {updateRequested ? 'Starting…' : 'Update'}
              </button>
            )}
            <button
              className="icon-btn"
              aria-label="Skip this version"
              title="Skip this version"
              onClick={() => onSkip(release.version)}
            >
              <Icon.Close />
            </button>
          </span>
        }
      >
        <b>reaper-mcp v{release.version} is available</b> (you have v{__VERSION__}).{' '}
        <button className={styles.whatsNew} onClick={onWhatsNew}>What’s new</button>
        {!control?.canUpdate && (
          <>
            {' '}· Update in a terminal: <code>npm install -g @mthines/reaper-mcp@latest &amp;&amp; reaper-mcp setup</code> (from a clone:{' '}
            <code>git pull &amp;&amp; ./scripts/install.sh</code>). After that, the Update button here does it for you.
          </>
        )}
      </Notice>,
    );
  }

  if (settings?.paused) {
    notices.push(
      <Notice key="paused" tone="warn" action={<button className="btn btn-sm" onClick={() => onSet('cfg_paused', false)}>Resume</button>}>
        <b>Agent control is paused.</b> Every command gets an error until you resume. Resets when REAPER restarts.
      </Notice>,
    );
  }
  if (settings?.readonly) {
    notices.push(
      <Notice key="readonly" tone="info" action={<button className="btn btn-sm" onClick={() => onSet('cfg_readonly', false)}>Turn off</button>}>
        <b>Read-only mode.</b> Agents can inspect, meter and play, but not change the project.
      </Notice>,
    );
  }
  if (health?.outdated) {
    notices.push(
      <Notice
        key="outdated"
        tone="warn"
        action={control?.canRestart && <button className="btn btn-sm" onClick={() => request('restart')}>Restart bridge</button>}
      >
        <b>A newer bridge is installed.</b>{' '}
        {control?.canRestart ? 'Restart it to load it.' : <>Stop <code>mcp_bridge.lua</code> and run it again to load it.</>}
      </Notice>,
    );
  }
  const webLevel = webSocketLevel(status.web);
  if (status.web && webLevel !== 'ok') {
    notices.push(
      <Notice key="web" tone={webLevel === 'full' ? 'bad' : 'warn'}>
        <b>REAPER’s web server is filling up.</b> It holds {status.web.stuck} of about {status.web.limit} connections
        that browsers closed and it never freed, and stops answering at the limit. Restart REAPER to clear them.
      </Notice>,
    );
  }
  if (health && !health.jsfx) {
    notices.push(
      <Notice key="jsfx" tone="bad">
        <b>Meters are missing</b> ({health.missingJsfx?.join(', ') ?? 'JSFX'}). Run <code>reaper-mcp setup</code> to install them.
      </Notice>,
    );
  }
  if (health && !health.sws && !swsDismissed) {
    notices.push(
      <Notice
        key="sws"
        tone="info"
        action={
          <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => { setSwsDismissed(true); save(SWS_DISMISS_KEY, '1'); }}>
            <Icon.Close />
          </button>
        }
      >
        <b>SWS isn’t installed.</b> Envelope and some FX tools fall back to slower paths.{' '}
        <a href="https://www.sws-extension.org" target="_blank" rel="noreferrer">Get SWS</a>
      </Notice>,
    );
  }
  return notices.length ? <div className={styles.notices}>{notices}</div> : null;
}

