import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ init: vi.fn(), sendEvent: vi.fn(), startView: vi.fn(), identify: vi.fn(), addSignalAttribute: vi.fn(), startSessionRecording: vi.fn() }));
vi.mock('@dash0/sdk-web', () => sdk);
const rrweb = vi.hoisted(() => ({ recorder: vi.fn() }));
vi.mock('@dash0/sdk-web/session-recording', () => rrweb);

import { clickCapture, type ClickNode, domOperation, errorType, eventAttributes, isTranslated, pageErrorEvent, scrollMilestone, scrubSiteUrl, scrubUrl, siteAnalyticsState, siteCtaOf, siteEventAttributes, usageStatsState } from './analytics.js';

/** A fake element: its own attributes, its parent, and `closest` as the browser answers it for the selectors the listener uses. */
function el(tag: string, text: string, attrs: Record<string, string> = {}, parent: ClickNode | null = null): ClickNode {
  const self: ClickNode = {
    tagName: tag.toUpperCase(),
    textContent: text,
    parentElement: parent,
    getAttribute: (n) => attrs[n] ?? null,
    closest: (sel) => {
      if (!sel.includes('data-capture')) return self;
      for (let n: ClickNode | null = self; n; n = n.parentElement) if (n.getAttribute('data-capture') === 'off') return n;
      return null;
    },
  };
  return self;
}
const header = el('header', '', { 'data-testid': 'site-header' });
const docsNav = el('nav', '', { 'data-testid': 'docs-nav' }, header);

