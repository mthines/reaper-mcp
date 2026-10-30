import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Combobox } from './Combobox.js';
import { createDemo } from './demo.js';
import { compareVersions, controlUrl, updateLog, useLatestRelease, type BridgeAction } from './update.js';
import { manualInstallHint, openInBrowserToInstall, promptInstall, useInstallState } from './install.js';
import { ResizeHandle, useDrawerWidth } from './ResizeHandle.js';
import { setUsageStats, startAnalytics, track, trackView, type TrackEvent, type UsageStatsState } from './analytics.js';
import { PluginsView } from './PluginsView.js';
import { SnapshotsView } from './SnapshotsView.js';
import { blockedBy } from './snapshots.js';
import { useSnapshots, type SnapshotsHook } from './useSnapshots.js';
import { EditViewSection } from './EditViews.js';
import { MeasurementView } from './Measurement.js';
import { galleryAllowed } from './gallery-stories.js';
import { prependedCount, scrollToRow, visibleRows } from './virtual-list.js';
import { isBoolean, isNumberOrNull, isString, isStringOrNull, useUrlState } from './url-state.js';
import { LOREKIT_PUBLISH_TOKEN_KEY, loadLoreKitToken, saveLoreKitToken, useKnowledge } from './useKnowledge.js';
import type { KnowledgeFeed } from './plugins.js';
import {
  HISTORY_MAX,
  LOG_MAX,
  commandsPerMinute,
  deriveSeries,
  formatAgo,
  formatDay,
  formatDuration,
  formatMs,
  formatParams,
  measurementHistory,
  matchesQuery,
  parseQuery,
  termFromSelection,
  SLOW_MS,
  VERY_SLOW_MS,
  speedOf,
  groupByTool,
  hasToolCalls,
  historyTiers,
  inSpan,
  isConnected,
  labelSessions,
  latencyStats,
  liveness,
  mergeLog,
  parseExtStateReply,
  parseHistoryReply,
  parseLogReply,
  parseLongHistoryReply,
  restoreLog,
  sessionHue,
  sessionName,
  settingUrl,
  spanOfBars,
  statusRequestUrl,
  timelineBars,
  clearedBefore,
  outcomeOf,
  type Outcome,
  type BridgeHistory,
  type BridgeSettings,
  type BridgeStatus,
  type CommandEntry,
  type LongHistory,
  type SavedLog,
  type Sample,
  type Series,
  type Session,
  type SettingKey,
  type Span,
  type Speed,
  type Liveness,
  type TimeBar,
  type ToolSort,
  webSocketLevel,
} from './status.js';

const REPO_URL = 'https://github.com/mthines/reaper-mcp';
declare const __VERSION__: string;

const POLL_MS = 500;
/** While hidden (minimized, or covered on macOS), keep pinging ui_seen slowly so the bridge knows we're open. */
const HIDDEN_POLL_MS = 2000;

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
  /** The day and week timeline tiers, polled every 10s */
  longHistory: LongHistory | null;
  /** Whether REAPER's web server answered at all */
  reachable: boolean;
  /** Local clock when status.ts last changed (liveness) */
  lastChangeAt: number;
  log: CommandEntry[];
}

const LONG_HISTORY_POLL_MS = 10_000;
const CLEARED_KEY = 'mcp-bridge-cleared-through';
/** When the viewer last pressed Clear: the timeline hides bars from before it too */
const CLEARED_AT_KEY = 'mcp-bridge-cleared-at';

