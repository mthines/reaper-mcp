import type { BridgeStatus, Liveness } from '../lib/status.js';
import { REPO_URL } from '../lib/links.js';
import { usePopover } from '../lib/usePopover.js';
import { hasToolCalls, isConnected, sessionHue, sessionName, type Session } from '../lib/sessions.js';
import { Icon, Mark } from '../components/index.js';

export function Header({
  status,
  state,
  reachable,
  now,
  sessions,
  onShowAgents,
  onOpenSettings,
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
  onRebuild?: () => void;
  overview: boolean;
  onToggleOverview?: () => void;
}) {
  const label = state === 'live' ? 'Live' : state === 'stale' ? 'Not responding' : reachable ? 'Bridge stopped' : 'REAPER unreachable';
  const connected = [...sessions.values()].filter((x) => isConnected(x, now) && hasToolCalls(x));
  return (
    <header className="header">
      <div className="brand">
        <Mark active={state === 'live'} />
        <div className="brand-text">
          <h1>MCP Bridge</h1>
          <p className="sub">
            {status ? (
              <>
                {/* Long paths lose their start, so the file name stays readable */}
                <span className="sub-project" title={status.project || undefined}>
                  <bdi dir="ltr">{status.project || 'Unsaved project'}</bdi>
                </span>
                <span className="dot-sep" />
                <span className="sub-version">REAPER {status.reaperVersion.split('/')[0]}</span>
              </>
            ) : (
              'reaper-mcp'
            )}
          </p>
        </div>
      </div>
      <div className="header-actions">
        {status?.sessions && state === 'live' && (
          <button
            className={`agents ${connected.length ? 'agents-on' : ''}`}
            onClick={onShowAgents}
            title={
              (connected.length
                ? `Connected: ${connected.map((x) => `${sessionName(x)}${x.client ? ` (${x.client})` : ''}`).join(', ')}`
                : 'No agent has pinged in the last 45s') + '\nClick to see sessions'
            }
          >
            <span className="agents-dots" aria-hidden>
              {connected.slice(0, 4).map((x) => (
                <i key={x.id} className={`hue-${sessionHue(x.id)}`} />
              ))}
            </span>
            {connected.length === 0 ? 'No agents' : `${connected.length} agent${connected.length === 1 ? '' : 's'}`}
          </button>
        )}
        {onRebuild && (
          <button
            className="btn btn-sm btn-rebuild"
            onClick={onRebuild}
            title="Developer mode: your working tree changed since the last install. Build it, install it into REAPER, restart the bridge and reload"
          >
            Rebuild &amp; reload
          </button>
        )}
        {onOpenSettings && (
          <button className="icon-link" onClick={onOpenSettings} title="Settings" aria-label="Settings">
            <Icon.Gear />
          </button>
        )}
        <a className="icon-link" href={REPO_URL} target="_blank" rel="noreferrer" title="reaper-mcp on GitHub" aria-label="reaper-mcp on GitHub">
          <Icon.GitHub />
        </a>
        <HeaderMenu overview={overview} onToggleOverview={onToggleOverview} onRebuild={onRebuild} onOpenSettings={onOpenSettings} />
        <span className={`pill pill-${state}`}>
          <span className="pill-dot" />
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
}: {
  overview: boolean;
  onToggleOverview?: () => void;
  onRebuild?: () => void;
  onOpenSettings?: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="header-menu" ref={ref}>
      <button
        className={`icon-link ${onRebuild ? 'header-menu-flag' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={onRebuild ? 'More (rebuild available)' : 'More'}
        title={onRebuild ? 'More: your working tree changed, rebuild available' : 'More'}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          {onRebuild && (
            <button role="menuitem" className="menu-accent" onClick={pick(onRebuild)}>
              Rebuild &amp; reload
            </button>
          )}
          {onToggleOverview && (
            <button role="menuitemcheckbox" aria-checked={overview} onClick={pick(onToggleOverview)}>
              <span className="menu-check" aria-hidden>
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
          <a role="menuitem" href={REPO_URL} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            reaper-mcp on GitHub
          </a>
        </div>
      )}
    </div>
  );
}
