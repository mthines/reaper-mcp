import type { BridgeStatus, Liveness } from '../lib/status.js';
import { REPO_URL } from '../lib/links.js';
import { usePopover } from '../lib/usePopover.js';
import { hasToolCalls, isConnected, sessionHue, sessionName, type Session } from '../lib/sessions.js';
import { Icon, Mark } from '../components/index.js';
import { CommandPaletteButton } from '../features/command/index.js';
import { cx } from '../lib/cx.js';
import styles from './Header.module.css';

export function Header({
  status,
  state,
  reachable,
  now,
  sessions,
  onShowAgents,
  onOpenSettings,
  onOpenChangelog,
  updateVersion,
  onOpenUpdate,
  onRebuild,
  overview,
  onToggleOverview,
}: {
  status: BridgeStatus | null;
  state: Liveness;
  reachable: boolean;
  now: number;
  sessions: Map<string, Session>;
  onShowAgents: () => void;
  onOpenSettings?: () => void;
  /** What's new (the changelog drawer) */
  onOpenChangelog?: () => void;
  /** The newer stable release, when there is one: the header shows a pill for it */
  updateVersion?: string;
  onOpenUpdate?: () => void;
  onRebuild?: () => void;
  overview: boolean;
  onToggleOverview?: () => void;
}) {
  const label = state === 'live' ? 'Live' : state === 'stale' ? 'Not responding' : reachable ? 'Bridge stopped' : 'REAPER unreachable';
  const connected = [...sessions.values()].filter((x) => isConnected(x, now) && hasToolCalls(x));
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Mark active={state === 'live'} />
        <div className={styles.brandText}>
          <h1>MCP Bridge</h1>
          <p className={styles.sub}>
            {status ? (
              <>
                {/* Long paths lose their start, so the file name stays readable */}
                <span className={styles.subProject} title={status.project || undefined}>
                  <bdi dir="ltr">{status.project || 'Unsaved project'}</bdi>
                </span>
                <span className="dot-sep" />
                <span className={styles.subVersion}>REAPER {status.reaperVersion.split('/')[0]}</span>
              </>
            ) : (
              'reaper-mcp'
            )}
          </p>
        </div>
      </div>
      <div className={styles.headerActions}>
        {status?.sessions && state === 'live' && (
          <button
            className={cx(styles.agents, connected.length ? styles.agentsOn : '')}
            onClick={onShowAgents}
            title={
              (connected.length
                ? `Connected: ${connected.map((x) => `${sessionName(x)}${x.client ? ` (${x.client})` : ''}`).join(', ')}`
                : 'No agent has pinged in the last 45s') + '\nClick to see sessions'
            }
          >
            <span className={styles.agentsDots} aria-hidden>
              {connected.slice(0, 4).map((x) => (
                <i key={x.id} className={`hue-${sessionHue(x.id)}`} />
              ))}
            </span>
            {connected.length === 0 ? 'No agents' : `${connected.length} agent${connected.length === 1 ? '' : 's'}`}
          </button>
        )}
        {onRebuild && (
          <button
            className={cx(styles.btnRebuild, 'btn btn-sm')}
            onClick={onRebuild}
            title="Developer mode: your working tree changed since the last install. Build it, install it into REAPER, restart the bridge and reload"
          >
            Rebuild &amp; reload
          </button>
        )}
        {updateVersion && onOpenUpdate && (
          <button className={styles.update} onClick={onOpenUpdate} title={`reaper-mcp v${updateVersion} is available (you have v${__VERSION__}). See what’s new`}>
            <span className={styles.updateDot} aria-hidden />
            Update available
          </button>
        )}
        <CommandPaletteButton />
        {onOpenSettings && (
          <button className={styles.iconLink} onClick={onOpenSettings} title="Settings" aria-label="Settings">
            <Icon.Gear />
          </button>
        )}
        <a className={styles.iconLink} href={REPO_URL} target="_blank" rel="noreferrer" title="reaper-mcp on GitHub" aria-label="reaper-mcp on GitHub">
          <Icon.GitHub />
        </a>
        <HeaderMenu
          overview={overview}
          onToggleOverview={onToggleOverview}
          onRebuild={onRebuild}
          onOpenSettings={onOpenSettings}
          onOpenChangelog={onOpenChangelog}
          updateVersion={updateVersion}
          onOpenUpdate={onOpenUpdate}
        />
        <span className={styles.pill} data-state={state}>
          <span className={styles.pillDot} />
          {label}
        </span>
      </div>
    </header>
  );
}

/** Short windows (CSS): the header's actions and the stats/timeline toggle, folded into one menu */
function HeaderMenu({
  overview,
  onToggleOverview,
  onRebuild,
  onOpenSettings,
  onOpenChangelog,
  updateVersion,
  onOpenUpdate,
}: {
  overview: boolean;
  onToggleOverview?: () => void;
  onRebuild?: () => void;
  onOpenSettings?: () => void;
  onOpenChangelog?: () => void;
  updateVersion?: string;
  onOpenUpdate?: () => void;
}) {
  const update = updateVersion && onOpenUpdate ? onOpenUpdate : undefined;
  const flag = Boolean(onRebuild || update);
  const flagWhy = onRebuild ? 'rebuild available' : 'update available';
  const { open, setOpen, ref } = usePopover();
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className={styles.headerMenu} ref={ref}>
      <button
        className={cx(styles.iconLink, flag ? styles.headerMenuFlag : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={flag ? `More (${flagWhy})` : 'More'}
        title={flag ? `More: ${flagWhy}` : 'More'}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {onRebuild && (
            <button role="menuitem" className={styles.menuAccent} onClick={pick(onRebuild)}>
              Rebuild &amp; reload
            </button>
          )}
          {update && (
            <button role="menuitem" className={styles.menuAccent} onClick={pick(onOpenChangelog ?? update)}>
              What’s new in v{updateVersion}
            </button>
          )}
          {onToggleOverview && (
            <button role="menuitemcheckbox" aria-checked={overview} onClick={pick(onToggleOverview)}>
              <span className={styles.menuCheck} aria-hidden>
                {overview ? '✓' : ''}
              </span>
              Stats &amp; timeline
            </button>
          )}
          {onOpenSettings && (
            <button role="menuitem" onClick={pick(onOpenSettings)}>
              Settings
            </button>
          )}
          {onOpenChangelog && (
            <button role="menuitem" onClick={pick(onOpenChangelog)}>
              What’s new
            </button>
          )}
          <a role="menuitem" href={REPO_URL} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            reaper-mcp on GitHub
          </a>
        </div>
      )}
    </div>
  );
}
