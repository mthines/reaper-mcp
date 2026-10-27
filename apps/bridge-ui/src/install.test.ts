import { describe, expect, it } from 'vitest';
import { manualInstallHint } from './install.js';

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
