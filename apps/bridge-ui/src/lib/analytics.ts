import { addSignalAttribute, identify, init, sendEvent, startSessionRecording, startView, type SessionRecorder } from '@dash0/sdk-web';
import type { Liveness } from './status.js';
import type { Coverage } from '../features/plugins/index.js';

// Pseudonymous usage statistics for the bridge page: which views and actions people use, so the
// page can be improved. The only module that talks to the Dash0 Web SDK. Same destination and the
// same promises as the server's telemetry (TELEMETRY.md): no plugin, track or project names, no
// search text, tokens, paths or host names. The events are listed in tracking-plan.yaml.
//
// The hosted site's public pages (/docs, /changelog) are measured separately, as their own service
// with page views, errors, web events and session replay: see "The hosted site" below.


export const USAGE_STATS_KEY = 'mcp_bridge.usage_stats';
const INSTALL_ID_KEY = 'mcp_bridge.install_id';
export const SERVICE_NAME = 'reaper-mcp-bridge-ui';

/** Every event the page sends; the name goes out as `bridge_ui.<name>`, the rest as `bridge_ui.*` attributes. */
export type TrackEvent =
  | { name: 'settings_opened' }
  | { name: 'changelog_opened'; source: 'header' | 'notice' | 'menu' | 'palette' | 'footer'; update_available: boolean }
  | { name: 'changelog_betas_toggled'; shown: boolean }
  | { name: 'update_clicked'; source: 'changelog' | 'notice' | 'palette' }
  | { name: 'update_finished'; result: 'ready' | 'current' | 'failed'; source: 'npm' | 'clone' }
  | { name: 'update_reload_clicked'; source: 'npm' | 'clone' }
  | { name: 'setting_changed'; setting: 'paused' | 'readonly' | 'open_on_start' | 'dev' | 'autostart' | 'error_notifications' | 'usage_stats'; enabled: boolean; source: 'settings' | 'notice' }
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
  | { name: 'log_entry_opened'; ok: boolean; view: string }
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
  | { name: 'snapshot_restored'; outcome: 'ok' | 'refused' | 'lost'; warnings: boolean }
  | { name: 'snapshot_saved'; outcome: 'ok' | 'refused' | 'lost'; described: boolean; replaced: boolean; named: boolean }
  | { name: 'snapshot_deleted'; outcome: 'ok' | 'refused' | 'lost' }
  | { name: 'snapshots_cleared'; outcome: 'ok' | 'refused' | 'lost' }
  | { name: 'snapshot_edited'; outcome: 'ok' | 'refused' | 'lost'; renamed: boolean }
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

// ── The hosted site ─────────────────────────────────────────────────────────────────────────────────────────────
// The public guides (/docs) and changelog (/changelog) on the hosted build. Unlike the bridge page they run on a
// public address with no bridge, tokens or LAN host behind them, so they get the full Web SDK: page views (each
// guide is a virtual page view), errors, fetch timings, web vitals, rage clicks and a session replay, plus the
// events below. A visitor is a random id kept in that browser. Off when the browser sends GPC or Do Not Track.

export const SITE_SERVICE_NAME = 'reaper-mcp-site';
const SITE_VISITOR_ID_KEY = 'reaper_site.visitor_id';

/** Which hosted page is open. */
export type SitePage = 'docs' | 'changelog';

/** Where a tracked link goes; anything else is not a call to action and is not sent. */
export type SiteCta = 'demo' | 'install' | 'changelog' | 'github' | 'releases' | 'issues' | 'discord' | 'bridge';

/** Every event the hosted pages send; the name goes out as `site.<name>`, the rest as `site.*` attributes. */
export type SiteEvent =
  | { name: 'scroll_depth'; depth: ScrollMilestone }
  | { name: 'cta_clicked'; cta: SiteCta }
  | { name: 'click'; label: string; path: string; element: string }
  | { name: 'code_copied'; lang: string }
  | { name: 'prompt_copied' }
  | { name: 'video_played' }
  | { name: 'changelog_betas_toggled'; shown: boolean }
  | { name: 'release_linked'; version: string };

export type ScrollMilestone = 25 | 50 | 75 | 100;
const MILESTONES: ScrollMilestone[] = [25, 50, 75, 100];

/** Sessions with a replay, in percent. Every measured session today; lower it here if replay volume grows. */
export const SITE_REPLAY_SAMPLING = 100;

/** On for the hosted build's own pages unless the browser asks not to be tracked or there's no destination. */
export function siteAnalyticsState(opts: { hosted: boolean; configured: boolean; nav: PrivacyNavigator }): UsageStatsState {
  if (!opts.hosted) return { on: false, reason: 'unconfigured' };
  if (!opts.configured) return { on: false, reason: 'unconfigured' };
  if (opts.nav.globalPrivacyControl === true || opts.nav.doNotTrack === '1') return { on: false, reason: 'browser' };
  return { on: true };
}