/** Poll the bridge's ExtState through REAPER's web interface; pauses while the tab is hidden. */
function useBridgeFeed(paused: boolean): Feed & { clearLog: () => void; clearedAt: number } {
  const [feed, setFeed] = useState<Feed>({ status: null, history: null, longHistory: null, reachable: true, lastChangeAt: 0, log: [] });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Highest sequence number cleared by the user. Numbers continue across bridge restarts and the
  // bridge keeps its log, so this is remembered too, or a reload would bring cleared entries back.
  const clearedThroughRef = useRef(Number(load(CLEARED_KEY)) || 0);
  const [clearedAt, setClearedAt] = useState(() => Number(load(CLEARED_AT_KEY)) || 0);
  // The bridge's saved log (ExtState `log`) is requested when the page opens, after a bridge
  // restart, and when the live 50-entry window skipped entries (the page was hidden or paused).
  // Only the answer to the latest request counts, so an older snapshot can't leave a hole.
  const needLogRef = useRef(true);
  const logWantRef = useRef<{ req: number; at: number } | null>(null);

  useEffect(() => {
    const demo = DEMO;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let lastLongPoll = -Infinity;

    const apply = (
      status: BridgeStatus | null,
      history: BridgeHistory | null,
      reachable: boolean,
      longHistory?: LongHistory | null,
      saved?: SavedLog | null,
    ) =>
      setFeed((prev) => {
        const changed = status !== null && status.ts !== prev.status?.ts;
        const restarted = status !== null && prev.status !== null && status.startedAt !== prev.status.startedAt;
        const newest = status?.recent[0]?.n;
        // Numbering went backwards (the bridge's saved files were removed): start over
        const renumbered = newest !== undefined && newest < Math.max(clearedThroughRef.current, restarted ? (prev.log[0]?.n ?? 0) : 0);
        if (renumbered) {
          clearedThroughRef.current = 0;
          save(CLEARED_KEY, '0');
          save(CLEARED_AT_KEY, '0');
          setClearedAt(0);
        }
        const incoming = status ? status.recent.filter((e) => e.n > clearedThroughRef.current) : [];
        let log = renumbered ? [] : prev.log;
        if (saved && !pausedRef.current && saved.req === String(logWantRef.current?.req)) {
          log = restoreLog(log, saved.entries, clearedThroughRef.current);
          needLogRef.current = false;
          logWantRef.current = null;
        }
        if (status && !pausedRef.current) {
          const oldest = incoming[incoming.length - 1]?.n;
          if (restarted || (oldest !== undefined && log.length > 0 && oldest > log[0].n + 1)) needLogRef.current = true;
          log = mergeLog(log, incoming);
        }
        return {
          status,
          history,
          longHistory: longHistory === undefined ? prev.longHistory : longHistory,
          reachable,
          lastChangeAt: changed ? Date.now() : prev.lastChangeAt,
          log,
        };
      });

    const tick = async () => {
      if (demo) {
        if (!document.hidden) {
          const d = demo.tick();
          if (d.log) logWantRef.current = { req: 0, at: 0 };
          apply(d.status, d.history, true, d.longHistory, d.log ? { req: '0', entries: d.log } : undefined);
        }
      } else {
        const now = Date.now();
        const wantLong = now - lastLongPoll >= LONG_HISTORY_POLL_MS;
        // Paused, the log is frozen: ask (again) once resumed
        const wantLog = needLogRef.current && !pausedRef.current;
        // Ask once, then read until the answer arrives; ask again if it hasn't after 5s
        const ask = wantLog && (!logWantRef.current || now - logWantRef.current.at > 5000);
        if (ask) logWantRef.current = { req: now, at: now };
        const extra = [...(wantLong ? ['history_long'] : []), ...(wantLog ? ['log'] : [])];
        try {
          const res = await fetch(statusRequestUrl(now, extra, ask ? now : undefined), { cache: 'no-store' });
          const body = await res.text();
          if (wantLong) lastLongPoll = now;
          apply(
            parseExtStateReply(body),
            parseHistoryReply(body),
            true,
            wantLong ? parseLongHistoryReply(body) : undefined,
            wantLog ? parseLogReply(body) : undefined,
          );
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

  const clearLog = () => {
    const at = Date.now();
    save(CLEARED_AT_KEY, String(at));
    setClearedAt(at);
    setFeed((prev) => {
      clearedThroughRef.current = Math.max(prev.log[0]?.n ?? 0, prev.status?.recent[0]?.n ?? 0);
      save(CLEARED_KEY, String(clearedThroughRef.current));
      return { ...prev, log: [] };
    });
  };

  return { ...feed, clearLog, clearedAt };
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
  cfg_dev: 'dev',
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
  }, [echoed?.paused, echoed?.readonly, echoed?.openOnStart, echoed?.dev]);

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

// A refused request ("Track 9 not found") is a warning, a system error is an error
const ROW_CLASS: Record<Outcome, string> = { ok: '', error: 'row-err', refused: 'row-warn' };
const DOT_CLASS: Record<Outcome, string> = { ok: 'ok', error: 'err', refused: 'warn' };
const OUTCOME_TAG: Record<Outcome, string> = { ok: 'ok ', error: 'ERR', refused: 'WRN' };
const BADGE: Record<Outcome, { className: string; label: string }> = {
  ok: { className: 'result-ok', label: 'Success' },
  error: { className: 'result-err', label: 'Error' },
  refused: { className: 'result-warn', label: 'Refused' },
};

/** Desktop notification per failed command while enabled (a per-viewer choice, kept in localStorage). */
function useErrorNotifications(log: CommandEntry[], sessions: Map<string, Session>) {
  const [enabled, setEnabled] = useState(() => load(NOTIFY_KEY) === '1' && notificationPermission() === 'granted');
  const notifiedThrough = useRef(log[0]?.n ?? 0);

  useEffect(() => {
    const newest = log[0]?.n ?? 0;
    if (enabled) {
      // Refused requests are expected (a warning), so only system errors reach the desktop
      const fresh = log.filter((e) => e.n > notifiedThrough.current && outcomeOf(e) === 'error');
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
  const { status, history, longHistory, reachable, lastChangeAt, log, clearLog, clearedAt } = useBridgeFeed(paused);
  // A span picked on the timeline filters the log views; the timeline's range stays as it is
  const [selection, setSelection] = useUrlState<Span | null>('span', null, { validate: isSpanOrNull });
  const shownLog = useMemo(() => inSpan(log, selection), [log, selection]);
  const now = useNow(1000);
  // The timeline's range also windows the log; a selected span replaces it
  // In the URL (`?range="1h"`) so Back/Forward step through ranges; a link without it opens the last one picked
  const [openedRange] = useState<RangeKey>(loadRange);
  const [rangeKey, setRangeKey] = useUrlState<RangeKey>('range', openedRange, { validate: isRangeKey });
  const chooseRange = (key: RangeKey) => {
    if (key === rangeKey) return;
    track({ name: 'timeline_range_changed', range: key });
    setRangeKey(key);
    save(RANGE_STORAGE_KEY, key);
    setSelection(null); // a selection is a span of the old range's bars
  };
  const state: Liveness = liveness(status, lastChangeAt, now);
  const samples = useHistory(status, now);
  const series = useMemo(() => deriveSeries(samples, log), [samples, log]);
  const sessions = useMemo(() => new Map(labelSessions(status?.sessions ?? []).map((x) => [x.id, x])), [status?.sessions]);
  const [openedView] = useState<View>(loadView);
  const [view, setView] = useUrlState<View>('view', openedView, { validate: isView });
  const chooseView = (v: View) => {
    if (v !== view) trackView(v);
    setView(v);
    save(VIEW_KEY, v);
  };
  const [settings, setSetting] = useSettings(status);
  const changeSetting = (source: 'settings' | 'notice') => (key: SettingKey, on: boolean) => {
    track({ name: 'setting_changed', setting: SETTING_NAME[key], enabled: on, source });
    setSetting(key, on);
  };
  const [notify, setNotifyState] = useErrorNotifications(log, sessions);
  const setNotify = (on: boolean) => {
    track({ name: 'setting_changed', setting: 'error_notifications', enabled: on, source: 'settings' });
    setNotifyState(on);
  };
  const [usageStats, setUsageStatsState] = useState<UsageStatsState>(() => startAnalytics(Boolean(DEMO), view));
  const chooseUsageStats = (on: boolean) => setUsageStatsState(setUsageStats(on, Boolean(DEMO)));
  // `?install`: opened from the bridge window's Install button, so show the install setting straight away
  const request = useBridgeRequest(status);
  const [settingsOpen, setSettingsOpen] = useUrlState('settings', false, { validate: isBoolean });
  useEffect(() => {
    if (new URLSearchParams(location.search).has('install')) setSettingsOpen(true, 'replace');
  }, [setSettingsOpen]);
  const [loreToken, setLoreToken] = useState(() => loadLoreKitToken());
  const chooseLoreToken = (token: string | null) => {
    track({ name: 'lorekit_token_changed', kind: 'read', connected: token !== null });
    setLoreToken(token);
    saveLoreKitToken(token);
  };
  const [publishToken, setPublishToken] = useState(() => loadLoreKitToken(LOREKIT_PUBLISH_TOKEN_KEY));
  const choosePublishToken = (token: string | null) => {
    track({ name: 'lorekit_token_changed', kind: 'publish', connected: token !== null });
    setPublishToken(token);
    saveLoreKitToken(token, LOREKIT_PUBLISH_TOKEN_KEY);
  };
  const liveKnowledge = useKnowledge(!DEMO, loreToken, publishToken);
  // The Snapshots tab: only a bridge that serves it (control.snapshots), read only while the view is open
  const snapshotsServed = Boolean(DEMO) || status?.control?.snapshots === true;
  const snapshots = useSnapshots(snapshotsServed && view === 'snapshots', status?.control?.token, Boolean(DEMO));

  useEffect(() => {
    document.title = `${state === 'live' ? '●' : '○'} MCP Bridge`;
  }, [state]);
  // The bridge as viewers see it: going stale or offline while the page is open. Only after it has been
  // live once, so the page starting up (offline until the first status arrives) isn't counted.
  const lastState = useRef<Liveness | null>(null);
  useEffect(() => {
    if (lastState.current === null) {
      if (state === 'live') lastState.current = state;
      return;
    }
    if (lastState.current !== state) track({ name: 'bridge_state_changed', state });
    lastState.current = state;
  }, [state]);
  const openSettings = (toggle: boolean) => () => {
    const next = toggle ? !settingsOpen : true;
    if (next && !settingsOpen) track({ name: 'settings_opened' });
    setSettingsOpen(next);
  };

  return (
    <div className="shell">
      <Header
        status={status}
        state={state}
        reachable={reachable}
        now={now}
        sessions={sessions}
        onShowAgents={() => chooseView('sessions')}
        onOpenSettings={settings ? openSettings(true) : undefined}
        onRebuild={
          settings?.dev && status?.control?.canUpdate && status.control.changed && status.control.update?.state !== 'running'
            ? () => request('rebuild')
            : undefined
        }
      />
      {status ? (
        <>
          <Notices status={status} settings={settings} onSet={changeSetting('notice')} request={request} />
          <Stats status={status} log={log} now={now} series={series} />
          <Timeline
            history={history}
            longHistory={longHistory}
            now={now}
            rangeKey={rangeKey}
            onRange={chooseRange}
            selection={selection}
            onSelect={setSelection}
            clearedAt={clearedAt}
          />
          <Log
            log={shownLog}
            selection={selection}
            rangeKey={selection ? null : rangeKey}
            onRange={chooseRange}
            oldestKept={log[log.length - 1]?.t ?? null}
            onClearSelection={() => setSelection(null)}
            sessions={sessions}
            knowledge={DEMO ? status.knowledge : liveKnowledge}
            snapshots={snapshotsServed ? { ...snapshots, blocked: blockedBy(settings) } : undefined}
            onOpenSettings={settings ? openSettings(false) : undefined}
            view={view}
            onView={chooseView}
            paused={paused}
            onTogglePause={() => {
              track({ name: 'log_paused', paused: !paused });
              setPaused(!paused);
            }}
            onClear={clearLog}
            now={now}
          />
          {settingsOpen && settings && (
            <SettingsPanel
              settings={settings}
              onSet={changeSetting('settings')}
              notify={notify}
              onNotify={setNotify}
              usageStats={usageStats}
              onUsageStats={chooseUsageStats}
              loreToken={loreToken}
              onLoreToken={chooseLoreToken}
              publishToken={publishToken}
              onPublishToken={choosePublishToken}
              onClose={() => setSettingsOpen(false)}
              canUpdate={status.control?.canUpdate === true}
              onRestart={status.control?.canRestart ? () => request('restart') : undefined}
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
              <span className="dot-sep" />
              <a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a>
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
  sessions,
  onShowAgents,
  onOpenSettings,
  onRebuild,
}: {
  status: BridgeStatus | null;
  state: Liveness;
  reachable: boolean;
  now: number;
  sessions: Map<string, Session>;
  onShowAgents: () => void;
  onOpenSettings?: () => void;
  onRebuild?: () => void;
}) {
  const label = state === 'live' ? 'Live' : state === 'stale' ? 'Not responding' : reachable ? 'Bridge stopped' : 'REAPER unreachable';
  const connected = [...sessions.values()].filter((x) => isConnected(x, now) && hasToolCalls(x));
  return (
    <header className="header">
      <div className="brand">
        <Mark
          active={state === 'live'}
          onShiftClick={galleryAllowed('?gallery', location.protocol, status?.settings?.dev) ? () => location.assign(`${location.pathname}?gallery`) : undefined}
        />
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
            className="btn btn-sm"
            onClick={onRebuild}
            title="Developer mode: your working tree changed since the last install. Build it, install it into REAPER, restart the bridge and reload"
          >
            Rebuild &amp; reload
          </button>
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
  request,
}: {
  status: BridgeStatus;
  settings: BridgeSettings | null;
  onSet: (key: SettingKey, on: boolean) => void;
  request: BridgeRequest;
}) {
  const [swsDismissed, setSwsDismissed] = useState(() => load(SWS_DISMISS_KEY) === '1');
  const [skipped, setSkipped] = useState(() => load(UPDATE_SKIP_KEY));
  const [updateDoneDismissed, setUpdateDoneDismissed] = useState(false);
  const health = status.health;
  const control = status.control;
  const update = control?.update;
  const dev = settings?.dev === true;
  const rebuild = update?.kind === 'rebuild';
  const release = useLatestRelease(!DEMO && !dev);
  const notices: ReactNode[] = [];

  if (update?.state === 'done' && !updateDoneDismissed) {
    notices.push(
      <Notice
        key="update"
        tone="info"
        action={
          <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => setUpdateDoneDismissed(true)}>
            <CloseIcon />
          </button>
        }
      >
        <b>{rebuild ? 'Rebuilt from your working tree' : `reaper-mcp is up to date (v${__VERSION__})`}.</b> Restart Claude Code, or run{' '}
        <code>/mcp</code> there, to use the new tools.
      </Notice>,
    );
  } else if (update?.state === 'running') {
    const log = updateLog(update);
    notices.push(
      <Notice key="update" tone="info">
        <b>{rebuild ? 'Rebuilding from your working tree…' : 'Updating reaper-mcp…'}</b>{' '}
        {rebuild ? 'The bridge restarts and this page reloads when it’s done.' : 'This takes a minute or two; the bridge restarts when it’s done.'}
        {log.length > 0 && <span className="notice-log mono">{log[log.length - 1]}</span>}
      </Notice>,
    );
  } else if (update?.state === 'failed') {
    const log = updateLog(update);
    notices.push(
      <Notice key="update" tone="bad" action={<button className="btn btn-sm" onClick={() => request(rebuild ? 'rebuild' : 'update')}>Try again</button>}>
        <b>{rebuild ? 'The rebuild didn’t finish.' : 'The update didn’t finish.'}</b> {log[log.length - 1] ?? 'See tmp/install.log in your reaper-mcp folder.'}
        {log.length > 1 && (
          <details className="notice-details">
            <summary>Show log</summary>
            <pre className="mono">{log.join('\n')}</pre>
          </details>
        )}
      </Notice>,
    );
  } else if (!dev && release && compareVersions(release.version, __VERSION__) > 0 && skipped !== release.version) {
    notices.push(
      <Notice
        key="update"
        tone="info"
        action={
          <span className="notice-actions">
            {control?.canUpdate && (
              <button className="btn btn-sm" onClick={() => request('update')}>
                Update
              </button>
            )}
            <button
              className="icon-btn"
              aria-label="Skip this version"
              title="Skip this version"
              onClick={() => { setSkipped(release.version); save(UPDATE_SKIP_KEY, release.version); }}
            >
              <CloseIcon />
            </button>
          </span>
        }
      >
        <b>reaper-mcp v{release.version} is available</b> (you have v{__VERSION__}).{' '}
        <a href={release.url} target="_blank" rel="noreferrer">What’s new</a>
        {!control?.canUpdate && (
          <>
            {' '}· Update from your reaper-mcp folder: <code>git pull &amp;&amp; ./scripts/install.sh</code>
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

const UPDATE_SKIP_KEY = 'mcp-bridge-update-skipped';

type BridgeRequest = (action: BridgeAction) => void;

/**
 * Send an update/restart request to the bridge, and reload the page once the bridge comes back as a new
 * run (its startedAt changes): the installer may have replaced this page too.
 */
function useBridgeRequest(status: BridgeStatus | null): BridgeRequest {
  const expectRestart = useRef(false);
  const startedAt = useRef(status?.startedAt);
  if (status?.control?.update) expectRestart.current = true;
  useEffect(() => {
    if (!status || status.startedAt === startedAt.current) return;
    const restarted = startedAt.current !== undefined;
    startedAt.current = status.startedAt;
    if (restarted && expectRestart.current) location.reload();
  }, [status?.startedAt]);
  // An update that left the bridge script as it was doesn't restart it, but the installer still replaced this page
  const update = status?.control?.update;
  useEffect(() => {
    if (update?.state !== 'done' || DEMO) return;
    const key = `mcp-bridge-reloaded-${update.startedAt}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return; // no way to remember the reload: never risk a reload loop
    }
    location.reload();
  }, [update?.state, update?.startedAt]);
  return (action) => {
    const token = status?.control?.token;
    if (!token || DEMO) return;
    expectRestart.current = true;
    fetch(controlUrl(action, token), { cache: 'no-store' }).catch(() => {
      /* the bridge's status shows whether it took */
    });
  };
}

export function Notice({ tone, action, children }: { tone: 'warn' | 'bad' | 'info'; action?: ReactNode; children: ReactNode }) {
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
  usageStats,
  onUsageStats,
  loreToken,
  onLoreToken,
  publishToken,
  onPublishToken,
  onClose,
  canUpdate,
  onRestart,
}: {
  settings: BridgeSettings;
  onSet: (key: SettingKey, on: boolean) => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
  usageStats: UsageStatsState;
  onUsageStats: (on: boolean) => void;
  loreToken: string | null;
  onLoreToken: (token: string | null) => void;
  publishToken: string | null;
  onPublishToken: (token: string | null) => void;
  onClose: () => void;
  canUpdate: boolean;
  /** Absent when the bridge can't relaunch itself (REAPER before 7.03, or the script has no action ID). */
  onRestart?: () => void;
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
          <InstallSetting />
        </div>
        <div className="setting-group">
          <h3>Bridge</h3>
          <div className="install-row">
            <div className="install-text">
              <div className="toggle-label">Restart bridge</div>
              <div className="toggle-hint">
                {onRestart ? (
                  'Stop mcp_bridge.lua and start it again, loading the installed copy.'
                ) : (
                  <>This REAPER can’t restart the bridge for you. Stop <code>mcp_bridge.lua</code> in the Actions list and run it again.</>
                )}
              </div>
            </div>
            {onRestart && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  track({ name: 'bridge_restart_clicked', source: 'settings' });
                  onRestart();
                }}
              >
                Restart
              </button>
            )}
          </div>
        </div>
        {canUpdate && (
          <div className="setting-group">
            <h3>Updates</h3>
            <Toggle
              label="Developer mode"
              hint="Rebuild & reload builds your working tree as it is, uncommitted changes included, instead of offering release updates. Detected from your clone until you choose. Persists."
              on={settings.dev === true}
              onChange={(on) => onSet('cfg_dev', on)}
            />
          </div>
        )}
        <LoreKitSetting token={loreToken} onChange={onLoreToken} />
        <PublishSetting token={publishToken} readToken={loreToken} onChange={onPublishToken} />
        <div className="setting-group">
          <h3>Privacy</h3>
          <Toggle
            label="Share usage statistics"
            hint={usageStatsHint(usageStats)}
            on={usageStats.on}
            disabled={!usageStats.on && usageStats.reason !== 'user'}
            onChange={onUsageStats}
          />
        </div>
      </div>
    </aside>
  );
}

/** Install the page as a desktop app (it ships a manifest and service worker). */
function usageStatsHint(state: UsageStatsState): string {
  if (state.on) return 'Sends which views and buttons you use, pseudonymously, so this page can get better. Never plugin, track or project names, searches or tokens. Turning it off stops events at once and everything else from the next page load.';
  if (state.reason === 'browser') return 'Off: your browser asks sites not to track you (Global Privacy Control / Do Not Track).';
  if (state.reason === 'demo') return 'Off in the demo.';
  if (state.reason === 'unconfigured') return 'This build has no usage statistics destination.';
  return 'Off. Turn it on to help improve this page: it sends which views and buttons you use, never names, searches or tokens.';
}

const SETTING_NAME: Record<SettingKey, Extract<TrackEvent, { name: 'setting_changed' }>['setting']> = {
  cfg_paused: 'paused',
  cfg_readonly: 'readonly',
  cfg_open_on_start: 'open_on_start',
  cfg_dev: 'dev',
};

function InstallSetting() {
  const state = useInstallState();
  const [showSteps, setShowSteps] = useState(false);
  const onInstall = () => {
    track({ name: 'app_install_clicked', state });
    if (state === 'available') void promptInstall();
    else if (state === 'window') openInBrowserToInstall();
    else setShowSteps(true); // no prompt from the browser (Safari, Firefox, or already installed): say where it is
  };
  return (
    <div className="install-row">
      <div className="install-text">
        <div className="toggle-label">Desktop app</div>
        <div className="toggle-hint">
          {state === 'installed'
            ? 'Running as the installed app.'
            : state === 'window'
              ? 'This is the bridge’s browser window. Install opens the page in a browser tab, where you can install it as an app.'
              : showSteps
                ? manualInstallHint(navigator.userAgent)
                : 'Install this page as an app with its own Dock / taskbar icon and window.'}
        </div>
      </div>
      {state === 'installed' ? (
        <span className="install-done">
          <i className="kdot cov-learned" /> Installed
        </span>
      ) : (
        <button className="btn btn-sm" onClick={onInstall}>
          Install app
        </button>
      )}
    </div>
  );
}

const LOREKIT_KEYS_URL = 'https://www.lorekit.io/settings/api-keys';

/** The viewer's own read-only LoreKit token, so the Plugins tab includes their `user::` records. */
function LoreKitSetting({ token, onChange }: { token: string | null; onChange: (token: string | null) => void }) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const invalid = trimmed !== '' && !/^lk_ro_[A-Za-z0-9]+$/.test(trimmed);
  return (
    <div className="setting-group">
      <h3>Your plugin knowledge</h3>
      {token ? (
        <div className="lore-connected">
          <span>
            <i className="kdot cov-learned" /> LoreKit connected <span className="mono muted">{token.slice(0, 10)}…</span>
          </span>
          <button className="btn btn-sm" onClick={() => onChange(null)}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
        <ol className="lore-steps">
          <li>
            <a className="btn btn-sm lore-open" href={LOREKIT_KEYS_URL} target="_blank" rel="noreferrer">
              Open LoreKit API keys ↗
            </a>
            <span>Sign in or create a free account</span>
          </li>
          <li>
            Create a key with <b>read-only</b> access and copy it (it starts with <span className="mono">lk_ro_</span>)
          </li>
          <li>Paste it here and connect</li>
        </ol>
        <form
          className="lore-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (trimmed && !invalid) {
              onChange(trimmed);
              setDraft('');
            }
          }}
        >
          <input
            className="lore-input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="lk_ro_…"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            aria-label="LoreKit read-only token"
            aria-invalid={invalid}
          />
          <button className="btn btn-sm" type="submit" disabled={!trimmed || invalid}>
            Connect
          </button>
        </form>
        </>
      )}
      <p className="setting-hint">
        {invalid
          ? 'That isn’t a read-only token. Use one that starts with lk_ro_ here; a write token only goes under Publish to built-in.'
          : token
            ? 'The Plugins tab includes the plugins you taught the mixer. The token stays in this browser and is only sent to LoreKit.'
            : 'The Plugins tab always shows the built-in records. Your token adds the plugins you taught the mixer; it stays in this browser and is only sent to LoreKit.'}
      </p>
    </div>
  );
}

/**
 * Members of the reaper-mcp LoreKit org publish their records into the built-in layer straight from the
 * plugin drawer, without the GitHub contribution PR. LoreKit checks the membership on every write.
 */
const DISCORD_URL = 'https://discord.gg/Eg8tznuXp4';
/** A GitHub issue form asking to join the reaper-mcp LoreKit org (.github/ISSUE_TEMPLATE/contributor-request.yml). */
const CONTRIBUTOR_REQUEST_URL = `${REPO_URL}/issues/new?template=contributor-request.yml`;

function PublishSetting({ token, readToken, onChange }: { token: string | null; readToken: string | null; onChange: (token: string | null) => void }) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const invalid = trimmed !== '' && !/^lk_rw_[A-Za-z0-9]+$/.test(trimmed);
  return (
    <div className="setting-group">
      <h3>Publish to built-in</h3>
      {token ? (
        <div className="lore-connected">
          <span>
            <i className="kdot cov-built-in" /> Publishing enabled <span className="mono muted">{token.slice(0, 10)}…</span>
          </span>
          <button className="btn btn-sm" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      ) : (
        <form
          className="lore-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (trimmed && !invalid) {
              onChange(trimmed);
              setDraft('');
            }
          }}
        >
          <input
            className="lore-input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="lk_rw_…"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            aria-label="LoreKit read + write token for publishing"
            aria-invalid={invalid}
          />
          <button className="btn btn-sm" type="submit" disabled={!trimmed || invalid}>
            Enable
          </button>
        </form>
      )}
      <p className="setting-hint">
        {invalid
          ? 'Publishing needs a read + write token, starting with lk_rw_.'
          : token
            ? readToken
              ? 'Your records get a Publish to built-in button. LoreKit only accepts it while you’re a member of the reaper-mcp org.'
              : 'Connect your read-only token above too, so your records (and their Publish button) show up.'
            : 'For members of the reaper-mcp LoreKit org: publish your records for everyone without a GitHub pull request. Create a read + write key limited to project::reaper-mcp and the reaper-mcp org. Everyone else uses Contribute.'}
      </p>
      {!token && (
        <p className="setting-hint">
          Not a member yet? Ask to become a contributor{' '}
          <a className="setting-link" href={DISCORD_URL} target="_blank" rel="noreferrer">
            on Discord ↗
          </a>{' '}
          or{' '}
          <a className="setting-link" href={CONTRIBUTOR_REQUEST_URL} target="_blank" rel="noreferrer">
            on GitHub ↗
          </a>
        </p>
      )}
    </div>
  );
}

export function Toggle({
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

// How far (in the 512 logo grid) the eye may look toward the cursor while watching.
const EYE_REACH_X = 24;
const EYE_REACH_Y = 18;
// Pointer updates while watching: at most one per this many ms (leading + trailing).
const EYE_THROTTLE_MS = 60;

// The reaper-mcp logo (docs/assets/logo-mark.svg); the dot is an eye that blinks while the bridge is live.
// Easter egg: clicking blinks and toggles "watching", where the eye follows the cursor across the window.
/** `onShiftClick` (developer mode): shift-click opens the component gallery instead of blinking */
export function Mark({ active, onShiftClick }: { active: boolean; onShiftClick?: () => void }) {
  const [watching, setWatching] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blinks, setBlinks] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const blinkTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(blinkTimer.current), []);

  useEffect(() => {
    if (!watching) {
      setLook({ x: 0, y: 0 });
      return;
    }
    let last = 0;
    let timer = 0;
    let pending: PointerEvent | null = null;
    const apply = (e: PointerEvent) => {
      last = performance.now();
      setLook({ x: (e.clientX / window.innerWidth - 0.5) * 2, y: (e.clientY / window.innerHeight - 0.5) * 2 });
    };
    const onMove = (e: PointerEvent) => {
      const wait = EYE_THROTTLE_MS - (performance.now() - last);
      if (wait <= 0) {
        apply(e);
        return;
      }
      pending = e; // trailing call lands on the latest position
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          if (pending) apply(pending);
        }, wait);
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
    };
  }, [watching]);

  const onClick = (ev: MouseEvent<HTMLButtonElement>) => {
    if (ev.shiftKey && onShiftClick) return onShiftClick();
    setWatching((w) => !w);
    setBlinks((n) => n + 1); // remounts the lid so back-to-back clicks each blink
    setBlinking(true);
    window.clearTimeout(blinkTimer.current);
    blinkTimer.current = window.setTimeout(() => setBlinking(false), 260);
  };

  return (
    <button className="mark-btn" onClick={onClick} aria-label="reaper-mcp" aria-pressed={watching}>
      <svg className={`mark ${active ? 'mark-active' : ''} ${blinking ? 'mark-blink' : ''}`} viewBox="0 0 512 512" aria-hidden>
        <defs>
          <linearGradient id="mark-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1b1532" />
            <stop offset="0.6" stopColor="#0e0b18" />
            <stop offset="1" stopColor="#220d22" />
          </linearGradient>
          <radialGradient id="mark-glow" cx="0.5" cy="0.66" r="0.42">
            <stop offset="0" stopColor="#ff6a4d" stopOpacity="0.16" />
            <stop offset="1" stopColor="#ff6a4d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mark-dot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffa24c" />
            <stop offset="1" stopColor="#ff4f5e" />
          </linearGradient>
          <clipPath id="mark-eye">
            <circle cx="256" cy="318" r="58" />
          </clipPath>
        </defs>
        <rect width="512" height="512" rx="116" fill="url(#mark-bg)" />
        <rect className="mark-glow" width="512" height="512" rx="116" fill="url(#mark-glow)" />
        <rect x="4" y="4" width="504" height="504" rx="112" fill="none" stroke="#fff" strokeOpacity="0.08" strokeWidth="8" />
        <path className="mark-arc" d="M100 330 A156 156 0 0 1 412 330" fill="none" strokeWidth="56" strokeLinecap="round" />
        <g className="mark-eye" style={{ transform: `translate(${look.x * EYE_REACH_X}px, ${look.y * EYE_REACH_Y}px)` }}>
          <circle className="mark-dot" cx="256" cy="318" r="58" />
          {/* Eyelid: parked just above the dot, drops over it on a blink */}
          <g clipPath="url(#mark-eye)">
            {/* Outer group: where the lid rests (half-closed on hover); inner ellipse: the blinks */}
            <g className="mark-lid-rest">
              <ellipse key={blinks} className="mark-lid" cx="256" cy="180" rx="74" ry="80" fill="#130f1f" />
            </g>
          </g>
        </g>
      </svg>
    </button>
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

const TOOL_TONE: Record<Speed, string> = { fast: '', slow: 'tone-warn', 'very-slow': 'tone-bad', long: '' };
const SPEED_LABEL: Record<Speed, string> = { fast: 'Fast', slow: 'Slow', 'very-slow': 'Very slow', long: 'Long-running (expected)' };

/** Log-scaled so 1 ms and 500 ms both read. */
const latencyScale = (ms: number) => Math.min(1, Math.max(0.06, Math.log10(1 + ms) / Math.log10(1 + VERY_SLOW_MS)));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RANGES = [
  { key: '5m', label: 'Last 5 minutes', ms: 5 * MINUTE, bars: 30 },
  { key: '10m', label: 'Last 10 minutes', ms: 10 * MINUTE, bars: 60 },
  { key: '30m', label: 'Last 30 minutes', ms: 30 * MINUTE, bars: 60 },
  { key: '1h', label: 'Last hour', ms: HOUR, bars: 60 },
  { key: '6h', label: 'Last 6 hours', ms: 6 * HOUR, bars: 72 },
  { key: '24h', label: 'Last 24 hours', ms: DAY, bars: 96 },
  { key: '7d', label: 'Last 7 days', ms: 7 * DAY, bars: 168 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];
const RANGE_STORAGE_KEY = 'mcp-bridge-range';

/** "10 s", "5 min", "1 h": one bar's width, for the option hints and the header */
function barWidth(ms: number): string {
  if (ms < MINUTE) return `${ms / 1000} s`;
  if (ms < HOUR) return `${ms / MINUTE} min`;
  return `${ms / HOUR} h`;
}

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.key, label: r.label, hint: `${barWidth(r.ms / r.bars)} per bar` }));

const rangeOf = (key: RangeKey) => RANGES.find((r) => r.key === key) ?? RANGES[2];

const isRangeKey = (v: unknown): v is RangeKey => RANGES.some((r) => r.key === v);

function loadRange(): RangeKey {
  const saved = load(RANGE_STORAGE_KEY);
  return isRangeKey(saved) ? saved : '30m';
}

/** Round up to a readable, even axis maximum with ~10% headroom, at least 4. */
function niceMax(v: number): number {
  const target = Math.max(4, v * 1.1);
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((n) => n >= target) ?? target;
}

const clock = (t: number, seconds = false) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });

/** Clock time within a day, weekday + time beyond it */
const stamp = (t: number, rangeMs: number, seconds = false) =>
  rangeMs > DAY ? `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${clock(t)}` : clock(t, seconds);

/** "Mon 14:02 – Mon 15:00", with the weekday only when the span leaves today */
function spanLabel(span: Span): string {
  const today = new Date().toDateString();
  const fmt = (t: number) => (new Date(t).toDateString() === today ? clock(t) : `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${clock(t)}`);
  return `${fmt(span.start)} – ${fmt(span.end)}`;
}

/** Which bar the pointer is over, clamped to the plot */
function barAt(plot: HTMLElement, clientX: number, count: number): number {
  const r = plot.getBoundingClientRect();
  return Math.min(count - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * count)));
}

/**
 * Commands per time slot over a fixed window (stacked ok / slow / error). Drag across bars (or
 * click one) to select a span: the log below filters to it, and the range stays as it is.
 * Without a span, the log shows the range.
 */
function Timeline({
  history,
  longHistory,
  now,
  rangeKey,
  onRange,
  selection,
  onSelect,
  clearedAt,
}: {
  history: BridgeHistory | null;
  longHistory: LongHistory | null;
  now: number;
  rangeKey: RangeKey;
  onRange: (key: RangeKey) => void;
  selection: Span | null;
  onSelect: (span: Span | null) => void;
  /** Bars that ended before the viewer's last Clear are drawn empty */
  clearedAt: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const range = rangeOf(rangeKey);
  const tiers = useMemo(() => historyTiers(history, longHistory), [history, longHistory]);
  const bars = useMemo(() => clearedBefore(timelineBars(tiers, range.ms, range.bars, now), clearedAt), [tiers, range, now, clearedAt]);
  const peak = Math.max(0, ...bars.map((b) => b.total));
  const yMax = niceMax(peak);
  const total = bars.reduce((sum, b) => sum + b.total, 0);
  const barMs = range.ms / range.bars;

  // While dragging, the drag is the selection; otherwise bars inside the selected span
  const picked = drag ? spanOfBars(bars, drag.from, drag.to) : selection;
  const isPicked = (b: TimeBar) => picked !== null && b.start >= picked.start && b.end <= picked.end;
  const pickedTotal = picked ? bars.filter(isPicked).reduce((sum, b) => sum + b.total, 0) : 0;

  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const i = barAt(ev.currentTarget, ev.clientX, bars.length);
    setDrag({ from: i, to: i });
  };
  const onPointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const i = barAt(ev.currentTarget, ev.clientX, bars.length);
    setHover(i);
    if (drag && i !== drag.to) setDrag({ ...drag, to: i });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const span = spanOfBars(bars, drag.from, drag.to);
    setDrag(null);
    // Clicking the one selected bar again clears the selection
    const next = selection && selection.start === span.start && selection.end === span.end ? null : span;
    track({ name: 'timeline_span_selected', selected: next !== null });
    onSelect(next);
  };

  const hb: TimeBar | undefined = hover === null || drag ? undefined : bars[hover];
  const leftPct = hover === null ? 0 : ((hover + 0.5) / bars.length) * 100;
  const tipAlign = leftPct < 15 ? 'start' : leftPct > 85 ? 'end' : 'center';

  return (
    <section className="timeline" aria-label="Commands over time">
      <div className="timeline-head">
        <span className="timeline-title">
          Commands{' '}
          <span className="timeline-sub">
            {total.toLocaleString()} in the {range.label.toLowerCase()} · {barWidth(barMs)} per bar
          </span>
        </span>
        <div className="timeline-controls">
          <span className="legend">
            <i className="lg lg-ok" /> ok
            <i className="lg lg-slow" /> ≥ {SLOW_MS} ms
            <i className="lg lg-err" /> error
          </span>
          <Combobox label="Time range" value={rangeKey} options={RANGE_OPTIONS} onChange={onRange} />
        </div>
      </div>
      <div className="timeline-chart">
        <div className="y-axis" aria-hidden>
          <span>{yMax}</span>
          <span>{yMax / 2}</span>
          <span>0</span>
        </div>
        <div
          className={`plot ${picked ? 'plot-picking' : ''} ${bars.length > 100 ? 'plot-dense' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onMouseLeave={() => setHover(null)}
          title="Drag to select a span; the log shows only its commands"
        >
          <div className="grid" aria-hidden />
          {bars.map((b, i) => {
            const ok = Math.max(0, b.total - b.errors - b.slow);
            return (
              <div key={b.start} className={`tbar ${hover === i && !drag ? 'tbar-hover' : ''} ${isPicked(b) ? 'tbar-picked' : ''}`}>
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
                {stamp(hb.start, range.ms, barMs < MINUTE)}–{clock(hb.end, barMs < MINUTE)}
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
        {picked ? (
          <span className="x-picked">
            {stamp(picked.start, range.ms)}–{stamp(picked.end, range.ms)} · {pickedTotal.toLocaleString()} command{pickedTotal === 1 ? '' : 's'}
          </span>
        ) : (
          <span>{stamp(now - range.ms / 2, range.ms)}</span>
        )}
        <span>now</span>
      </div>
    </section>
  );
}

type Filter = 'all' | 'errors';
type View = 'calls' | 'tools' | 'sessions' | 'plugins' | 'snapshots';
const VIEW_KEY = 'mcp-bridge-view';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'calls', label: 'Calls' },
  { key: 'tools', label: 'Tools' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'plugins', label: 'Plugins' },
  { key: 'snapshots', label: 'Snapshots' },
];

const isView = (v: unknown): v is View => VIEWS.some((x) => x.key === v);
const isFilter = (v: unknown): v is Filter => v === 'all' || v === 'errors';
const isSpanOrNull = (v: unknown): v is Span | null =>
  v === null || (typeof v === 'object' && typeof (v as Span).start === 'number' && typeof (v as Span).end === 'number');

function loadView(): View {
  const saved = load(VIEW_KEY);
  return isView(saved) ? saved : 'calls';
}

function Log({
  log,
  selection,
  rangeKey,
  onRange,
  oldestKept,
  onClearSelection,
  sessions,
  knowledge,
  snapshots,
  view,
  onView,
  paused,
  onTogglePause,
  onClear,
  now,
  onOpenSettings,
}: {
  log: CommandEntry[];
  /** The timeline span the log is filtered to, if any */
  selection: Span | null;
  /** The timeline range the calls and tools views are windowed to; null while a span is selected */
  rangeKey: RangeKey | null;
  onRange: (key: RangeKey) => void;
  /** Time of the oldest entry the page holds, before the selection filter */
  oldestKept: number | null;
  onClearSelection: () => void;
  sessions: Map<string, Session>;
  knowledge?: KnowledgeFeed;
  /** The Snapshots tab's feed, when the bridge serves it; `blocked` says why restore and save are off */
  snapshots?: SnapshotsHook & { blocked: string | null };
  onOpenSettings?: () => void;
  view: View;
  onView: (v: View) => void;
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  now: number;
}) {
  const [filter, setFilter] = useUrlState<Filter>('filter', 'all', { validate: isFilter });
  // Typing replaces the history entry instead of adding one per keystroke
  const [query, setQuery] = useUrlState('q', '', { validate: isString, navigationMode: 'replace' });
  const [sessionFilter, setSessionFilter] = useUrlState<string | null>('agent', null, { validate: isStringOrNull });
  // The open command, by sequence number: it opens once the log holds it (also after a reload)
  const [selectedN, setSelectedN] = useUrlState<number | null>('entry', null, { validate: isNumberOrNull });
  const selected = useMemo(() => (selectedN === null ? null : (log.find((e) => e.n === selectedN) ?? null)), [log, selectedN]);
  const setSelected = useCallback(
    (e: CommandEntry | null, mode?: 'push' | 'replace') => setSelectedN(e ? e.n : null, mode),
    [setSelectedN],
  );
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const choose = (v: View) => {
    onView(v);
    if (v !== 'calls') setSelected(null);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === '/' && document.activeElement !== searchRef.current) {
        ev.preventDefault();
        searchRef.current?.focus();
      } else if (ev.key === 'Escape') {
        // Close the details sidebar first, then clear the chart selection, then the filter
        if (selectedRef.current) setSelected(null);
        else if (!clearChartSelection.current()) {
          setQuery('');
          searchRef.current?.blur();
        }
      } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && selectedRef.current) {
        ev.preventDefault();
        const list = rowsRef.current;
        const i = list.findIndex((e) => e.n === selectedRef.current?.n);
        const next = list[i + (ev.key === 'ArrowDown' ? 1 : -1)];
        if (next) setSelected(next, 'replace'); // stepping through rows doesn't add history
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sessions seen in this window's log, plus any the bridge knows about
  const sessionIds = useMemo(() => {
    // Agents that have only pinged are left out: no calls to filter by
    const ids = new Set([...sessions.values()].filter(hasToolCalls).map((x) => x.id));
    for (const e of log) if (e.s) ids.add(e.s);
    // Oldest first, so chips don't reshuffle as agents take turns
    const first = (id: string) => sessions.get(id)?.first ?? Infinity;
    return [...ids].sort((a, b) => first(a) - first(b));
  }, [log, sessions]);
  const multiSession = sessionIds.length > 1;
  const sessionOf = (id: string): Session => sessions.get(id) ?? { id, first: 0, last: 0, commands: 0, errors: 0 };

  const range = rangeKey ? rangeOf(rangeKey) : null;
  const since = range ? now - range.ms : null;
  const windowed = useMemo(() => (since === null ? log : log.filter((e) => e.t >= since)), [log, since]);
  const scoped = useMemo(() => (sessionFilter ? windowed.filter((e) => e.s === sessionFilter) : windowed), [windowed, sessionFilter]);
  const errorCount = useMemo(() => scoped.filter((e) => outcomeOf(e) === 'error').length, [scoped]);
  // Every match the page holds, then the ones inside the range: the rest are offered at the end of the list
  const matches = useMemo(() => {
    const terms = parseQuery(query);
    return log.filter(
      (e) =>
        (!sessionFilter || e.s === sessionFilter) &&
        (filter === 'all' || outcomeOf(e) === 'error') &&
        matchesQuery(e, terms),
    );
  }, [log, sessionFilter, filter, query]);
  const rows = useMemo(() => (since === null ? matches : matches.filter((e) => e.t >= since)), [matches, since]);
  const older = matches.length - rows.length;
  // The smallest wider range that brings in the next older match
  const wider = useMemo(() => {
    const next = matches[rows.length];
    if (!range || !next) return null;
    return RANGES.find((r) => r.ms > range.ms && next.t >= now - r.ms) ?? RANGES[RANGES.length - 1];
  }, [matches, rows.length, range, now]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Esc clears the chart selection where its banner shows; true when there was one to clear
  const clearChartSelection = useRef((): boolean => false);
  clearChartSelection.current = () => {
    if (!selection || view === 'plugins' || view === 'snapshots') return false;
    track({ name: 'timeline_span_selected', selected: false });
    onClearSelection();
    return true;
  };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const selectRow = useCallback(
    (e: CommandEntry) => {
      const open = selectedRef.current?.n === e.n;
      if (!open) track({ name: 'log_entry_opened', ok: e.ok });
      // Every click is a step Back undoes (opening, closing or switching rows); only ↑/↓ replaces
      setSelected(open ? null : e, 'push');
    },
    [setSelected],
  );
  // Start of today: the rows only need to re-render when "Today" becomes "Yesterday"
  const today = new Date(now).setHours(0, 0, 0, 0);

  const chooseFilter = (f: 'all' | 'errors') => {
    if (f !== filter) track({ name: 'log_filtered', filter: f });
    setFilter(f);
  };
  // One event per search, when the box goes from empty to typed in; the text itself is never sent
  const search = (q: string) => {
    if (!query.trim() && q.trim()) track({ name: 'log_searched', view });
    setQuery(q);
  };

  const copy = async () => {
    track({ name: 'log_copied', what: 'rows' });
    const text = rows
      .map((e) => `${new Date(e.t).toISOString()}  #${e.n}  ${OUTCOME_TAG[outcomeOf(e)]}  ${e.c}  ${e.ms}ms${e.s ? `  [${sessionName(sessionOf(e.s))}]` : ''}${e.e ? `  ${e.e}` : ''}`)
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
          {VIEWS.filter((v) => (v.key !== 'plugins' || knowledge) && (v.key !== 'snapshots' || snapshots)).map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => choose(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        {view === 'calls' && (
          <div className="seg" role="tablist" aria-label="Result">
            <button role="tab" aria-selected={filter === 'all'} onClick={() => chooseFilter('all')}>
              All <span className="count">{scoped.length}</span>
            </button>
            <button role="tab" aria-selected={filter === 'errors'} onClick={() => chooseFilter('errors')}>
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
              onChange={(ev) => search(ev.target.value)}
              placeholder={
                view === 'tools'
                  ? 'Filter tools'
                  : view === 'plugins'
                    ? 'Filter plugins or categories'
                    : view === 'snapshots'
                      ? 'Filter snapshots'
                      : 'Filter commands or errors'
              }
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
                track({ name: 'log_cleared' });
                setSelected(null);
                onClear();
              }}
              disabled={log.length === 0}
              title="Clear the log and the chart in this window (the bridge keeps its history and the counters)"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {selection && view !== 'plugins' && view !== 'snapshots' && (
        <div className="selection-bar" role="status">
          <span>
            Showing <b>{log.length.toLocaleString()}</b> command{log.length === 1 ? '' : 's'} from{' '}
            <span className="mono">{spanLabel(selection)}</span>
            {(oldestKept === null || selection.start < oldestKept) && (
              <span className="selection-note"> · the log keeps the latest {LOG_MAX.toLocaleString()}; older commands are only counted in the chart</span>
            )}
          </span>
          <button className="btn" onClick={onClearSelection} title="Clear selection (Esc)">
            Clear selection
          </button>
        </div>
      )}

      {multiSession && (view === 'calls' || view === 'tools') && (
        <div className="chips" role="tablist" aria-label="Agent session">
          <button role="tab" aria-selected={sessionFilter === null} className="chip" onClick={() => setSessionFilter(null)}>
            All agents
          </button>
          {sessionIds.map((id) => {
            const x = sessionOf(id);
            const n = windowed.filter((e) => e.s === id).length;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={sessionFilter === id}
                className="chip"
                title={x.dir ?? id}
                onClick={() => {
                  if (sessionFilter !== id) track({ name: 'session_filtered' });
                  setSessionFilter(sessionFilter === id ? null : id);
                }}
              >
                <i className={`sdot hue-${sessionHue(id)} ${isConnected(x, now) ? '' : 'sdot-off'}`} />
                {sessionName(x)}
                <span className="count">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'plugins' && knowledge ? (
        <PluginsView feed={knowledge} query={query} now={now} onOpenSettings={onOpenSettings} />
      ) : view === 'snapshots' && snapshots ? (
        <SnapshotsView feed={snapshots.feed} request={snapshots.request} blocked={snapshots.blocked} query={query} now={now} onSend={snapshots.send} />
      ) : view === 'tools' ? (
        <ToolsView log={scoped} query={query} now={now} onPick={(tool, errors) => {
            track({ name: 'tool_picked', errors_only: errors });
            showCalls({ tool, errors });
          }} />
      ) : view === 'sessions' ? (
        <SessionsView ids={sessionIds} sessionOf={sessionOf} log={log} now={now} onPick={(session) => {
            track({ name: 'session_picked' });
            showCalls({ session, tool: '' });
          }} />
      ) : (
        <div className="rows" role="log" aria-live="off">
          {rows.length === 0 ? (
            <div className="empty">
              {log.length === 0
                ? 'No commands yet. New ones show up here as your agent sends them.'
                : older > 0 && range
                  ? `Nothing in the ${range.label.toLowerCase()}.`
                  : filter === 'errors' && !query
                    ? 'No errors. Nice.'
                    : 'Nothing matches that filter.'}
            </div>
          ) : (
            <LogRows
              rows={rows}
              today={today}
              selectedN={selected?.n}
              sessionOf={multiSession && !sessionFilter ? sessionOf : null}
              onSelect={selectRow}
            />
          )}
          {wider && (
            <div className="log-more">
              <span>
                {older.toLocaleString()} older {older === 1 ? 'command' : 'commands'}
              </span>
              <button className="btn btn-sm" onClick={() => onRange(wider.key)}>
                Show {wider.label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
      {paused && view === 'calls' && <div className="paused-banner">Paused · new commands are still counted, the log is frozen</div>}
      {selected && (
        <Details
          entry={selected}
          session={selected.s ? sessionOf(selected.s) : null}
          now={now}
          filtered={query.trim() === selected.c}
          // A step Back undoes, unlike typing in the search box
          onFilter={() => {
            const off = query.trim() === selected.c;
            if (!off && !query.trim()) track({ name: 'log_searched', view });
            setQuery(off ? '' : selected.c, 'push');
          }}
          onAddTerm={(term) => {
            if (!query.trim()) track({ name: 'log_searched', view });
            setQuery((q) => (parseQuery(q).some((t) => JSON.stringify(t) === JSON.stringify(parseQuery(term)[0])) ? q : `${q.trim()} ${term}`.trim()), 'push');
          }}
          onClose={() => setSelected(null)}
          history={measurementHistory(log, selected)}
          onPick={(e) => setSelected(e, 'push')}
        />
      )}
    </section>
  );
}

const isToolSort = (v: unknown): v is ToolSort => TOOL_SORTS.some((x) => x.key === v);

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
  const [sort, setSort] = useUrlState<ToolSort>('sort', 'count', { validate: isToolSort });
  // Param terms narrow the calls counted, words the tools shown
  const groups = useMemo(() => {
    const terms = parseQuery(query);
    const params = terms.filter((t) => t.key !== undefined);
    const words = terms.filter((t) => t.key === undefined);
    const calls = params.length ? log.filter((e) => matchesQuery(e, params)) : log;
    return groupByTool(calls, sort).filter((g) => words.every((w) => g.c.includes(w.value)));
  }, [log, sort, query]);
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
          <button key={x.key} className={`th ${sort === x.key ? 'th-on' : ''}`} onClick={() => {
            if (x.key !== sort) track({ name: 'tools_sorted', sort: x.key });
            setSort(x.key);
          }} aria-pressed={sort === x.key}>
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
            <span className={`mono num ${TOOL_TONE[speedOf(g.c, g.p95)]}`}>{formatMs(g.p95)}</span>
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
      <p className="sessions-help">
        An agent is one MCP server, usually one Claude Code session; agents in the same folder are numbered by start
        time. It pings every 20s and shows as idle after 45s without one. Click a card to see only its calls.
      </p>
      {cards.map((x) => {
        const own = log.filter((e) => e.s === x.id);
        const tools = groupByTool(own).slice(0, 4);
        const live = isConnected(x, now);
        return (
          <button key={x.id} className="session-card" onClick={() => onPick(x.id)} title="Show this session's calls">
            <div className="session-top">
              <i className={`sdot hue-${sessionHue(x.id)} ${live ? '' : 'sdot-off'}`} />
              <span className="session-name" title={sessionName(x)}>{sessionName(x)}</span>
              {x.client && <span className="tag">{x.client}</span>}
              <span className={`session-state ${live ? 'on' : ''}`}>{live ? 'Connected' : x.ended ? 'Disconnected' : 'Idle'}</span>
            </div>
            {x.dir && (
              <div className="session-dir mono" title={x.dir}>
                {/* rtl + bdi: truncate the start of the path so the folder at the end stays visible */}
                <bdi>{x.dir}</bdi>
              </div>
            )}
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

/** Height of one log row in px; the list is windowed, so every row must be exactly this tall. */
const ROW_HEIGHT = 32;
/** Top padding of `.rows`, before the first row */
const ROWS_PAD = 4;
/** Rows rendered above and below the viewport, so fast scrolling doesn't show blank space */
const ROWS_OVERSCAN = 10;

/**
 * The command log, windowed: only the rows in (and near) the viewport are in the DOM. Keeps the
 * selected row in view (↑/↓ in the details sidebar) and keeps the reader's place when new commands
 * arrive above while they're scrolled down.
 */
function LogRows({
  rows,
  today,
  selectedN,
  sessionOf,
  onSelect,
}: {
  rows: CommandEntry[];
  today: number;
  selectedN: number | undefined;
  /** Set when several agents share the log, to tag each row with its agent */
  sessionOf: ((id: string) => Session) | null;
  onSelect: (e: CommandEntry) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });

  // The scroll container is the parent `.rows`, which also holds the empty state
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const update = () => setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const firstN = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    const added = prependedCount(firstN.current, rows.map((e) => e.n));
    firstN.current = rows[0]?.n;
    if (el && added > 0 && el.scrollTop > 0) el.scrollTop += added * ROW_HEIGHT;
  }, [rows]);

  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || selectedN === undefined) return;
    const i = rows.findIndex((e) => e.n === selectedN);
    if (i >= 0) el.scrollTop = scrollToRow(el.scrollTop, el.clientHeight, ROW_HEIGHT, i, ROWS_PAD);
    // Only when the selection moves, not on every new row
  }, [selectedN]);

  const { start, end } = visibleRows(view.top, view.height, ROW_HEIGHT, rows.length, ROWS_OVERSCAN, ROWS_PAD);
  return (
    <div ref={ref} className="rows-window" style={{ height: rows.length * ROW_HEIGHT }}>
      <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
        {rows.slice(start, end).map((e) => (
          <Row
            key={e.n}
            entry={e}
            today={today}
            session={sessionOf && e.s ? sessionOf(e.s) : null}
            selected={selectedN === e.n}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/** Memoized: re-renders only when its own entry, selection, agent tag or the day changes. */
const Row = memo(
  function Row({
    entry: e,
    today,
    session,
    selected,
    onSelect,
  }: {
    entry: CommandEntry;
    /** Start of today, for the Today / Yesterday / date label */
    today: number;
    /** Shown as a tag when several agents share the log */
    session: Session | null;
    selected: boolean;
    onSelect: (e: CommandEntry) => void;
  }) {
    const time = new Date(e.t);
    const hhmmss = time.toLocaleTimeString([], { hour12: false });
    const ms = String(time.getMilliseconds()).padStart(3, '0');
    const speed = speedOf(e.c, e.ms);
    return (
      <div className={`row ${ROW_CLASS[outcomeOf(e)]} ${selected ? 'row-selected' : ''}`}>
        <button className="row-main" style={{ height: ROW_HEIGHT }} onClick={() => onSelect(e)} aria-pressed={selected}>
          {/* "x ago" is set on hover, so the row needn't re-render every second to keep it fresh */}
          <span className="row-time mono" onMouseEnter={(ev) => (ev.currentTarget.title = formatAgo(Date.now() - e.t))}>
            <span className="row-day">{formatDay(e.t, today)}</span>
            {hhmmss}
            <span className="row-ms">.{ms}</span>
          </span>
          <span className={`status-dot ${DOT_CLASS[outcomeOf(e)]}`} />
          <span className="row-cmd mono">{e.c}</span>
          {e.e && <span className="row-err-inline">{e.e}</span>}
          <span className="row-end">
            {session && (
              <span className="row-session" title={session.dir ?? session.id}>
                <i className={`sdot hue-${sessionHue(session.id)}`} />
                {sessionName(session)}
              </span>
            )}
            <span className={`row-dur mono ${speed}`} title={speed === 'long' ? SPEED_LABEL.long : undefined}>
              <span className="dur-track" aria-hidden>
                <span className="dur-fill" style={{ width: `${latencyScale(e.ms) * 100}%` }} />
              </span>
              {formatMs(e.ms)}
            </span>
          </span>
        </button>
      </div>
    );
  },
  // A missing session is rebuilt per render by sessionOf, so compare agent tags by what they show
  (a, b) =>
    a.entry === b.entry &&
    a.today === b.today &&
    a.selected === b.selected &&
    a.onSelect === b.onSelect &&
    a.session?.id === b.session?.id &&
    a.session?.label === b.session?.label &&
    a.session?.dir === b.session?.dir,
);

/** Right-hand sidebar with everything known about one command. ↑/↓ move between rows, Esc closes. */
export function Details({
  entry: e,
  session,
  now,
  filtered,
  onFilter,
  onAddTerm,
  onClose,
  history,
  onPick,
}: {
  entry: CommandEntry;
  session: Session | null;
  now: number;
  /** The log is already filtered to this command's tool */
  filtered: boolean;
  onFilter: () => void;
  /** Add a search term (from a selection in the params) to the log's filter */
  onAddTerm: (term: string) => void;
  onClose: () => void;
  /** Earlier calls of the same measurement on the same track, for the result's history */
  history: CommandEntry[];
  onPick: (e: CommandEntry) => void;
}) {
  const width = useDrawerWidth();
  const [copied, setCopied] = useState<string | null>(null);
  const time = new Date(e.t);
  const speed = SPEED_LABEL[speedOf(e.c, e.ms)];
  const params = formatParams(e.p);

  const copy = async (what: 'error' | 'params', text: string) => {
    track({ name: 'log_copied', what });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // clipboard needs a secure context
    }
  };

  return (
    <aside className="drawer" aria-label={`Details for ${e.c}`} style={width.style}>
      <ResizeHandle fraction={width.fraction} onCommit={width.setFraction} />
      <div className="drawer-head">
        <div className="drawer-title">
          <span className={`status-dot ${DOT_CLASS[outcomeOf(e)]}`} />
          <span className="tip-anchor">
            <button
              className={`drawer-filter mono${filtered ? ' active' : ''}`}
              onClick={onFilter}
              aria-pressed={filtered}
              aria-describedby="drawer-filter-tip"
            >
              {e.c}
            </button>
            <span id="drawer-filter-tip" role="tooltip" className="tip">
              {filtered ? 'Click to show all commands again' : `Click to show only ${e.c} calls`}
            </span>
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>
      <div className="drawer-body">
        <div className={`result-badge ${BADGE[outcomeOf(e)].className}`}>{BADGE[outcomeOf(e)].label}</div>

        <dl className="facts">
          <dt>Handler time</dt>
          <dd>
            <span className="mono">{e.ms} ms</span> <span className="muted">· {speed}</span>
          </dd>
          <dt>When</dt>
          <dd title={time.toISOString()}>
            {formatDay(e.t, now)} {time.toLocaleTimeString([], { hour12: false })}.{String(time.getMilliseconds()).padStart(3, '0')}{' '}
            <span className="muted">· {formatAgo(now - e.t)}</span>
          </dd>
          {session && (
            <>
              <dt>Session</dt>
              <dd>
                <span className="session-inline session-fact" title={[sessionName(session), session.client].filter(Boolean).join(' · ')}>
                  <i className={`sdot hue-${sessionHue(session.id)}`} />
                  <span className="session-fact-name">{sessionName(session)}</span>
                  {session.client && <span className="muted session-fact-client"> · {session.client}</span>}
                </span>
                <span className="mono muted session-sub">{session.id}</span>
              </dd>
            </>
          )}
          {e.src === 'page' && (
            <>
              <dt>Sent from</dt>
              <dd>This page (Snapshots)</dd>
            </>
          )}
          <dt className="fact-wide">Timestamp</dt>
          <dd className="mono fact-wide">{time.toISOString()}</dd>
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

        <MeasurementView entry={e} history={history} now={now} onPick={onPick} />
        <EditViewSection entry={e} />

        <div className="code-block">
          <div className="code-head">
            <span>Params</span>
            {params && (
              <button className="link-btn" onClick={() => copy('params', params)}>
                {copied === 'params' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {params ? <ParamsText text={params} onAddTerm={onAddTerm} /> : <pre><span className="muted">No params</span></pre>}
        </div>

        <p className="drawer-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> to move between commands · select a param to filter by it · <kbd>Esc</kbd> to close
        </p>
      </div>
    </aside>
  );
}

/**
 * The formatted params; selecting text in them offers to filter the log by it (the whole param when the
 * selection sits on one `"key": value` line).
 */
function ParamsText({ text, onAddTerm }: { text: string; onAddTerm: (term: string) => void }) {
  const pre = useRef<HTMLPreElement>(null);
  const [pick, setPick] = useState<{ term: string; x: number; y: number } | null>(null);

  const read = () => {
    const el = pre.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return setPick(null);
    const range = sel.getRangeAt(0);
    const before = document.createRange();
    before.setStart(el, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const term = termFromSelection(text, start, start + range.toString().length);
    const box = range.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    setPick(term ? { term, x: box.left + box.width / 2 - host.left, y: box.top - host.top } : null);
  };

  useEffect(() => {
    // A click elsewhere or a collapsed selection hides the offer
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPick(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);
  useEffect(() => setPick(null), [text]);

  return (
    <div className="params-text">
      <pre ref={pre} onMouseUp={read} onKeyUp={read}>
        {text}
      </pre>
      {pick && (
        <button
          className="params-filter"
          style={{ left: pick.x, top: pick.y }}
          // Keep the selection while clicking
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => {
            onAddTerm(pick.term);
            window.getSelection()?.removeAllRanges();
            setPick(null);
          }}
        >
          Filter <span className="mono">{pick.term}</span>
        </button>
      )}
    </div>
  );
}

export function Offline({ reachable }: { reachable: boolean }) {
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
          <p>Open REAPER and start the bridge. This page connects on its own.</p>
          <ol>
            <li>Open REAPER</li>
            <li>
              Run <code>mcp_bridge.lua</code> from the action list (first time: Actions → Show action list → Load
              ReaScript…)
            </li>
            <li>
              Still unreachable? Close REAPER and run <code>reaper-mcp setup</code>. It turns on REAPER’s web
              interface.
            </li>
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
