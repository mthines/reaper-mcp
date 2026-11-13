import { describe, expect, it } from 'vitest';
import { parseBridgeUrl } from './useDocs.js';

describe('the bridge address the guides link back to', () => {
  it('accepts REAPER’s own page on this machine', () => {
    expect(parseBridgeUrl('http://127.0.0.1:8099/mcp_bridge.html')).toBe('http://127.0.0.1:8099/mcp_bridge.html');
    expect(parseBridgeUrl('http://localhost:8098/mcp_bridge.html?demo')).toBe('http://localhost:8098/mcp_bridge.html');
  });

  it('refuses any other site, scheme or page', () => {
    expect(parseBridgeUrl('https://evil.example/mcp_bridge.html')).toBeUndefined();
    expect(parseBridgeUrl('http://127.0.0.1.evil.example/mcp_bridge.html')).toBeUndefined();
    expect(parseBridgeUrl('javascript:alert(1)')).toBeUndefined();
    expect(parseBridgeUrl('http://127.0.0.1:8099/other.html')).toBeUndefined();
    expect(parseBridgeUrl(null)).toBeUndefined();
  });
});
