import { describe, expect, it } from 'vitest';
import { guideUrl } from './links.js';

describe('guideUrl', () => {
  it('hands the bridge address over when the page is on this computer', () => {
    for (const here of ['http://localhost:8099/mcp_bridge.html', 'http://127.0.0.1:8099/mcp_bridge.html']) {
      expect(guideUrl('install', here)).toContain(`?bridge=${encodeURIComponent(here)}`);
    }
  });

  it('never sends a LAN address or host name to the docs site', () => {
    for (const here of ['http://192.168.1.20:8099/mcp_bridge.html', 'http://studio-mac.local:8099/mcp_bridge.html', 'not a url']) {
      expect(guideUrl('install', here)).not.toContain('bridge=');
    }
  });
});
