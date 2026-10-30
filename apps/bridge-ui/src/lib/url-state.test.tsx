// @vitest-environment jsdom
import { act } from 'react';
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

function Page() {
  [range, setRange] = useUrlState('range', '30m', { validate: isRange });
  [view, setView] = useUrlState('view', 'calls', { validate: isString });
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
    setRange('1h');
    await settle();
    expect(range).toBe('1h');
    expect(location.search).toBe('?demo=&range=%221h%22');
    setRange('30m');
    await settle();
    expect(location.search).toBe('?demo=');
  });

  it('steps back through changes, one history entry per tick', async () => {
    open('/mcp_bridge.html');
    const before = history.length;
    setRange('1h');
    setView('tools'); // same tick: one entry
    await settle();
    expect(history.length).toBe(before + 1);
    await back();
    expect([range, view]).toEqual(['30m', 'calls']);
  });

  it('replaces the entry when asked, so Back skips it', async () => {
    open('/mcp_bridge.html');
    const before = history.length;
    setView('tools', 'replace');
    await settle();
    expect(history.length).toBe(before);
    expect(view).toBe('tools');
  });
});
