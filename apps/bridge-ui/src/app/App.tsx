import { useEffect, useMemo, useRef, useState } from 'react';
import { setUsageStats, startAnalytics, track, trackView, type UsageStatsState } from '../lib/analytics.js';
import { blockedBy } from '../features/snapshots/snapshots.js';
import { useSnapshots } from '../features/snapshots/useSnapshots.js';
import { isBoolean, useUrlState } from '../lib/url-state.js';
import { LOREKIT_PUBLISH_TOKEN_KEY, loadLoreKitToken, saveLoreKitToken, useKnowledge } from '../features/plugins/useKnowledge.js';
import { deriveSeries, formatAgo, inSpan, labelSessions, liveness, type SettingKey, type Span, type Liveness } from '../lib/status.js';
import { Header } from './Header.js';
import { Notices } from './Notices.js';
import { Offline } from './Offline.js';
import { DEMO } from './demo-mode.js';
import { useBridgeFeed } from './useBridgeFeed.js';
import { useBridgeRequest } from './useBridgeRequest.js';
import { useErrorNotifications } from './useErrorNotifications.js';
import { useHistory } from './useHistory.js';
import { useSettings } from './useSettings.js';
import { Log, VIEW_KEY, type View, isSpanOrNull, isView, loadView } from '../features/log/Log.js';
import { SETTING_NAME, SettingsPanel } from '../features/settings/SettingsPanel.js';
import { Stats } from '../features/stats/Stats.js';
import { Timeline } from '../features/timeline/Timeline.js';
import { RANGE_STORAGE_KEY, type RangeKey, isRangeKey, loadRange } from '../features/timeline/ranges.js';
import { DISCORD_URL, REPO_URL } from '../lib/links.js';
import { load, save } from '../lib/storage.js';
import { useNow } from '../lib/useNow.js';

const OVERVIEW_KEY = 'mcp-bridge-overview';

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
  // Short windows show only the log; the stats and timeline are opt-in from the header menu
  const [overview, setOverview] = useState(() => load(OVERVIEW_KEY) === '1');
  const toggleOverview = () => {
    save(OVERVIEW_KEY, overview ? '0' : '1');
    setOverview(!overview);
  };
  const openSettings = (toggle: boolean) => () => {
    const next = toggle ? !settingsOpen : true;
    if (next && !settingsOpen) track({ name: 'settings_opened' });
    setSettingsOpen(next);
  };

  return (
    <div className={`shell ${overview ? 'overview-on' : ''}`}>
      <Header
        status={status}
        state={state}
        reachable={reachable}
        now={now}
        sessions={sessions}
        onShowAgents={() => chooseView('sessions')}
        onOpenSettings={settings ? openSettings(true) : undefined}
        overview={overview}
        onToggleOverview={status ? toggleOverview : undefined}
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