/** Event attributes under the `site.` namespace; the event's own name is left out. */
export function siteEventAttributes(event: SiteEvent): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(event)) if (k !== 'name') attrs[`site.${k}`] = v as string | number | boolean;
  return attrs;
}

/**
 * The hosted page's URL without its query: `?bridge=` carries the viewer's local bridge address, which has no
 * place in telemetry. Path, host and fragment (a guide heading, `#release-0.79.1`) are public and kept.
 */
export function scrubSiteUrl<T extends Record<string, string | undefined>>(attrs: T): T {
  try {
    const u = new URL(attrs['url.full'] ?? '/', 'https://localhost');
    u.search = '';
    return { ...attrs, 'url.full': u.href, 'url.query': undefined };
  } catch {
    return { ...attrs, 'url.full': attrs['url.path'] ?? '/', 'url.query': undefined };
  }
}

/** The deepest milestone a reader has reached, or null above the first. A page that fits the window never scrolls. */
export function scrollMilestone(scrollY: number, viewport: number, height: number): ScrollMilestone | null {
  const scrollable = height - viewport;
  if (scrollable <= 0) return null;
  const percent = ((scrollY + viewport) / height) * 100;
  let reached: ScrollMilestone | null = null;
  for (const m of MILESTONES) if (percent >= m - 0.5) reached = m;
  return reached;
}

/** What a link on the hosted pages leads to, from its address; null for a link that isn't a call to action. */
export function siteCtaOf(href: string): SiteCta | null {
  let u: URL;
  try {
    // Resolved against a page below the root, so an in-page `#heading` or a relative link never reads as `/` (the demo)
    u = new URL(href, 'https://site.invalid/_/page');
  } catch {
    return null;
  }
  if (u.hostname === 'discord.gg' || u.hostname.endsWith('discord.com')) return 'discord';
  if (u.hostname === 'github.com') {
    if (/\/issues(\/|$)/.test(u.pathname)) return 'issues';
    if (/\/releases(\/|$)/.test(u.pathname)) return 'releases';
    return 'github';
  }
  // The same loopback hosts the guides accept for the bridge link (parseBridgeUrl in features/docs/useDocs.ts)
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname.endsWith('.localhost')) {
    return /\/mcp_bridge\.html$/.test(u.pathname) ? 'bridge' : null;
  }
  if (u.hostname !== 'site.invalid') return null;
  if (u.pathname === '/' || u.searchParams.has('demo')) return 'demo';
  if (u.pathname === '/docs/install') return 'install';
  if (u.pathname === '/changelog') return 'changelog';
  return null;
}

let siteStarted = false;
let siteEnabled = false;

/** Start the Web SDK, session replay included, on a hosted page. A no-op off the hosted build or when tracking is off. */
export function startSiteAnalytics(page: SitePage): UsageStatsState {
  const nav = typeof navigator === 'undefined' ? {} : (navigator as PrivacyNavigator);
  const state = siteAnalyticsState({ hosted: __HOSTED__, configured: Boolean(__DASH0_TOKEN__), nav });
  if (!state.on || siteStarted) return state;
  siteStarted = true;
  siteEnabled = true;
  init({
    serviceName: SITE_SERVICE_NAME,
    serviceNamespace: 'reaper-mcp',
    serviceVersion: __VERSION__,
    environment: __SITE_ENV__,
    endpoint: { url: __DASH0_ENDPOINT__, authToken: __DASH0_TOKEN__, dataset: __DASH0_DATASET__ },
    // Not xhr: the pages make none. Fetch covers the guides and the index loading from beside the page.
    enabledInstrumentations: ['@dash0/navigation', '@dash0/web-vitals', '@dash0/error', '@dash0/fetch', '@dash0/session-recording', '@dash0/frustration-signals'],
    urlAttributeScrubber: scrubSiteUrl,
    // Vite doesn't expose Vercel's git env to the browser, so the build hands it over (build-config.mjs)
    disableVcsDetection: true,
    vcs: __SITE_VCS__,
    // Typed text (the palette's search box) never leaves the browser; the pages' own text is public. The palette's
    // list is masked too: its no-match line repeats the query as text, which maskAllInputs doesn't cover
    sessionRecording: { samplingRate: SITE_REPLAY_SAMPLING, maskAllInputs: true, maskTextSelector: '[role="listbox"]' },
    // init() sends the first page view before it returns, copying the signal attributes then: set them here,
    // not with identify()/addSignalAttribute() afterwards, or that view goes out without a user.id and site.page
    additionalSignalAttributes: { 'user.id': siteVisitorId(), 'site.page': page },
  });
  void loadRecorder().then((recorder) => recorder && startSessionRecording(recorder));
  watchScrollDepth();
  watchCtaClicks();
  watchClicks();
  return state;
}

