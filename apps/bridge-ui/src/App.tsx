import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createDemo } from './demo.js';
import {
  HISTORY_MAX,
  bucketize,
  commandsPerMinute,
  deriveSeries,
  formatAgo,
  formatDuration,
  formatMs,
  formatParams,
  groupByTool,
  isConnected,
  latencyStats,
  liveness,
  mergeLog,
  parseExtStateReply,
  parseHistoryReply,
  sessionHue,
  sessionName,
  settingUrl,
  statusRequestUrl,
  type BridgeHistory,
  type BridgeSettings,
  type BridgeStatus,
  type CommandEntry,
  type Sample,
  type Series,
  type Session,
  type SettingKey,
  type Liveness,
  type TimeBar,
  type ToolSort,
} from './status.js';

const REPO_URL = 'https://github.com/mthines/reaper-mcp';
declare const __VERSION__: string;

const POLL_MS = 500;
/** While hidden (minimized, or covered on macOS), keep pinging ui_seen slowly so the bridge knows we're open. */
const HIDDEN_POLL_MS = 2000;
const SLOW_MS = 100;
const VERY_SLOW_MS = 500;

const DEMO = new URLSearchParams(location.search).has('demo') ? createDemo() : null;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: per-viewer conveniences fall back to defaults
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // per-viewer convenience only
  }
}

interface Feed {
  status: BridgeStatus | null;
  history: BridgeHistory | null;
  /** Whether REAPER's web server answered at all */
  reachable: boolean;
  /** Local clock when status.ts last changed (liveness) */
  lastChangeAt: number;
  log: CommandEntry[];
}

