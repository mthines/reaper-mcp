import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ init: vi.fn(), sendEvent: vi.fn(), startView: vi.fn(), identify: vi.fn(), addSignalAttribute: vi.fn() }));
vi.mock('@dash0/sdk-web', () => sdk);

import { errorType, eventAttributes, scrubUrl, usageStatsState } from './analytics.js';

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
