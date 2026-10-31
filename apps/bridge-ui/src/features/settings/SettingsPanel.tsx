import { useEffect, useState } from 'react';
import { manualInstallHint, openInBrowserToInstall, promptInstall, useInstallState } from '../../lib/install.js';
import { track, type TrackEvent, type UsageStatsState } from '../../lib/analytics.js';
import type { BridgeSettings, SettingKey } from '../../lib/status.js';
import { notificationPermission } from '../../app/useErrorNotifications.js';
import { LoreKitSetting, PublishSetting } from './LoreKitSettings.js';
import { Icon, Toggle } from '../../components/index.js';
import { cx } from '../../lib/cx.js';
import drawerStyles from '../../styles/drawer.module.css';
import styles from './SettingsPanel.module.css';

export function SettingsPanel({
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
    <aside className={cx(drawerStyles.drawer, drawerStyles.drawerSettings)} aria-label="Settings">
      <div className={drawerStyles.drawerHead}>
        <div className={drawerStyles.drawerTitle}>Settings</div>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
          <Icon.Close />
        </button>
      </div>
      <div className={drawerStyles.drawerBody}>
        <div className={styles.settingGroup}>
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
        <div className={styles.settingGroup}>
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
        <div className={styles.settingGroup}>
          <h3>Bridge</h3>
          <div className={styles.installRow}>
            <div className={styles.installText}>
              <div className={styles.rowLabel}>Restart bridge</div>
              <div className={styles.rowHint}>
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
          <div className={styles.settingGroup}>
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
        <div className={styles.settingGroup}>
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

export const SETTING_NAME: Record<SettingKey, Extract<TrackEvent, { name: 'setting_changed' }>['setting']> = {
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
    <div className={styles.installRow}>
      <div className={styles.installText}>
        <div className={styles.rowLabel}>Desktop app</div>
        <div className={styles.rowHint}>
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
        <span className={styles.installDone}>
          <i className="kdot" data-coverage="learned" /> Installed
        </span>
      ) : (
        <button className="btn btn-sm" onClick={onInstall}>
          Install app
        </button>
      )}
    </div>
  );
}
