import { afterEach, describe, expect, it, vi } from 'vitest';
import { installState, manualInstallHint } from './install.js';

describe('manualInstallHint', () => {
  const ua = {
    chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
  };
  it('names each browser’s install command', () => {
    expect(manualInstallHint(ua.chrome)).toMatch(/Chrome.*Install page as app/);
    expect(manualInstallHint(ua.edge)).toMatch(/Edge/);
    expect(manualInstallHint(ua.safari)).toMatch(/Add to Dock/);
    expect(manualInstallHint(ua.firefox)).toMatch(/can’t install/);
  });
});

describe('installState', () => {
  afterEach(() => vi.unstubAllGlobals());
  const as = (search: string, standalone: boolean) => {
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: standalone && q.includes('standalone') }) });
    vi.stubGlobal('location', { search });
    vi.stubGlobal('navigator', {});
  };
  it('tells the bridge’s --app window from the installed app', () => {
    as('?app=window', true);
    expect(installState()).toBe('window');
    as('?app', true);
    expect(installState()).toBe('installed');
  });
  it('is unavailable in a tab the browser gave no install prompt', () => {
    as('', false);
    expect(installState()).toBe('unavailable');
  });
});
