import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ init: vi.fn(), sendEvent: vi.fn(), startView: vi.fn(), identify: vi.fn(), addSignalAttribute: vi.fn(), startSessionRecording: vi.fn() }));
vi.mock('@dash0/sdk-web', () => sdk);
const rrweb = vi.hoisted(() => ({ recorder: vi.fn() }));
vi.mock('@dash0/sdk-web/session-recording', () => rrweb);

import { errorType, eventAttributes, scrollMilestone, scrubSiteUrl, scrubUrl, siteAnalyticsState, siteCtaOf, siteEventAttributes, usageStatsState } from './analytics.js';

describe('usageStatsState', () => {
  const base = { demo: false, stored: null, nav: {}, configured: true };

  it('is on by default, like the server telemetry', () => {
    expect(usageStatsState(base)).toEqual({ on: true });
    expect(usageStatsState({ ...base, stored: '1' })).toEqual({ on: true });
  });

  it('is off when the viewer turned it off, the browser asks not to be tracked, in the demo, or with no destination', () => {
    expect(usageStatsState({ ...base, stored: '0' })).toEqual({ on: false, reason: 'user' });
    expect(usageStatsState({ ...base, nav: { globalPrivacyControl: true } })).toEqual({ on: false, reason: 'browser' });
    expect(usageStatsState({ ...base, nav: { doNotTrack: '1' } })).toEqual({ on: false, reason: 'browser' });
    expect(usageStatsState({ ...base, demo: true })).toEqual({ on: false, reason: 'demo' });
    expect(usageStatsState({ ...base, configured: false })).toEqual({ on: false, reason: 'unconfigured' });
  });
});

describe('event shape', () => {
  it('namespaces the attributes and leaves the name out', () => {
    expect(eventAttributes({ name: 'plugin_opened', coverage: 'learned', in_project: true, formats: 3 })).toEqual({
      'bridge_ui.coverage': 'learned',
      'bridge_ui.in_project': true,
      'bridge_ui.formats': 3,
    });
  });

  it('reports only the kind of an error, never its message', () => {
    expect(errorType(new TypeError('secret track name'))).toBe('TypeError');
    expect(errorType('a thrown string')).toBe('non_error');
    expect(errorType(Object.assign(new Error('x'), { name: 'has spaces and <html>' }))).toBe('non_error');
  });

  it('drops host, port and query from the page URL', () => {
    expect(scrubUrl({ 'url.full': 'http://192.168.1.20:8099/mcp_bridge.html?install', 'url.domain': '192.168.1.20', 'url.query': 'install' })).toEqual({
      'url.full': '/mcp_bridge.html',
      'url.path': '/mcp_bridge.html',
    });
  });
});

describe('sending', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    Object.values(sdk).forEach((f) => f.mockReset());
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    vi.stubGlobal('__VERSION__', '0.0.0-test');
    vi.stubGlobal('__DASH0_ENDPOINT__', 'https://ingress.test');
    vi.stubGlobal('__DASH0_DATASET__', 'reaper-mcp');
    vi.stubGlobal('__DASH0_TOKEN__', 'auth_test');
  });

  it('starts the SDK with web vitals only, records the first view, and sends namespaced events', async () => {
    const a = await import('./analytics.js');
    expect(a.startAnalytics(false, 'calls')).toEqual({ on: true });
    const opts = sdk.init.mock.calls[0][0];
    expect(opts).toMatchObject({ serviceName: 'reaper-mcp-bridge-ui', endpoint: { url: 'https://ingress.test', authToken: 'auth_test', dataset: 'reaper-mcp' } });
    // fetch/xhr would trace the bridge polling; navigation and error bodies carry the full page URL
    expect(opts.enabledInstrumentations).toEqual(['@dash0/web-vitals']);
    expect(sdk.startView).toHaveBeenCalledWith('/calls');
    expect(sdk.identify).toHaveBeenCalledWith(store.get('mcp_bridge.install_id'));

    a.track({ name: 'log_filtered', filter: 'errors' });
    expect(sdk.sendEvent).toHaveBeenCalledWith('bridge_ui.log_filtered', { attributes: { 'bridge_ui.filter': 'errors' }, severity: undefined });
    a.trackView('plugins');
    expect(sdk.startView).toHaveBeenCalledWith('/plugins');
  });

  it('marks a failed publish as an error', async () => {
    const a = await import('./analytics.js');
    a.startAnalytics(false);
    a.track({ name: 'plugin_publish_completed', outcome: 'refused', removed_copy: false, replaced: true });
    expect(sdk.sendEvent.mock.calls[0][1].severity).toBe('ERROR');
  });

  it('sends nothing when turned off, and stops at once when the viewer turns it off', async () => {
    store.set('mcp_bridge.usage_stats', '0');
    const a = await import('./analytics.js');
    expect(a.startAnalytics(false)).toEqual({ on: false, reason: 'user' });
    a.track({ name: 'log_cleared' });
    a.trackView('calls');
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.sendEvent).not.toHaveBeenCalled();

    expect(a.setUsageStats(true, false)).toEqual({ on: true });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    a.setUsageStats(false, false);
    a.track({ name: 'log_cleared' });
    expect(sdk.sendEvent.mock.calls.map((c) => c[0])).toEqual(['bridge_ui.setting_changed']); // only the opt-in itself
  });
});