/** Poll the bridge's ExtState through REAPER's web interface; pauses while the tab is hidden. */
function useBridgeFeed(paused: boolean): Feed & { clearLog: () => void } {
  const [feed, setFeed] = useState<Feed>({ status: null, history: null, reachable: true, lastChangeAt: 0, log: [] });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Highest sequence number cleared by the user; the bridge keeps re-sending its last 50
  const clearedThroughRef = useRef(0);

  useEffect(() => {
    const demo = DEMO;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const apply = (status: BridgeStatus | null, history: BridgeHistory | null, reachable: boolean) =>
      setFeed((prev) => {
        const changed = status !== null && status.ts !== prev.status?.ts;
        const restarted = status !== null && prev.status !== null && status.startedAt !== prev.status.startedAt;
        if (restarted) clearedThroughRef.current = 0;
        const base = restarted ? [] : prev.log;
        const incoming = status ? status.recent.filter((e) => e.n > clearedThroughRef.current) : [];
        return {
          status,
          history,
          reachable,
          lastChangeAt: changed ? Date.now() : prev.lastChangeAt,
          log: status && !pausedRef.current ? mergeLog(base, incoming) : base,
        };
      });

    const tick = async () => {
      if (demo) {
        if (!document.hidden) {
          const d = demo.tick();
          apply(d.status, d.history, true);
        }
      } else {
        try {
          const res = await fetch(statusRequestUrl(Date.now()), { cache: 'no-store' });
          const body = await res.text();
          apply(parseExtStateReply(body), parseHistoryReply(body), true);
        } catch {
          apply(null, null, false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const clearLog = () =>
    setFeed((prev) => {
      clearedThroughRef.current = Math.max(prev.log[0]?.n ?? 0, prev.status?.recent[0]?.n ?? 0);
      return { ...prev, log: [] };
    });

  return { ...feed, clearLog };
}

/** Snapshot the bridge's cumulative counters once per tick for the stat sparklines. */
function useHistory(status: BridgeStatus | null, now: number): Sample[] {
  const [samples, setSamples] = useState<Sample[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const st = statusRef.current;
    if (!st) return;
    setSamples((prev) => {
      const last = prev[prev.length - 1];
      // Bridge restarted: counters reset, start a fresh history
      const base = last && st.commands < last.commands ? [] : prev;
      return [...base, { t: now, commands: st.commands, errors: st.errors, deferMs: st.deferMs }].slice(-HISTORY_MAX);
    });
  }, [now]);

  return samples;
}

const SETTING_FIELD: Record<SettingKey, keyof BridgeSettings> = {
  cfg_paused: 'paused',
  cfg_readonly: 'readonly',
  cfg_open_on_start: 'openOnStart',
};

/**
 * Bridge settings as echoed in the status, with the user's last click applied on top until the
 * bridge confirms it (a poll takes up to 500ms, and the toggle shouldn't flicker back meanwhile).
 */
function useSettings(status: BridgeStatus | null): [BridgeSettings | null, (key: SettingKey, on: boolean) => void] {
  const [pending, setPending] = useState<Partial<BridgeSettings>>({});
  const echoed = status?.settings ?? null;

  useEffect(() => {
    if (!echoed) return;
    setPending((p) => {
      const left = Object.fromEntries(Object.entries(p).filter(([k, v]) => echoed[k as keyof BridgeSettings] !== v));
      return Object.keys(left).length === Object.keys(p).length ? p : left;
    });
  }, [echoed?.paused, echoed?.readonly, echoed?.openOnStart]);

  const set = (key: SettingKey, on: boolean) => {
    setPending((p) => ({ ...p, [SETTING_FIELD[key]]: on }));
    if (DEMO) DEMO.set(key, on);
    // A failed write shows up as the toggle snapping back once the bridge's echo disagrees
    else
      fetch(settingUrl(key, on), { cache: 'no-store' }).catch(() =>
        setPending((p) => {
          const { [SETTING_FIELD[key]]: _dropped, ...rest } = p;
          return rest;
        }),
      );
  };
  return [echoed ? { ...echoed, ...pending } : null, set];
}

const NOTIFY_KEY = 'mcp-bridge-notify';

/** Desktop notification per failed command while enabled (a per-viewer choice, kept in localStorage). */
function useErrorNotifications(log: CommandEntry[], sessions: Map<string, Session>) {
  const [enabled, setEnabled] = useState(() => load(NOTIFY_KEY) === '1' && notificationPermission() === 'granted');
  const notifiedThrough = useRef(log[0]?.n ?? 0);

  useEffect(() => {
    const newest = log[0]?.n ?? 0;
    if (enabled) {
      const fresh = log.filter((e) => e.n > notifiedThrough.current && !e.ok);
      // A burst collapses into one notification so a failing loop can't flood the desktop
      if (fresh.length > 3) {
        new Notification(`MCP Bridge: ${fresh.length} commands failed`, { body: fresh[0].e, tag: 'mcp-bridge-errors' });
      } else {
        for (const e of fresh.reverse()) {
          const who = e.s ? ` · ${sessionName(sessions.get(e.s) ?? { id: e.s })}` : '';
          new Notification(`${e.c} failed${who}`, { body: e.e, tag: `mcp-bridge-${e.n}` });
        }
      }
    }
    notifiedThrough.current = Math.max(notifiedThrough.current, newest);
  }, [log, enabled]);

  const toggle = async (on: boolean) => {
    if (on && notificationPermission() !== 'granted') {
      if (notificationPermission() === 'unsupported') return;
      if ((await Notification.requestPermission()) !== 'granted') return;
    }
    setEnabled(on);
    save(NOTIFY_KEY, on ? '1' : '0');
  };
  return [enabled, toggle] as const;
}

function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Re-render on a fixed cadence for relative times / uptime. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function App() {
  const [paused, setPaused] = useState(false);

  // Opened by the bridge as a Chromium --app window: settle on a compact size once
  useEffect(() => {
    if (new URLSearchParams(location.search).has('app') && window.outerWidth > 1100) {
      window.resizeTo(980, 720);
    }
  }, []);
  const { status, history, reachable, lastChangeAt, log, clearLog } = useBridgeFeed(paused);
  const now = useNow(1000);
  const state: Liveness = liveness(status, lastChangeAt, now);
  const samples = useHistory(status, now);
  const series = useMemo(() => deriveSeries(samples, log), [samples, log]);
  const sessions = useMemo(() => new Map((status?.sessions ?? []).map((x) => [x.id, x])), [status?.sessions]);
  const [settings, setSetting] = useSettings(status);
  const [notify, setNotify] = useErrorNotifications(log, sessions);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.title = `${state === 'live' ? '●' : '○'} MCP Bridge`;
  }, [state]);

  return (
    <div className="shell">
      <Header
        status={status}
        state={state}
        reachable={reachable}
        now={now}
        onOpenSettings={settings ? () => setSettingsOpen((o) => !o) : undefined}
      />
      {status ? (
        <>
          <Notices status={status} settings={settings} onSet={setSetting} />
          <Stats status={status} log={log} now={now} series={series} />
          <Timeline history={history} now={now} />
          <Log
            log={log}
            sessions={sessions}
            paused={paused}
            onTogglePause={() => setPaused((p) => !p)}
            onClear={clearLog}
            now={now}
          />
          {settingsOpen && settings && (
            <SettingsPanel
              settings={settings}
              onSet={setSetting}
              notify={notify}
              onNotify={setNotify}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          <footer className="footer">
            <span className="mono" title="Bridge IPC directory">{status.bridgeDir}</span>
            <span className="footer-meta">
              Updated {formatAgo(now - lastChangeAt)}
              <span className="dot-sep" />
              <a href={REPO_URL} target="_blank" rel="noreferrer">reaper-mcp v{__VERSION__}</a>
              <span className="dot-sep" />
              <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Report an issue</a>
            </span>
          </footer>
        </>
      ) : (
        <Offline reachable={reachable} />
      )}
    </div>
  );
}

function Header({
  status,
  state,
  reachable,
  now,
  onOpenSettings,
}: {
  status: BridgeStatus | null;
  state: Liveness;
  reachable: boolean;
  now: number;
  onOpenSettings?: () => void;
}) {
  const label = state === 'live' ? 'Live' : state === 'stale' ? 'Not responding' : reachable ? 'Bridge stopped' : 'REAPER unreachable';
  const connected = status?.sessions?.filter((x) => isConnected(x, now)) ?? [];
  return (
    <header className="header">
      <div className="brand">
        <Mark active={state === 'live'} />
        <div>
          <h1>MCP Bridge</h1>
          <p className="sub">
            {status ? (
              <>
                {status.project || 'Unsaved project'}
                <span className="dot-sep" />
                REAPER {status.reaperVersion.split('/')[0]}
              </>
            ) : (
              'reaper-mcp'
            )}
          </p>
        </div>
      </div>
      <div className="header-actions">
        {status?.sessions && state === 'live' && (
          <span
            className={`agents ${connected.length ? 'agents-on' : ''}`}
            title={connected.length ? connected.map((x) => `${sessionName(x)}${x.client ? ` (${x.client})` : ''}`).join('\n') : 'No agent has pinged in the last 45s'}
          >
            <span className="agents-dots" aria-hidden>
              {connected.slice(0, 4).map((x) => (
                <i key={x.id} className={`hue-${sessionHue(x.id)}`} />
              ))}
            </span>
            {connected.length === 0 ? 'No agents' : `${connected.length} agent${connected.length === 1 ? '' : 's'}`}
          </span>
        )}
        {onOpenSettings && (
          <button className="icon-link" onClick={onOpenSettings} title="Settings" aria-label="Settings">
            <GearIcon />
          </button>
        )}
        <a className="icon-link" href={REPO_URL} target="_blank" rel="noreferrer" title="reaper-mcp on GitHub" aria-label="reaper-mcp on GitHub">
          <GitHubIcon />
        </a>
        <span className={`pill pill-${state}`}>
          <span className="pill-dot" />
          {label}
        </span>
      </div>
    </header>
  );
}

const SWS_DISMISS_KEY = 'mcp-bridge-sws-dismissed';

/** Things the user should act on: control is restricted, or the install is stale or incomplete. */
function Notices({
  status,
  settings,
  onSet,
}: {
  status: BridgeStatus;
  settings: BridgeSettings | null;
  onSet: (key: SettingKey, on: boolean) => void;
}) {
  const [swsDismissed, setSwsDismissed] = useState(() => load(SWS_DISMISS_KEY) === '1');
  const health = status.health;
  const notices: ReactNode[] = [];

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
      <Notice key="outdated" tone="warn">
        <b>A newer bridge is installed.</b> Stop <code>mcp_bridge.lua</code> and run it again to load it.
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
            <CloseIcon />
          </button>
        }
      >
        <b>SWS isn’t installed.</b> Envelope and some FX tools fall back to slower paths.{' '}
        <a href="https://www.sws-extension.org" target="_blank" rel="noreferrer">Get SWS</a>
      </Notice>,
    );
  }
  return notices.length ? <div className="notices">{notices}</div> : null;
}

function Notice({ tone, action, children }: { tone: 'warn' | 'bad' | 'info'; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      <span className="notice-dot" aria-hidden />
      <span className="notice-text">{children}</span>
      {action}
    </div>
  );
}

function SettingsPanel({
  settings,
  onSet,
  notify,
  onNotify,
  onClose,
}: {
  settings: BridgeSettings;
  onSet: (key: SettingKey, on: boolean) => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const notifySupported = notificationPermission() !== 'unsupported';
  const notifyDenied = notificationPermission() === 'denied';

  return (
    <aside className="drawer drawer-settings" aria-label="Settings">
      <div className="drawer-head">
        <div className="drawer-title">Settings</div>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>
      <div className="drawer-body">
        <div className="setting-group">
          <h3>Agent control</h3>
          <Toggle
            label="Pause agents"
            hint="Reject every command with a “paused by user” error. Handy while you’re hands-on. Clears when REAPER restarts."
            on={settings.paused}
            onChange={(on) => onSet('cfg_paused', on)}
          />
          <Toggle
            label="Read-only mode"
            hint="Agents can inspect, meter and play, but anything that changes the project fails. Persists."
            on={settings.readonly}
            onChange={(on) => onSet('cfg_readonly', on)}
          />
        </div>
        <div className="setting-group">
          <h3>This window</h3>
          <Toggle
            label="Open when the bridge starts"
            hint="Pop this window up each time mcp_bridge.lua starts. Persists."
            on={settings.openOnStart}
            onChange={(on) => onSet('cfg_open_on_start', on)}
          />
          <Toggle
            label="Desktop notifications for errors"
            hint={
              !notifySupported
                ? 'This browser doesn’t support notifications.'
                : notifyDenied
                  ? 'Blocked for this site. Allow notifications in the browser’s site settings.'
                  : 'Get a system notification when a command fails, even when this window is in the background.'
            }
            on={notify}
            disabled={!notifySupported || notifyDenied}
            onChange={onNotify}
          />
        </div>
      </div>
    </aside>
  );
}

function Toggle({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={`toggle ${disabled ? 'toggle-disabled' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        <span className="toggle-hint">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(ev) => onChange(ev.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

function Mark({ active }: { active: boolean }) {
  return (
    <div className={`mark ${active ? 'mark-active' : ''}`} aria-hidden>
      {[0.45, 0.8, 1, 0.65, 0.35].map((h, i) => (
        <span key={i} style={{ '--h': h, '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

function Stats({ status, log, now, series }: { status: BridgeStatus; log: CommandEntry[]; now: number; series: Series }) {
  const lat = latencyStats(status.recent);
  const errorRate = status.commands > 0 ? (status.errors / status.commands) * 100 : 0;
  return (
    <section className="stats">
      <Stat
        label="Uptime"
        value={formatDuration(now - status.startedAt)}
        hint={`since ${new Date(status.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`}
      />
      <Stat
        label="Commands"
        value={status.commands.toLocaleString()}
        hint={`${commandsPerMinute(log, now)} / min`}
        spark={<Sparkline values={series.commands} floor={2} tone="accent" label="commands per second" variant="bars" format={(v) => `${v} cmd`} />}
      />
      <Stat
        label="Errors"
        value={status.errors.toLocaleString()}
        hint={status.commands > 0 ? `${errorRate.toFixed(1)}%` : '—'}
        tone={status.errors > 0 ? 'bad' : undefined}
        spark={<Sparkline values={series.errors} floor={2} tone={series.errors.some((v) => v > 0) ? 'bad' : 'muted'} label="errors per second" variant="bars" format={(v) => `${v} error${v === 1 ? '' : 's'}`} />}
      />
      <Stat
        label="Latency"
        value={lat ? formatMs(lat.avg) : '—'}
        hint={lat ? `p95 ${formatMs(lat.p95)}` : 'avg handler'}
        spark={<Sparkline values={series.latency} floor={5} tone="accent" label="avg handler ms" format={formatMs} />}
      />
      <Stat
        label="Loop"
        value={status.deferMs > 0 ? formatMs(status.deferMs) : '—'}
        hint="defer cycle"
        tone={status.deferMs > 100 ? 'warn' : undefined}
        spark={<Sparkline values={series.loop} floor={40} tone={status.deferMs > 100 ? 'warn' : 'muted'} label="defer cycle ms" format={formatMs} />}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'bad' | 'warn';
  spark?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
      {spark && <div className="stat-spark">{spark}</div>}
    </div>
  );
}

const SPARK_W = 100;
const SPARK_H = 24;

/**
 * Last-minute trend, one slot per second, newest on the right. `floor` is the minimum y-range
 * so quiet periods read as a flat baseline instead of noise blown up to full height.
 * Counts render as bars; the line variant connects across seconds with no data (null).
 * Hover shows the value at that second; the guide/dot are HTML so they don't stretch with the SVG.
 */
function Sparkline({
  values,
  floor,
  tone,
  label,
  format,
  variant = 'line',
}: {
  values: Array<number | null>;
  floor: number;
  tone: 'accent' | 'bad' | 'warn' | 'muted';
  label: string;
  format: (v: number) => string;
  variant?: 'line' | 'bars';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const slots = HISTORY_MAX - 1;
  const max = Math.max(floor, ...values.map((v) => v ?? 0)) * 1.15;
  const slotW = SPARK_W / slots;
  const offset = slots - values.length;
  const y = (v: number) => SPARK_H - 1 - (v / max) * (SPARK_H - 3);

  const onMove = (ev: MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const i = Math.floor(((ev.clientX - rect.left) / rect.width) * slots) - offset;
    if (i < 0 || i >= values.length) return setHover(null);
    if (variant === 'bars' || values[i] !== null) return setHover(i);
    // The line is drawn through empty seconds, so snap to the nearest real point
    let best: number | null = null;
    values.forEach((v, j) => {
      if (v !== null && (best === null || Math.abs(j - i) < Math.abs(best - i))) best = j;
    });
    setHover(best);
  };

  let body: ReactNode;
  if (variant === 'bars') {
    body = values.map((v, i) =>
      v ? (
        <rect
          key={i}
          className={`spark-bar ${hover === i ? 'spark-bar-hover' : ''}`}
          x={(offset + i) * slotW + slotW * 0.15}
          width={slotW * 0.7}
          y={y(v)}
          height={SPARK_H - y(v)}
          rx={0.4}
        />
      ) : null,
    );
  } else {
    const pts = values.flatMap((v, i) => (v === null ? [] : [[(offset + i + 0.5) * slotW, y(v)] as const]));
    if (pts.length > 0) {
      const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`).join('');
      body = <path className="spark-line" d={pts.length > 1 ? line : `M${pts[0][0]},${pts[0][1]}h0.01`} />;
    }
  }

  const hv = hover === null ? undefined : values[hover];
  const leftPct = hover === null ? 0 : ((offset + hover + 0.5) / slots) * 100;
  const ago = hover === null ? 0 : values.length - 1 - hover;
  const tipAlign = leftPct < 18 ? 'start' : leftPct > 82 ? 'end' : 'center';

  return (
    <div className={`spark-wrap spark-${tone}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg className="spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={`${label}, last minute`}>
        <line className="spark-base" x1="0" x2={SPARK_W} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} />
        {body}
      </svg>
      {hover !== null && (
        <>
          <span className="spark-guide" style={{ left: `${leftPct}%` }} />
          {variant === 'line' && hv != null && (
            <span className="spark-dot" style={{ left: `${leftPct}%`, top: `${(y(hv) / SPARK_H) * 100}%` }} />
          )}
          <span className={`spark-tip spark-tip-${tipAlign}`} style={{ left: `${leftPct}%` }}>
            <b>{hv == null ? 'no commands' : format(hv)}</b>
            <span>{ago === 0 ? 'now' : `${ago}s ago`}</span>
          </span>
        </>
      )}
    </div>
  );
}

/** Log-scaled so 1 ms and 500 ms both read. */
const latencyScale = (ms: number) => Math.min(1, Math.max(0.06, Math.log10(1 + ms) / Math.log10(1 + VERY_SLOW_MS)));

const RANGES = [
  { key: '5m', ms: 5 * 60_000, bars: 30 },
  { key: '10m', ms: 10 * 60_000, bars: 60 },
  { key: '30m', ms: 30 * 60_000, bars: 60 },
  { key: '1h', ms: 60 * 60_000, bars: 60 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];
const RANGE_STORAGE_KEY = 'mcp-bridge-range';

function loadRange(): RangeKey {
  try {
    const saved = localStorage.getItem(RANGE_STORAGE_KEY);
    if (RANGES.some((r) => r.key === saved)) return saved as RangeKey;
  } catch {
    // storage blocked: fall back to the default
  }
  return '30m';
}

/** Round up to a readable, even axis maximum with ~10% headroom, at least 4. */
function niceMax(v: number): number {
  const target = Math.max(4, v * 1.1);
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((n) => n >= target) ?? target;
}

const clock = (t: number, seconds = false) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });

/** Commands per time slot over a fixed window (stacked ok / slow / error), from the bridge's 10s buckets. */
function Timeline({ history, now }: { history: BridgeHistory | null; now: number }) {
  const [rangeKey, setRangeKey] = useState<RangeKey>(loadRange);
  const [hover, setHover] = useState<number | null>(null);
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];
  const bars = useMemo(() => bucketize(history, range.ms, range.bars, now), [history, range, now]);
  const peak = Math.max(0, ...bars.map((b) => b.total));
  const yMax = niceMax(peak);
  const total = bars.reduce((sum, b) => sum + b.total, 0);
  const barSeconds = range.ms / range.bars / 1000;

  const choose = (key: RangeKey) => {
    setRangeKey(key);
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, key);
    } catch {
      // per-viewer convenience only
    }
  };

  const hb: TimeBar | undefined = hover === null ? undefined : bars[hover];
  const leftPct = hover === null ? 0 : ((hover + 0.5) / bars.length) * 100;
  const tipAlign = leftPct < 15 ? 'start' : leftPct > 85 ? 'end' : 'center';

  return (
    <section className="timeline" aria-label="Commands over time">
      <div className="timeline-head">
        <span className="timeline-title">
          Commands <span className="timeline-sub">{total.toLocaleString()} in the last {rangeKey} · {barSeconds}s per bar</span>
        </span>
        <div className="timeline-controls">
          <span className="legend">
            <i className="lg lg-ok" /> ok
            <i className="lg lg-slow" /> ≥ {SLOW_MS} ms
            <i className="lg lg-err" /> error
          </span>
          <div className="seg seg-sm" role="tablist" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.key} role="tab" aria-selected={r.key === rangeKey} onClick={() => choose(r.key)}>
                {r.key}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="timeline-chart">
        <div className="y-axis" aria-hidden>
          <span>{yMax}</span>
          <span>{yMax / 2}</span>
          <span>0</span>
        </div>
        <div className="plot" onMouseLeave={() => setHover(null)}>
          <div className="grid" aria-hidden />
          {bars.map((b, i) => {
            const ok = Math.max(0, b.total - b.errors - b.slow);
            return (
              <div key={b.start} className={`tbar ${hover === i ? 'tbar-hover' : ''}`} onMouseEnter={() => setHover(i)}>
                <div className="tstack" style={{ height: `${(b.total / yMax) * 100}%` }}>
                  {b.errors > 0 && <span className="seg-err" style={{ flexGrow: b.errors }} />}
                  {b.slow > 0 && <span className="seg-slow" style={{ flexGrow: b.slow }} />}
                  {ok > 0 && <span className="seg-ok" style={{ flexGrow: ok }} />}
                </div>
              </div>
            );
          })}
          {hb && (
            <div className={`ttip ttip-${tipAlign}`} style={{ left: `${leftPct}%` }}>
              <div className="ttip-time">
                {clock(hb.start, barSeconds < 60)}–{clock(hb.end, barSeconds < 60)}
              </div>
              {hb.total === 0 ? (
                <div className="ttip-row">No commands</div>
              ) : (
                <>
                  <div className="ttip-row">
                    <b>{hb.total}</b> command{hb.total === 1 ? '' : 's'}
                  </div>
                  {hb.slow > 0 && (
                    <div className="ttip-row">
                      <i className="lg lg-slow" /> {hb.slow} slow
                    </div>
                  )}
                  {hb.errors > 0 && (
                    <div className="ttip-row">
                      <i className="lg lg-err" /> {hb.errors} error{hb.errors === 1 ? '' : 's'}
                    </div>
                  )}
                  {hb.avgMs !== null && <div className="ttip-row ttip-muted">avg {formatMs(hb.avgMs)}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="x-axis" aria-hidden>
        <span>−{rangeKey}</span>
        <span>{clock(now - range.ms / 2)}</span>
        <span>now</span>
      </div>
    </section>
  );
}

type Filter = 'all' | 'errors';
type View = 'calls' | 'tools' | 'sessions';
const VIEW_KEY = 'mcp-bridge-view';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'calls', label: 'Calls' },
  { key: 'tools', label: 'Tools' },
  { key: 'sessions', label: 'Sessions' },
];

function Log({
  log,
  sessions,
  paused,
  onTogglePause,
  onClear,
  now,
}: {
  log: CommandEntry[];
  sessions: Map<string, Session>;
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  now: number;
}) {
  const [view, setView] = useState<View>(() => (VIEWS.some((v) => v.key === load(VIEW_KEY)) ? (load(VIEW_KEY) as View) : 'calls'));
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<CommandEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const choose = (v: View) => {
    setView(v);
    save(VIEW_KEY, v);
    if (v !== 'calls') setSelected(null);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === '/' && document.activeElement !== searchRef.current) {
        ev.preventDefault();
        searchRef.current?.focus();
      } else if (ev.key === 'Escape') {
        // Close the details sidebar first, then clear the filter
        if (selectedRef.current) setSelected(null);
        else {
          setQuery('');
          searchRef.current?.blur();
        }
      } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && selectedRef.current) {
        ev.preventDefault();
        const list = rowsRef.current;
        const i = list.findIndex((e) => e.n === selectedRef.current?.n);
        const next = list[i + (ev.key === 'ArrowDown' ? 1 : -1)];
        if (next) setSelected(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sessions seen in this window's log, plus any the bridge knows about
  const sessionIds = useMemo(() => {
    const ids = new Set(sessions.keys());
    for (const e of log) if (e.s) ids.add(e.s);
    // Oldest first, so chips don't reshuffle as agents take turns
    const first = (id: string) => sessions.get(id)?.first ?? Infinity;
    return [...ids].sort((a, b) => first(a) - first(b));
  }, [log, sessions]);
  const multiSession = sessionIds.length > 1;
  const sessionOf = (id: string): Session => sessions.get(id) ?? { id, first: 0, last: 0, commands: 0, errors: 0 };

  const scoped = useMemo(() => (sessionFilter ? log.filter((e) => e.s === sessionFilter) : log), [log, sessionFilter]);
  const errorCount = useMemo(() => scoped.filter((e) => !e.ok).length, [scoped]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter(
      (e) => (filter === 'all' || !e.ok) && (!q || e.c.toLowerCase().includes(q) || e.e?.toLowerCase().includes(q)),
    );
  }, [scoped, filter, query]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    document.querySelector('.row-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const copy = async () => {
    const text = rows
      .map((e) => `${new Date(e.t).toISOString()}  #${e.n}  ${e.ok ? 'ok ' : 'ERR'}  ${e.c}  ${e.ms}ms${e.s ? `  [${sessionName(sessionOf(e.s))}]` : ''}${e.e ? `  ${e.e}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard needs a secure context (localhost is fine; LAN IPs are not)
    }
  };

  const showCalls = (opts: { tool?: string; session?: string; errors?: boolean }) => {
    if (opts.tool !== undefined) setQuery(opts.tool);
    if (opts.session !== undefined) setSessionFilter(opts.session);
    setFilter(opts.errors ? 'errors' : 'all');
    choose('calls');
  };

  return (
    <section className="log">
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => choose(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        {view === 'calls' && (
          <div className="seg" role="tablist" aria-label="Result">
            <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
              All <span className="count">{scoped.length}</span>
            </button>
            <button role="tab" aria-selected={filter === 'errors'} onClick={() => setFilter('errors')}>
              Errors <span className={`count ${errorCount ? 'count-bad' : ''}`}>{errorCount}</span>
            </button>
          </div>
        )}
        {view !== 'sessions' && (
          <label className="search">
            <SearchIcon />
            <input
              ref={searchRef}
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder={view === 'tools' ? 'Filter tools' : 'Filter commands or errors'}
              spellCheck={false}
            />
            {!query && <kbd>/</kbd>}
          </label>
        )}
        {view === 'calls' && (
          <div className="actions">
            <button className={`btn ${paused ? 'btn-on' : ''}`} onClick={onTogglePause} title="Freeze the log to read it">
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn" onClick={copy} disabled={rows.length === 0} title="Copy visible rows">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setSelected(null);
                onClear();
              }}
              disabled={log.length === 0}
              title="Clear this window's log (counters and timeline keep their history)"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {multiSession && view !== 'sessions' && (
        <div className="chips" role="tablist" aria-label="Agent session">
          <button role="tab" aria-selected={sessionFilter === null} className="chip" onClick={() => setSessionFilter(null)}>
            All agents
          </button>
          {sessionIds.map((id) => {
            const x = sessionOf(id);
            const n = log.filter((e) => e.s === id).length;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={sessionFilter === id}
                className="chip"
                title={x.dir ?? id}
                onClick={() => setSessionFilter(sessionFilter === id ? null : id)}
              >
                <i className={`sdot hue-${sessionHue(id)} ${isConnected(x, now) ? '' : 'sdot-off'}`} />
                {sessionName(x)}
                <span className="count">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'tools' ? (
        <ToolsView log={scoped} query={query} now={now} onPick={(tool, errors) => showCalls({ tool, errors })} />
      ) : view === 'sessions' ? (
        <SessionsView ids={sessionIds} sessionOf={sessionOf} log={log} now={now} onPick={(session) => showCalls({ session, tool: '' })} />
      ) : (
        <div className="rows" role="log" aria-live="off">
          {rows.length === 0 ? (
            <div className="empty">
              {log.length === 0
                ? 'No commands yet. New ones show up here as your agent sends them.'
                : filter === 'errors' && !query
                  ? 'No errors. Nice.'
                  : 'Nothing matches that filter.'}
            </div>
          ) : (
            rows.map((e) => (
              <Row
                key={e.n}
                entry={e}
                now={now}
                session={multiSession && !sessionFilter && e.s ? sessionOf(e.s) : null}
                selected={selected?.n === e.n}
                onSelect={() => setSelected(selected?.n === e.n ? null : e)}
              />
            ))
          )}
        </div>
      )}
      {paused && view === 'calls' && <div className="paused-banner">Paused · new commands are still counted, the log is frozen</div>}
      {selected && (
        <Details entry={selected} session={selected.s ? sessionOf(selected.s) : null} now={now} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}

const TOOL_SORTS: Array<{ key: ToolSort; label: string }> = [
  { key: 'count', label: 'Calls' },
  { key: 'errors', label: 'Errors' },
  { key: 'slowest', label: 'p95' },
  { key: 'recent', label: 'Last' },
];

/** One row per command type: how often, how reliable, how fast. Click a row to see its calls. */
function ToolsView({
  log,
  query,
  now,
  onPick,
}: {
  log: CommandEntry[];
  query: string;
  now: number;
  onPick: (tool: string, errors: boolean) => void;
}) {
  const [sort, setSort] = useState<ToolSort>('count');
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => groupByTool(log, sort).filter((g) => !q || g.c.includes(q)), [log, sort, q]);
  const top = Math.max(1, ...groups.map((g) => g.count));
  const kinds = useMemo(() => {
    const k = { read: 0, write: 0, transport: 0 };
    for (const g of groupByTool(log)) k[g.kind] += g.count;
    return k;
  }, [log]);

  if (log.length === 0) return <div className="rows"><div className="empty">No commands yet. Tools show up here once your agent calls them.</div></div>;

  return (
    <div className="rows tools">
      <div className="mix" aria-label="Calls by kind">
        {(['read', 'write', 'transport'] as const).map((k) =>
          kinds[k] ? <span key={k} className={`mix-seg kind-${k}`} style={{ flexGrow: kinds[k] }} title={`${kinds[k]} ${k}`} /> : null,
        )}
      </div>
      <div className="mix-legend">
        <span><i className="kdot kind-read" /> inspect {kinds.read}</span>
        <span><i className="kdot kind-write" /> change {kinds.write}</span>
        <span><i className="kdot kind-transport" /> transport {kinds.transport}</span>
        <span className="mix-note">{groups.length} tools · last {log.length} calls</span>
      </div>
      <div className="tool-head" role="row">
        <span>Tool</span>
        {TOOL_SORTS.map((x) => (
          <button key={x.key} className={`th ${sort === x.key ? 'th-on' : ''}`} onClick={() => setSort(x.key)} aria-pressed={sort === x.key}>
            {x.label}
            {sort === x.key && ' ↓'}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="empty">No tool matches that filter.</div>
      ) : (
        groups.map((g) => (
          <button key={g.c} className="tool-row" onClick={() => onPick(g.c, false)} title={g.lastError ? `Last error: ${g.lastError}` : `Show ${g.c} calls`}>
            <span className="tool-name">
              <i className={`kdot kind-${g.kind}`} />
              <span className="mono">{g.c}</span>
              <span className="share" aria-hidden>
                <span style={{ width: `${(g.count / top) * 100}%` }} />
              </span>
            </span>
            <span className="mono num">{g.count}</span>
            <span
              className={`mono num ${g.errors ? 'tone-bad err-link' : 'muted'}`}
              onClick={(ev) => {
                if (!g.errors) return;
                ev.stopPropagation();
                onPick(g.c, true);
              }}
            >
              {g.errors ? `${g.errors} · ${Math.round((g.errors / g.count) * 100)}%` : '0'}
            </span>
            <span className={`mono num ${g.p95 >= VERY_SLOW_MS ? 'tone-bad' : g.p95 >= SLOW_MS ? 'tone-warn' : ''}`}>{formatMs(g.p95)}</span>
            <span className="num muted">{formatAgo(now - g.last)}</span>
          </button>
        ))
      )}
    </div>
  );
}

/** One card per agent connection, newest activity first. Click one to filter the calls to it. */
function SessionsView({
  ids,
  sessionOf,
  log,
  now,
  onPick,
}: {
  ids: string[];
  sessionOf: (id: string) => Session;
  log: CommandEntry[];
  now: number;
  onPick: (id: string) => void;
}) {
  // Connected agents first; otherwise keep the stable oldest-first order of `ids`
  const cards = ids.map(sessionOf).sort((a, b) => Number(isConnected(b, now)) - Number(isConnected(a, now)));
  if (cards.length === 0) {
    return (
      <div className="rows">
        <div className="empty">
          No agent sessions yet. Each Claude Code session that connects to the REAPER MCP server shows up here.
        </div>
      </div>
    );
  }
  return (
    <div className="rows sessions">
      {cards.map((x) => {
        const own = log.filter((e) => e.s === x.id);
        const tools = groupByTool(own).slice(0, 4);
        const live = isConnected(x, now);
        return (
          <button key={x.id} className="session-card" onClick={() => onPick(x.id)} title="Show this session's calls">
            <div className="session-top">
              <i className={`sdot hue-${sessionHue(x.id)} ${live ? '' : 'sdot-off'}`} />
              <span className="session-name">{sessionName(x)}</span>
              {x.client && <span className="tag">{x.client}</span>}
              <span className={`session-state ${live ? 'on' : ''}`}>{live ? 'Connected' : x.ended ? 'Disconnected' : 'Idle'}</span>
            </div>
            {x.dir && <div className="session-dir mono" title={x.dir}>{x.dir}</div>}
            <div className="session-facts">
              <span><b>{(x.commands || own.length).toLocaleString()}</b> calls</span>
              <span className={x.errors ? 'tone-bad' : ''}><b>{x.errors.toLocaleString()}</b> errors</span>
              {x.first > 0 && <span>started {clock(x.first)}</span>}
              {x.last > 0 && <span>active {formatAgo(now - x.last)}</span>}
            </div>
            {tools.length > 0 && (
              <div className="session-tools">
                {tools.map((g) => (
                  <span key={g.c} className="tool-chip mono">
                    <i className={`kdot kind-${g.kind}`} />
                    {g.c} <span className="muted">×{g.count}</span>
                  </span>
                ))}
              </div>
            )}
            <span className="session-id mono">{x.id}</span>
          </button>
        );
      })}
    </div>
  );
}

function Row({
  entry: e,
  now,
  session,
  selected,
  onSelect,
}: {
  entry: CommandEntry;
  now: number;
  /** Shown as a tag when several agents share the log */
  session: Session | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const time = new Date(e.t);
  const hhmmss = time.toLocaleTimeString([], { hour12: false });
  const ms = String(time.getMilliseconds()).padStart(3, '0');
  const speed = e.ms >= VERY_SLOW_MS ? 'very-slow' : e.ms >= SLOW_MS ? 'slow' : '';
  return (
    <div className={`row ${e.ok ? '' : 'row-err'} ${selected ? 'row-selected' : ''}`}>
      <button className="row-main" onClick={onSelect} aria-pressed={selected}>
        <span className="row-time mono" title={formatAgo(now - e.t)}>
          {hhmmss}
          <span className="row-ms">.{ms}</span>
        </span>
        <span className={`status-dot ${e.ok ? 'ok' : 'err'}`} />
        <span className="row-cmd mono">{e.c}</span>
        {e.e && <span className="row-err-inline">{e.e}</span>}
        <span className="row-end">
          {session && (
            <span className="row-session" title={session.dir ?? session.id}>
              <i className={`sdot hue-${sessionHue(session.id)}`} />
              {sessionName(session)}
            </span>
          )}
          <span className={`row-dur mono ${speed}`}>
            <span className="dur-track" aria-hidden>
              <span className="dur-fill" style={{ width: `${latencyScale(e.ms) * 100}%` }} />
            </span>
            {formatMs(e.ms)}
          </span>
        </span>
      </button>
    </div>
  );
}

/** Right-hand sidebar with everything known about one command. ↑/↓ move between rows, Esc closes. */
function Details({ entry: e, session, now, onClose }: { entry: CommandEntry; session: Session | null; now: number; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const time = new Date(e.t);
  const speed = e.ms >= VERY_SLOW_MS ? 'Very slow' : e.ms >= SLOW_MS ? 'Slow' : 'Fast';
  const params = formatParams(e.p);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // clipboard needs a secure context
    }
  };

  return (
    <aside className="drawer" aria-label={`Details for ${e.c}`}>
      <div className="drawer-head">
        <div className="drawer-title">
          <span className={`status-dot ${e.ok ? 'ok' : 'err'}`} />
          <span className="mono">{e.c}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>
      <div className="drawer-body">
        <div className={`result-badge ${e.ok ? 'result-ok' : 'result-err'}`}>{e.ok ? 'Success' : 'Error'}</div>

        <dl className="facts">
          <dt>Handler time</dt>
          <dd>
            <span className="mono">{e.ms} ms</span> <span className="muted">· {speed}</span>
          </dd>
          <dt>When</dt>
          <dd>
            {time.toLocaleTimeString([], { hour12: false })}.{String(time.getMilliseconds()).padStart(3, '0')}{' '}
            <span className="muted">· {formatAgo(now - e.t)}</span>
          </dd>
          {session && (
            <>
              <dt>Session</dt>
              <dd>
                <span className="session-inline">
                  <i className={`sdot hue-${sessionHue(session.id)}`} />
                  {sessionName(session)}
                  {session.client && <span className="muted"> · {session.client}</span>}
                </span>
                <span className="mono muted session-sub">{session.id}</span>
              </dd>
            </>
          )}
          <dt>Timestamp</dt>
          <dd className="mono">{time.toISOString()}</dd>
          <dt>Sequence</dt>
          <dd className="mono">#{e.n}</dd>
        </dl>

        {e.e && (
          <div className="error-block">
            <div className="error-head">
              <span>Error</span>
              <button className="link-btn" onClick={() => copy('error', e.e ?? '')}>
                {copied === 'error' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre>{e.e}</pre>
          </div>
        )}

        <div className="code-block">
          <div className="code-head">
            <span>Params</span>
            {params && (
              <button className="link-btn" onClick={() => copy('params', params)}>
                {copied === 'params' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          <pre>{params ?? <span className="muted">No params</span>}</pre>
        </div>

        <button className="btn btn-block" onClick={() => copy('json', JSON.stringify({ ...e, p: parseParams(e.p) }, null, 2))}>
          {copied === 'json' ? 'Copied' : 'Copy as JSON'}
        </button>
        <p className="drawer-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> to move between commands · <kbd>Esc</kbd> to close
        </p>
      </div>
    </aside>
  );
}

/** Params as a value when they parse, else the truncated text the bridge sent. */
function parseParams(p: string | undefined): unknown {
  if (!p) return undefined;
  try {
    return JSON.parse(p);
  } catch {
    return p;
  }
}

function Offline({ reachable }: { reachable: boolean }) {
  return (
    <section className="offline">
      <div className="offline-icon" aria-hidden>
        <Mark active={false} />
      </div>
      {reachable ? (
        <>
          <h2>The bridge isn’t running</h2>
          <p>REAPER is up, but <code>mcp_bridge.lua</code> hasn’t published a status yet.</p>
          <ol>
            <li>In REAPER: Actions → Show action list → Load ReaScript…</li>
            <li>Select <code>Scripts/mcp_bridge.lua</code> and run it</li>
            <li>This page connects on its own. No reload needed.</li>
          </ol>
        </>
      ) : (
        <>
          <h2>Can’t reach REAPER</h2>
          <p>This page talks to REAPER through its built-in web interface.</p>
          <ol>
            <li>Make sure REAPER is open</li>
            <li>Preferences → Control/OSC/Web → Add → Web browser interface</li>
            <li>Open <code>http://localhost:&lt;port&gt;/mcp_bridge.html</code></li>
          </ol>
        </>
      )}
    </section>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.6 1.5h2.8l.4 1.9 1.3.7 1.8-.7 1.4 2.4-1.4 1.3v1.6l1.4 1.3-1.4 2.4-1.8-.7-1.3.7-.4 1.9H6.6l-.4-1.9-1.3-.7-1.8.7-1.4-2.4 1.4-1.3V7.1L1.7 5.8l1.4-2.4 1.8.7 1.3-.7.4-1.9z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
