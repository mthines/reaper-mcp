import { addSignalAttribute, identify, init, sendEvent, startView } from '@dash0/sdk-web';
import type { Coverage } from './plugins.js';
import type { Liveness } from './status.js';

// Pseudonymous usage statistics for the bridge page: which views and actions people use, so the
// page can be improved. The only module that talks to the Dash0 Web SDK. Same destination and the
// same promises as the server's telemetry (TELEMETRY.md): no plugin, track or project names, no
// search text, tokens, paths or host names. The events are listed in tracking-plan.yaml.

declare const __VERSION__: string;
declare const __DASH0_ENDPOINT__: string;
declare const __DASH0_TOKEN__: string;
declare const __DASH0_DATASET__: string;

export const USAGE_STATS_KEY = 'mcp_bridge.usage_stats';
const INSTALL_ID_KEY = 'mcp_bridge.install_id';
export const SERVICE_NAME = 'reaper-mcp-bridge-ui';

/** Every event the page sends; the name goes out as `bridge_ui.<name>`, the rest as `bridge_ui.*` attributes. */
export type TrackEvent =
  | { name: 'settings_opened' }
  | { name: 'setting_changed'; setting: 'paused' | 'readonly' | 'open_on_start' | 'dev' | 'error_notifications' | 'usage_stats'; enabled: boolean; source: 'settings' | 'notice' }
  | { name: 'app_install_clicked'; state: string }
  | { name: 'bridge_restart_clicked'; source: 'settings' }
  | { name: 'lorekit_token_changed'; kind: 'read' | 'publish'; connected: boolean }
  | { name: 'timeline_range_changed'; range: string }
  | { name: 'timeline_span_selected'; selected: boolean }
  | { name: 'log_filtered'; filter: 'all' | 'errors' }
  | { name: 'log_searched'; view: string }
  | { name: 'log_paused'; paused: boolean }
  | { name: 'log_copied'; what: 'rows' | 'error' | 'params' }
  | { name: 'log_cleared' }
  | { name: 'log_entry_opened'; ok: boolean }
  | { name: 'session_filtered' }
  | { name: 'tools_sorted'; sort: string }
  | { name: 'tool_picked'; errors_only: boolean }
  | { name: 'session_picked' }
  | { name: 'plugin_opened'; coverage: Coverage; in_project: boolean; formats: number }
  | { name: 'plugin_teach_copied'; scope: 'one' | 'many'; count: number }
  | { name: 'plugins_filtered'; filter: string; in_project: boolean }
  | { name: 'plugins_grouped'; grouped: boolean }
  | { name: 'plugin_contribute_clicked'; count: number; prefilled: boolean }
  | { name: 'plugin_publish_completed'; outcome: 'published' | 'refused' | 'failed'; removed_copy: boolean; replaced: boolean }
  | { name: 'bridge_state_changed'; state: Liveness }
  | { name: 'knowledge_load_failed'; layer: 'built-in' | 'user' }
  | { name: 'page_error'; type: string };

/** Why usage statistics are on or off, in words the Settings toggle can show. */
export type UsageStatsState = { on: true } | { on: false; reason: 'user' | 'browser' | 'demo' | 'unconfigured' };

type PrivacyNavigator = { globalPrivacyControl?: boolean; doNotTrack?: string | null };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // per-viewer convenience only
  }
}

/** On by default like the server's telemetry; off when the viewer turned it off or the browser asks not to be tracked. */
export function usageStatsState(opts: { demo: boolean; stored: string | null; nav: PrivacyNavigator; configured: boolean }): UsageStatsState {
  if (opts.demo) return { on: false, reason: 'demo' };
  if (!opts.configured) return { on: false, reason: 'unconfigured' };
  if (opts.nav.globalPrivacyControl === true || opts.nav.doNotTrack === '1') return { on: false, reason: 'browser' };
  if (opts.stored === '0') return { on: false, reason: 'user' };
  return { on: true };
}