describe('the hosted site', () => {
  it('is measured on the hosted build only, unless the browser asks not to be tracked', () => {
    const base = { hosted: true, configured: true, nav: {} };
    expect(siteAnalyticsState(base)).toEqual({ on: true });
    expect(siteAnalyticsState({ ...base, hosted: false }).on).toBe(false);
    expect(siteAnalyticsState({ ...base, configured: false }).on).toBe(false);
    expect(siteAnalyticsState({ ...base, nav: { globalPrivacyControl: true } })).toEqual({ on: false, reason: 'browser' });
    expect(siteAnalyticsState({ ...base, nav: { doNotTrack: '1' } })).toEqual({ on: false, reason: 'browser' });
  });

  it('drops the query, which can carry the viewer\'s local bridge address, and keeps the public path and fragment', () => {
    const scrubbed = scrubSiteUrl({
      'url.full': 'https://reaper-mcp.vercel.app/docs/install?bridge=http%3A%2F%2Flocalhost%3A8099%2Fmcp_bridge.html#somethings-off',
      'url.path': '/docs/install',
      'url.query': 'bridge=http%3A%2F%2Flocalhost%3A8099%2Fmcp_bridge.html',
      'url.fragment': 'somethings-off',
    });
    expect(scrubbed['url.full']).toBe('https://reaper-mcp.vercel.app/docs/install#somethings-off');
    expect(scrubbed['url.path']).toBe('/docs/install');
    expect(scrubbed['url.query']).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('localhost');
  });

  it('names the deepest scroll milestone reached, and none for a page that fits the window', () => {
    expect(scrollMilestone(0, 800, 800)).toBeNull();
    expect(scrollMilestone(0, 100, 1000)).toBeNull();
    expect(scrollMilestone(150, 100, 1000)).toBe(25);
    expect(scrollMilestone(650, 100, 1000)).toBe(75);
    expect(scrollMilestone(900, 100, 1000)).toBe(100);
  });

  it('tells the links worth counting apart from the rest', () => {
    expect(siteCtaOf('/')).toBe('demo');
    expect(siteCtaOf('/mcp_bridge.html?demo')).toBe('demo');
    expect(siteCtaOf('/docs/install')).toBe('install');
    expect(siteCtaOf('/changelog')).toBe('changelog');
    expect(siteCtaOf('https://github.com/mthines/reaper-mcp')).toBe('github');
    expect(siteCtaOf('https://github.com/mthines/reaper-mcp/issues')).toBe('issues');
    expect(siteCtaOf('https://github.com/mthines/reaper-mcp/releases')).toBe('releases');
    expect(siteCtaOf('https://discord.gg/abc')).toBe('discord');
    expect(siteCtaOf('http://localhost:8099/mcp_bridge.html')).toBe('bridge');
    expect(siteCtaOf('/docs/what-this-is')).toBeNull();
    expect(siteCtaOf('#heading')).toBeNull();
    expect(siteCtaOf('https://www.youtube-nocookie.com/embed/x')).toBeNull();
  });

  it('namespaces event attributes under site.', () => {
    expect(siteEventAttributes({ name: 'code_copied', lang: 'bash' })).toEqual({ 'site.lang': 'bash' });
  });

  describe('starting', () => {
    const store = new Map<string, string>();
    const listeners: Record<string, EventListener> = {};

    beforeEach(() => {
      vi.resetModules();
      Object.values(sdk).forEach((f) => f.mockReset());
      store.clear();
      vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('location', { pathname: '/docs/install', search: '' });
      vi.stubGlobal('window', { addEventListener: vi.fn(), scrollY: 0, innerHeight: 100 });
      vi.stubGlobal('document', { documentElement: { scrollHeight: 1000 }, addEventListener: (type: string, fn: EventListener) => (listeners[type] = fn) });
      vi.stubGlobal('requestAnimationFrame', (fn: () => void) => (fn(), 1));
      vi.stubGlobal('__HOSTED__', true);
      vi.stubGlobal('__VERSION__', '0.0.0-test');
      vi.stubGlobal('__DASH0_ENDPOINT__', 'https://ingress.test');
      vi.stubGlobal('__DASH0_DATASET__', 'reaper-mcp');
      vi.stubGlobal('__DASH0_TOKEN__', 'auth_test');
      vi.stubGlobal('__SITE_ENV__', 'preview');
      vi.stubGlobal('__SITE_VCS__', { refHeadName: 'main' });
    });

    it('starts the SDK as its own service with page views, errors and a masked session replay', async () => {
      const a = await import('./analytics.js');
      expect(a.startSiteAnalytics('docs')).toEqual({ on: true });
      const opts = sdk.init.mock.calls[0][0];
      expect(opts).toMatchObject({
        serviceName: 'reaper-mcp-site',
        environment: 'preview',
        vcs: { refHeadName: 'main' },
        endpoint: { url: 'https://ingress.test', authToken: 'auth_test', dataset: 'reaper-mcp' },
        sessionRecording: { maskAllInputs: true },
      });
      expect(opts.enabledInstrumentations).toEqual(expect.arrayContaining(['@dash0/navigation', '@dash0/error', '@dash0/session-recording']));
      expect(sdk.identify).toHaveBeenCalledWith(store.get('reaper_site.visitor_id'));
      expect(sdk.addSignalAttribute).toHaveBeenCalledWith('site.page', 'docs');
      await vi.waitFor(() => expect(sdk.startSessionRecording).toHaveBeenCalledWith(rrweb.recorder));

      a.trackSite({ name: 'prompt_copied' });
      expect(sdk.sendEvent).toHaveBeenCalledWith('site.prompt_copied', { attributes: {} });
    });

    it('counts a click on a call to action, wherever it is on the page', async () => {
      const a = await import('./analytics.js');
      a.startSiteAnalytics('docs');
      const link = { getAttribute: () => 'https://discord.gg/abc' };
      listeners.click({ target: { closest: () => link } } as unknown as Event);
      expect(sdk.sendEvent).toHaveBeenCalledWith('site.cta_clicked', { attributes: { 'site.cta': 'discord' } });
    });

    it('sends nothing off the hosted build or when the browser asks not to be tracked', async () => {
      vi.stubGlobal('navigator', { globalPrivacyControl: true });
      const a = await import('./analytics.js');
      expect(a.startSiteAnalytics('changelog')).toEqual({ on: false, reason: 'browser' });
      a.trackSite({ name: 'video_played' });
      expect(sdk.init).not.toHaveBeenCalled();
      expect(sdk.sendEvent).not.toHaveBeenCalled();

      vi.resetModules();
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('__HOSTED__', false);
      const b = await import('./analytics.js');
      expect(b.startSiteAnalytics('docs').on).toBe(false);
      expect(sdk.init).not.toHaveBeenCalled();
    });
  });
});
