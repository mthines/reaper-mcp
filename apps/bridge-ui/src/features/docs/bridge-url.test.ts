import { describe, expect, it } from 'vitest';
import { parseBridgeUrl, withoutBridgeQuery } from './useDocs.js';

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

describe('the address bar once the bridge link is read', () => {
  it('drops ?bridge= and keeps the path, other query keys and the hash', () => {
    expect(withoutBridgeQuery({ pathname: '/docs/install', search: '?bridge=http%3A%2F%2F127.0.0.1%3A8099%2Fmcp_bridge.html', hash: '#step-2' })).toBe('/docs/install#step-2');
    expect(withoutBridgeQuery({ pathname: '/docs', search: '?bridge=x&page=docs', hash: '' })).toBe('/docs?page=docs');
  });

  it('leaves an address without one alone', () => {
    expect(withoutBridgeQuery({ pathname: '/docs', search: '?page=docs', hash: '' })).toBeUndefined();
    expect(withoutBridgeQuery({ pathname: '/docs', search: '', hash: '#top' })).toBeUndefined();
  });
});
