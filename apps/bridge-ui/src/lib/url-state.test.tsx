// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isString, useUrlState, type UrlStateDispatch } from './url-state.js';

// React's act() needs this flag outside a test renderer
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RANGES = ['30m', '1h', '24h'];
const isRange = (v: unknown): v is string => isString(v) && RANGES.includes(v);

let root: Root;
let range: string;
let setRange: UrlStateDispatch<string>;
let view: string;
let setView: UrlStateDispatch<string>;
let query: string;
let setQuery: UrlStateDispatch<string>;

// Hands the hook's current values to the test after each render
function Page() {
  const [r, setR] = useUrlState('range', '30m', { validate: isRange });
  const [v, setV] = useUrlState('view', 'calls', { validate: isString });
  const [q, setQ] = useUrlState('q', '', { validate: isString, navigationMode: 'replace', debounceMs: 50 });
  useLayoutEffect(() => {
    [range, setRange, view, setView, query, setQuery] = [r, setR, v, setV, q, setQ];
  });
  return null;
}

const open = (url: string) => {
  history.replaceState(null, '', url);
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root.render(<Page />));
};
const settle = () => act(async () => undefined);
const back = () => act(async () => {
  history.back();
  await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
});

beforeEach(() => history.replaceState(null, '', '/mcp_bridge.html'));
afterEach(() => act(() => root.unmount()));

describe('state kept in the URL', () => {
  it('reads the value from the link, and the default without it', () => {
    open('/mcp_bridge.html?range=%221h%22');
    expect(range).toBe('1h');
    expect(view).toBe('calls');
  });

  it('falls back to the default for a stale or hand-edited link', () => {
    open('/mcp_bridge.html?range=%22forever%22');
    expect(range).toBe('30m');
    open('/mcp_bridge.html?range=not-json');
    expect(range).toBe('30m');
  });

  it('writes a change to the URL, keeping the other params, and drops a value equal to the default', async () => {
    open('/mcp_bridge.html?demo');
    act(() => setRange('1h'));
    await settle();
    expect(range).toBe('1h');
    expect(location.search).toBe('?demo=&range=%221h%22');
    act(() => setRange('30m'));
    await settle();
    expect(location.search).toBe('?demo=');
  });

  it('steps back through changes, one history entry per tick', async () => {
    open('/mcp_bridge.html');
    const before = history.length;
    act(() => {
      setRange('1h');
      setView('tools'); // same tick: one entry
    });
    await settle();
    expect(history.length).toBe(before + 1);
    await back();
    expect([range, view]).toEqual(['30m', 'calls']);
  });

  it('replaces the entry when asked, so Back skips it', async () => {
    open('/mcp_bridge.html');
    const before = history.length;
    act(() => setView('tools', 'replace'));
    await settle();
    expect(history.length).toBe(before);
    expect(view).toBe('tools');
  });

  it('shows a debounced change at once and writes the URL once typing pauses', async () => {
    open('/mcp_bridge.html');
    await act(async () => {
      setQuery('r');
      setQuery('re');
      setQuery('read');
    });
    expect(query).toBe('read');
    expect(location.search).toBe('');
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(location.search).toBe('?q=%22read%22');
  });

  it('writes a debounced change with the next change that is not, as one history entry', async () => {
    open('/mcp_bridge.html');
    await act(async () => setQuery('lufs'));
    await act(async () => setView('tools'));
    expect(location.search).toBe('?q=%22lufs%22&view=%22tools%22');
    await back();
    expect([view, query]).toEqual(['calls', '']);
  });

  it('drops a debounced change still waiting when Back is pressed', async () => {
    open('/mcp_bridge.html');
    act(() => setView('tools'));
    await settle();
    await act(async () => setQuery('lufs'));
    await back();
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect([view, query, location.search]).toEqual(['calls', '', '']);
  });
});