/** Send a hosted-page event; a no-op unless {@link startSiteAnalytics} turned the SDK on. */
export function trackSite(event: SiteEvent): void {
  if (!siteEnabled) return;
  try {
    sendEvent(`site.${event.name}`, { attributes: siteEventAttributes(event) });
  } catch {
    // usage statistics never break the page
  }
}

function siteVisitorId(): string {
  const existing = read(SITE_VISITOR_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(SITE_VISITOR_ID_KEY, id);
  return id;
}

/**
 * rrweb (~76 KB) is only bundled into the hosted build: `__HOSTED__` is a build-time constant, so in the page
 * REAPER serves this branch, and the import with it, is removed.
 */
function loadRecorder(): Promise<SessionRecorder | undefined> {
  if (__HOSTED__) return import('@dash0/sdk-web/session-recording').then((m) => m.recorder).catch(() => undefined);
  return Promise.resolve(undefined);
}

/** One `scroll_depth` per milestone per page path; a guide opened without a reload starts again from zero. */
function watchScrollDepth(): void {
  let path = location.pathname;
  let deepest = 0;
  let frame = 0;
  const measure = () => {
    frame = 0;
    if (location.pathname !== path) {
      path = location.pathname;
      deepest = 0;
    }
    const reached = scrollMilestone(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
    if (!reached || reached <= deepest) return;
    for (const m of MILESTONES) if (m > deepest && m <= reached) trackSite({ name: 'scroll_depth', depth: m });
    deepest = reached;
  };
  window.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(measure);
  }, { passive: true });
}

/** Links to the demo, install guide, changelog, GitHub, Discord or back to the bridge, wherever they are on the page. */
function watchCtaClicks(): void {
  document.addEventListener('click', (e) => {
    const href = (e.target as Element | null)?.closest?.('a')?.getAttribute('href');
    const cta = href ? siteCtaOf(href) : null;
    if (cta) trackSite({ name: 'cta_clicked', cta });
  }, { capture: true });
}

/** What the click listener needs from a DOM element; `Element` fits it, and a test can fake it. */
export interface ClickNode {
  closest(selector: string): ClickNode | null;
  getAttribute(name: string): string | null;
  readonly parentElement: ClickNode | null;
  readonly tagName: string;
  readonly textContent: string | null;
}

/** Plain interactions: a button, link, menu item, tab or option. A clickable `<div>` is not one; give it a role. */
const INTERACTIVE = 'a[href], button, input[type="submit"], input[type="button"], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]';
const CLICK_LABEL_MAX = 40;
const CLICK_PATH_MAX = 4;
/** Set `data-capture="off"` on an element, or an ancestor, to keep its clicks out of the stream. */
const CLICK_OPT_OUT = '[data-capture="off"]';

/**
 * What one click on the hosted pages looks like in the stream, or null when it says nothing: not an interactive
 * element, opted out, no visible name, or outside every `data-testid` container (an event nobody can place is noise).
 * `label` is the control's `aria-label` or its text, whitespace folded, cut to {@link CLICK_LABEL_MAX}; `path` is the
 * containers' test ids from the outside in (`guide > pager`). Never a field value, never a URL.
 */
export function clickCapture(target: ClickNode | null | undefined): { label: string; path: string; element: string } | null {
  const el = target?.closest?.(INTERACTIVE);
  if (!el || el.closest?.(CLICK_OPT_OUT)) return null;
  const raw = el.getAttribute('aria-label') ?? (el.tagName === 'INPUT' ? el.getAttribute('value') : el.textContent) ?? '';
  const label = raw.replace(/\s+/g, ' ').trim().slice(0, CLICK_LABEL_MAX);
  const ids: string[] = [];
  for (let n: ClickNode | null = el; n; n = n.parentElement) {
    const id = n.getAttribute('data-testid');
    if (id) ids.unshift(id);
  }
  const path = ids.slice(-CLICK_PATH_MAX).join(' > ');
  if (!label || !path) return null;
  return { label, path, element: el.getAttribute('role') ?? el.tagName.toLowerCase() };
}

/** The one global listener for plain clicks (capture phase, so a handler that stops propagation cannot hide one). */
function watchClicks(): void {
  document.addEventListener('click', (e) => {
    const captured = clickCapture(e.target as unknown as ClickNode | null);
    if (captured) trackSite({ name: 'click', ...captured });
  }, { capture: true });
}
