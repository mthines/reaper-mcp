import { describe, expect, it } from 'vitest';
import { buildUrl, deserialise, serialise } from './url-state.js';

describe('url state helpers', () => {
  it('round-trips values and falls back on missing or malformed params', () => {
    expect(deserialise(serialise('1h'), '30m')).toBe('1h');
    expect(deserialise(null, '30m')).toBe('30m');
    expect(deserialise('1h', '30m')).toBe('30m');
  });

  it('writes the param and keeps the others', () => {
    expect(buildUrl('/mcp_bridge.html', '?demo', 'range', '1h', '30m')).toBe('/mcp_bridge.html?demo=&range=%221h%22');
  });

  it('drops the param when the value is the default', () => {
    expect(buildUrl('/mcp_bridge.html', '?range=%221h%22', 'range', '30m', '30m')).toBe('/mcp_bridge.html');
    expect(buildUrl('/p', '?range=%221h%22&app', 'range', '30m', '30m', '#x')).toBe('/p?app=#x');
  });
});