/** Event attributes under the `bridge_ui.` namespace; the event's own name is left out. */
export function eventAttributes(event: TrackEvent): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(event)) if (k !== 'name') attrs[`bridge_ui.${k}`] = v as string | number | boolean;
  return attrs;
}

/** The page's URL without host, port or query: a LAN address or `?install` says nothing useful. */
export function scrubUrl<T extends Record<string, string | undefined>>(attrs: T): T {
  let path = '/';
  try {
    path = new URL(attrs['url.full'] ?? '/', 'http://localhost').pathname;
  } catch {
    // keep '/'
  }
  return { 'url.full': path, 'url.path': path } as unknown as T;
}

let started = false;
let enabled = false;

function installId(): string {
  const existing = read(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(INSTALL_ID_KEY, id);
  return id;
}

/** Start the SDK when usage statistics are on; a no-op otherwise. Safe to call more than once. */
export function startAnalytics(demo: boolean, view?: string): UsageStatsState {
  const state = currentState(demo);
  enabled = state.on;
  if (!state.on || started) return state;
  started = true;
  init({
    serviceName: SERVICE_NAME,
    serviceVersion: __VERSION__,
    endpoint: { url: __DASH0_ENDPOINT__, authToken: __DASH0_TOKEN__, dataset: __DASH0_DATASET__ },
    // Web vitals only. Not fetch/xhr: the page polls the bridge twice a second and calls LoreKit with the
    // viewer's token. Not navigation or error: their bodies and stacks carry the full page URL (host or LAN
    // IP), which the URL scrubber can't reach; page views and errors are sent by trackView / page_error.
    enabledInstrumentations: ['@dash0/web-vitals'],
    urlAttributeScrubber: scrubUrl,
    disableVcsDetection: true,
  });
  identify(installId());
  addSignalAttribute('bridge_ui.display_mode', displayMode());
  // The kind of error only, never its message or stack (TELEMETRY.md)
  window.addEventListener('error', (ev) => track({ name: 'page_error', type: errorType(ev.error) }));
  window.addEventListener('unhandledrejection', (ev) => track({ name: 'page_error', type: errorType(ev.reason) }));
  if (view) trackView(view);
  return state;
}

export function currentState(demo: boolean): UsageStatsState {
  const nav = typeof navigator === 'undefined' ? {} : (navigator as PrivacyNavigator);
  return usageStatsState({ demo, stored: read(USAGE_STATS_KEY), nav, configured: Boolean(__DASH0_TOKEN__) });
}

/** The viewer's choice from Settings; turning it on starts the SDK, turning it off stops events right away. */
export function setUsageStats(on: boolean, demo: boolean): UsageStatsState {
  write(USAGE_STATS_KEY, on ? '1' : '0');
  const state = startAnalytics(demo);
  if (state.on) track({ name: 'setting_changed', setting: 'usage_stats', enabled: true, source: 'settings' });
  return state;
}

export function track(event: TrackEvent): void {
  if (!enabled) return;
  try {
    sendEvent(`bridge_ui.${event.name}`, {
      attributes: eventAttributes(event),
      severity: event.name === 'page_error' || (event.name === 'plugin_publish_completed' && event.outcome !== 'published') ? 'ERROR' : undefined,
    });
  } catch {
    // usage statistics never break the page
  }
}

/** A switch between the page's views (Calls, Tools, Sessions, Plugins), recorded as a page view. */
export function trackView(view: string): void {
  if (!enabled) return;
  try {
    startView(`/${view}`);
  } catch {
    // usage statistics never break the page
  }
}

/** `TypeError`, `RangeError`, … for errors; a fixed label for anything thrown that isn't one. */
export function errorType(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'non_error';
}

/** Where the page runs: the bridge's app window, an installed app, or a browser tab. */
function displayMode(): string {
  if (new URLSearchParams(location.search).has('app')) return 'bridge_window';
  return window.matchMedia?.('(display-mode: standalone)').matches ? 'installed_app' : 'browser_tab';
}
