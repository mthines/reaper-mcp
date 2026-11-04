import { Icon } from '../components/index.js';
import { useCommand, useCommandPalette, type Command } from '../features/command/index.js';
import { RANGES, type RangeKey } from '../features/timeline/index.js';
import type { UsageStatsState } from '../lib/analytics.js';
import type { BridgeSettings, SettingKey } from '../lib/status.js';
import { DISCORD_URL, REPO_URL } from '../lib/links.js';

const open = (url: string) => () => void window.open(url, '_blank', 'noreferrer');

/**
 * The page-level commands: the timeline's range, the bridge's settings and the header's actions.
 * What a view owns (its filters, its rows) registers inside that view. Rules: .claude/rules/command-palette.md.
 */
export function AppCommands({
  rangeKey,
  onRange,
  settings,
  onSet,
  onOpenSettings,
  overview,
  onToggleOverview,
  onRebuild,
  onRestart,
  notify,
  onNotify,
  usageStats,
  onUsageStats,
}: {
  rangeKey: RangeKey;
  onRange: (k: RangeKey) => void;
  settings: BridgeSettings | null;
  onSet: (key: SettingKey, on: boolean) => void;
  onOpenSettings?: () => void;
  overview: boolean;
  onToggleOverview?: () => void;
  onRebuild?: () => void;
  onRestart?: () => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
  usageStats: UsageStatsState;
  onUsageStats: (on: boolean) => void;
}) {
  const palette = useCommandPalette();
  const toggle = (id: string, key: SettingKey, on: boolean | undefined, labels: [string, string]): Command => ({
    id,
    label: on ? labels[1] : labels[0],
    group: 'Bridge',
    onSelect: () => onSet(key, !on),
  });
  const ready = settings !== null;
  useCommand(toggle('bridge-pause', 'cfg_paused', settings?.paused, ['Pause agent control', 'Resume agent control']), ready);
  useCommand(toggle('bridge-readonly', 'cfg_readonly', settings?.readonly, ['Turn on read-only mode', 'Turn off read-only mode']), ready);
  useCommand(toggle('bridge-open-on-start', 'cfg_open_on_start', settings?.openOnStart, ['Open this page when the bridge starts', 'Stop opening this page when the bridge starts']), ready);
  useCommand(toggle('bridge-dev', 'cfg_dev', settings?.dev, ['Turn on developer mode', 'Turn off developer mode']), ready);

  // One entry; the ranges are its menu (a search finds them too)
  useCommand({
    id: 'timeline-range',
    label: 'Timeline range…',
    group: 'Timeline',
    description: 'time window of the chart and the log',
    children: RANGES.map((r) => ({ id: `range-${r.key}`, label: r.label, hint: r.key === rangeKey ? 'current' : undefined, onSelect: () => onRange(r.key) })),
  });
  useCommand({ id: 'settings-open', label: 'Open settings', group: 'Bridge', icon: <Icon.Gear />, onSelect: () => onOpenSettings?.() }, Boolean(onOpenSettings));
  useCommand({ id: 'bridge-rebuild', label: 'Rebuild & reload', group: 'Bridge', description: 'developer mode working tree changed', onSelect: () => onRebuild?.() }, Boolean(onRebuild));
  useCommand({ id: 'bridge-restart', label: 'Restart bridge', group: 'Bridge', onSelect: () => onRestart?.() }, Boolean(onRestart));
  useCommand({ id: 'page-overview', label: overview ? 'Hide stats & timeline' : 'Show stats & timeline', group: 'Page', onSelect: () => onToggleOverview?.() }, Boolean(onToggleOverview));
  useCommand({ id: 'page-notify', label: notify ? 'Turn off error notifications' : 'Turn on error notifications', group: 'Page', onSelect: () => onNotify(!notify) });
  useCommand({ id: 'page-usage-stats', label: usageStats.on ? 'Turn off usage statistics' : 'Turn on usage statistics', group: 'Page', description: 'privacy telemetry analytics', onSelect: () => onUsageStats(!usageStats.on) }, usageStats.on || usageStats.reason === 'user');
  useCommand({ id: 'help-shortcuts', label: 'Keyboard shortcuts', group: 'Help', shortcut: ['?'], onSelect: () => palette?.setHelpOpen(true) });
  useCommand({ id: 'help-github', label: 'Open reaper-mcp on GitHub', group: 'Help', icon: <Icon.GitHub />, onSelect: open(REPO_URL) });
  useCommand({ id: 'help-issue', label: 'Report an issue', group: 'Help', onSelect: open(`${REPO_URL}/issues`) });
  useCommand({ id: 'help-discord', label: 'Join the Discord', group: 'Help', onSelect: open(DISCORD_URL) });

  return null;
}