describe('click autocapture', () => {
  it('names a plain click by its text and the containers it sits in', () => {
    expect(clickCapture(el('a', '  What’s \n new ', { href: '/changelog' }, docsNav))).toEqual({ label: 'What’s new', path: 'site-header > docs-nav', element: 'a' });
  });

  it('prefers the aria-label, and cuts a long label to 40 characters', () => {
    expect(clickCapture(el('button', 'x', { 'aria-label': 'Close' }, docsNav))?.label).toBe('Close');
    expect(clickCapture(el('button', 'a'.repeat(100), {}, docsNav))?.label).toHaveLength(40);
  });

  it('never sends what a field holds', () => {
    expect(clickCapture(el('input', '', { type: 'submit', value: 'Search' }, docsNav))?.label).toBe('Search');
  });

  it('says nothing for a click that cannot be placed or named, or that opted out', () => {
    expect(clickCapture(el('button', 'Copy'))).toBeNull(); // no data-testid container
    expect(clickCapture(el('button', '   ', {}, docsNav))).toBeNull(); // no name
    expect(clickCapture(el('button', 'Copy', {}, el('div', '', { 'data-testid': 'x', 'data-capture': 'off' })))).toBeNull();
    expect(clickCapture(null)).toBeNull();
  });
});

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

  it('names the DOM call a browser DOM error came from, in Chromium and Firefox, and nothing else from the message', () => {
    const chromium = new DOMException("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.", 'NotFoundError');
    expect(domOperation(chromium)).toBe('Node.removeChild');
    expect(domOperation(new DOMException('Node.insertBefore: Child to insert before is not a child of this node', 'NotFoundError'))).toBe('Node.insertBefore');
    // Safari's message names no call; a TypeError in the same shape is not a DOM error; a quote that isn't a name is dropped
    expect(domOperation(new DOMException('The object can not be found here.', 'NotFoundError'))).toBeUndefined();
    expect(domOperation(new TypeError("Failed to execute 'fetch' on 'Window': http://192.168.1.20:8099/x"))).toBeUndefined();
    expect(domOperation(new DOMException("Failed to execute 'My Track.wav' on 'Node'", 'NotFoundError'))).toBeUndefined();
  });

  it('tells a page a browser translated from the English page it ships as', () => {
    expect(isTranslated({ className: 'translated-ltr', lang: 'vi' })).toBe(true);
    expect(isTranslated({ className: 'translated-rtl', lang: 'en' })).toBe(true);
    expect(isTranslated({ className: '', lang: 'es' })).toBe(true);
    expect(isTranslated({ className: '', lang: 'en' })).toBe(false);
    expect(isTranslated({ className: '', lang: 'en-GB' })).toBe(false);
    expect(isTranslated({ className: 'not-translated-ltr', lang: '' })).toBe(false);
    expect(isTranslated(null)).toBe(false);
  });

  it('describes a page error by its kind, where it was caught, the failing DOM call and translation, and nothing more', () => {
    const removeChild = new DOMException("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.", 'NotFoundError');
    expect(eventAttributes(pageErrorEvent(removeChild, 'boundary', { className: 'translated-ltr', lang: 'vi' }))).toEqual({
      'bridge_ui.type': 'NotFoundError',
      'bridge_ui.source': 'boundary',
      'bridge_ui.translated': true,
      'bridge_ui.operation': 'Node.removeChild',
    });
    expect(eventAttributes(pageErrorEvent(new TypeError('secret track name'), 'uncaught', { className: '', lang: 'en' }))).toEqual({
      'bridge_ui.type': 'TypeError',
      'bridge_ui.source': 'uncaught',
      'bridge_ui.translated': false,
    });
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

  it('sends uncaught errors, rejections and errors the boundary caught as page errors, only while on', async () => {
    vi.stubGlobal('document', { documentElement: { className: 'translated-ltr', lang: 'vi' } });
    const a = await import('./analytics.js');
    a.trackPageError(new DOMException("Failed to execute 'removeChild' on 'Node': gone", 'NotFoundError'), 'boundary');
    expect(sdk.sendEvent).not.toHaveBeenCalled(); // not started yet
    a.startAnalytics(false);
    const listeners = Object.fromEntries((window.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map(([type, fn]) => [type, fn]));
    listeners.error({ error: new TypeError('secret track name') });
    listeners.unhandledrejection({ reason: 'a thrown string' });
    a.trackPageError(new DOMException("Failed to execute 'removeChild' on 'Node': gone", 'NotFoundError'), 'boundary');
    expect(sdk.sendEvent.mock.calls).toEqual([
      ['bridge_ui.page_error', { attributes: { 'bridge_ui.type': 'TypeError', 'bridge_ui.source': 'uncaught', 'bridge_ui.translated': true }, severity: 'ERROR' }],
      ['bridge_ui.page_error', { attributes: { 'bridge_ui.type': 'non_error', 'bridge_ui.source': 'rejection', 'bridge_ui.translated': true }, severity: 'ERROR' }],
      [
        'bridge_ui.page_error',
        { attributes: { 'bridge_ui.type': 'NotFoundError', 'bridge_ui.source': 'boundary', 'bridge_ui.translated': true, 'bridge_ui.operation': 'Node.removeChild' }, severity: 'ERROR' },
      ],
    ]);
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
    expect(siteCtaOf('http://[::1]:8099/mcp_bridge.html')).toBe('bridge');
    expect(siteCtaOf('http://reaper.localhost:8099/mcp_bridge.html')).toBe('bridge');
    expect(siteCtaOf('/docs/what-this-is')).toBeNull();
    expect(siteCtaOf('#heading')).toBeNull();
    expect(siteCtaOf('https://www.youtube-nocookie.com/embed/x')).toBeNull();
  });

  it('namespaces event attributes under site.', () => {
    expect(siteEventAttributes({ name: 'code_copied', lang: 'bash' })).toEqual({ 'site.lang': 'bash' });
  });

  describe('starting', () => {
    const store = new Map<string, string>();
    const listeners: Record<string, EventListener[]> = {};
    const fire = (type: string, e: unknown) => (listeners[type] ?? []).forEach((fn) => fn(e as Event));

    beforeEach(() => {
      vi.resetModules();
      Object.values(sdk).forEach((f) => f.mockReset());
      store.clear();
      vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('location', { pathname: '/docs/install', search: '' });
      vi.stubGlobal('window', { addEventListener: vi.fn(), scrollY: 0, innerHeight: 100 });
      vi.stubGlobal('document', { documentElement: { scrollHeight: 1000 }, addEventListener: (type: string, fn: EventListener) => (listeners[type] ??= []).push(fn) });
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
        sessionRecording: { maskAllInputs: true, maskTextSelector: '[role="listbox"]' },
        // handed to init, so the first page view carries them too
        additionalSignalAttributes: { 'user.id': store.get('reaper_site.visitor_id'), 'site.page': 'docs' },
      });
      expect(opts.enabledInstrumentations).toEqual(expect.arrayContaining(['@dash0/navigation', '@dash0/error', '@dash0/session-recording']));
      await vi.waitFor(() => expect(sdk.startSessionRecording).toHaveBeenCalledWith(rrweb.recorder));

      a.trackSite({ name: 'prompt_copied' });
      expect(sdk.sendEvent).toHaveBeenCalledWith('site.prompt_copied', { attributes: {} });
    });

    it('counts a click on a call to action, wherever it is on the page', async () => {
      const a = await import('./analytics.js');
      a.startSiteAnalytics('docs');
      fire('click', { target: el('a', 'Discord', { href: 'https://discord.gg/abc' }) });
      expect(sdk.sendEvent).toHaveBeenCalledWith('site.cta_clicked', { attributes: { 'site.cta': 'discord' } });
    });

    it('records a plain click with its name and where on the page it sits', async () => {
      const a = await import('./analytics.js');
      a.startSiteAnalytics('docs');
      fire('click', { target: el('button', 'Copy', {}, el('div', '', { 'data-testid': 'guide' })) });
      expect(sdk.sendEvent).toHaveBeenCalledWith('site.click', { attributes: { 'site.label': 'Copy', 'site.path': 'guide', 'site.element': 'button' } });
    });

    it('sends each scroll milestone once per page, and starts again for a guide opened without a reload', async () => {
      const win = { addEventListener: vi.fn(), scrollY: 0, innerHeight: 100 };
      const loc = { pathname: '/docs/install', search: '' };
      vi.stubGlobal('window', win);
      vi.stubGlobal('location', loc);
      // A browser runs the frame later, so scroll events in between are folded into one measurement
      const frames: Array<() => void> = [];
      vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn));
      const a = await import('./analytics.js');
      a.startSiteAnalytics('docs');
      const listener = win.addEventListener.mock.calls.find(([type]) => type === 'scroll')?.[1] as () => void;
      const onScroll = () => {
        listener();
        listener();
        frames.splice(0).forEach((fn) => fn());
      };
      const depths = () => sdk.sendEvent.mock.calls.filter(([name]) => name === 'site.scroll_depth').map(([, opts]) => opts.attributes['site.depth']);

      win.scrollY = 400; // the bottom of the window at 50% of a 1000px page
      onScroll();
      expect(depths()).toEqual([25, 50]);
      onScroll();
      expect(depths()).toEqual([25, 50]);
      win.scrollY = 900;
      onScroll();
      expect(depths()).toEqual([25, 50, 75, 100]);

      loc.pathname = '/docs/first-session';
      win.scrollY = 150;
      onScroll();
      expect(depths()).toEqual([25, 50, 75, 100, 25]);
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
