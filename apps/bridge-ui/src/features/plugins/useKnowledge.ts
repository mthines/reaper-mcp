import { useEffect, useState } from 'react';
import { track } from '../../lib/analytics.js';
import { fetchRecords, parseInstalled, parseUsed, publishRecord } from './lorekit.js';
import type { InstalledFx, KnowledgeFeed, PluginRecord, UsedFx } from './plugins.js';
import { parseExtStateKey } from '../../lib/status.js';

declare const __LOREKIT_TOKEN__: string;
declare const __LOREKIT_API__: string;

// The project's FX change while mixing; the installed list only when plugins are (re)scanned
const USED_POLL_MS = 5_000;
const INSTALLED_EVERY = 6;
const RECORDS_REFRESH_MS = 10 * 60_000;
export const LOREKIT_TOKEN_KEY = 'mcp_bridge.lorekit_token';
/** The viewer's lk_rw_ token for publishing into the built-in layer (reaper-mcp org members only) */
export const LOREKIT_PUBLISH_TOKEN_KEY = 'mcp_bridge.lorekit_publish_token';

export function loadLoreKitToken(key = LOREKIT_TOKEN_KEY): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveLoreKitToken(token: string | null, key = LOREKIT_TOKEN_KEY): void {
  try {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // per-viewer convenience only
  }
}

/**
 * The live Plugins feed: installed FX from the bridge (ExtState `installed`, republished by the bridge
 * when it changes) joined with plugin records read from LoreKit. Undefined until the bridge has
 * published its list, so the tab stays hidden on a bridge that predates it.
 */
export function useKnowledge(enabled: boolean, userToken: string | null, publishToken: string | null = null): KnowledgeFeed | undefined {
  const [installed, setInstalled] = useState<{ supported: boolean; fx: InstalledFx[] } | null>(null);
  const [builtIn, setBuiltIn] = useState<{ records: PluginRecord[]; error?: string } | null>(null);
  const [user, setUser] = useState<{ records: PluginRecord[]; error?: string } | null>(null);
  const [used, setUsed] = useState<UsedFx[] | undefined>(undefined);
  // Bumped after a publish so both layers are read again straight away
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let n = 0;
    let haveInstalled = false;
    const tick = async () => {
      if (!document.hidden) {
        const withInstalled = !haveInstalled || n % INSTALLED_EVERY === 0;
        n += 1;
        try {
          const res = await fetch(`/_/GET/EXTSTATE/MCPBridge/used${withInstalled ? ';GET/EXTSTATE/MCPBridge/installed' : ''}`, { cache: 'no-store' });
          const body = await res.text();
          const nextUsed = parseUsed(parseExtStateKey(body, 'used'));
          if (!cancelled && nextUsed) setUsed(nextUsed);
          const next = withInstalled ? parseInstalled(parseExtStateKey(body, 'installed')) : null;
          if (!cancelled && next) {
            haveInstalled = true;
            setInstalled(next);
          }
        } catch {
          // bridge unreachable: keep the last lists
        }
      }
      if (!cancelled) timer = setTimeout(tick, USED_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);

  const ready = enabled && installed !== null;

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const load = () =>
      fetchRecords(__LOREKIT_API__, __LOREKIT_TOKEN__, 'built-in', ctrl.signal).then(
        (records) => setBuiltIn({ records }),
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          track({ name: 'knowledge_load_failed', layer: 'built-in' });
          setBuiltIn((prev) => ({ records: prev?.records ?? [], error: errorText(e) }));
        },
      );
    load();
    const id = setInterval(load, RECORDS_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [ready, reload]);

  useEffect(() => {
    setUser(null);
    if (!ready || !userToken) return;
    const ctrl = new AbortController();
    const load = () =>
      fetchRecords(__LOREKIT_API__, userToken, 'user', ctrl.signal).then(
        (records) => setUser({ records }),
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          track({ name: 'knowledge_load_failed', layer: 'user' });
          setUser({ records: [], error: errorText(e) });
        },
      );
    load();
    const id = setInterval(load, RECORDS_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [ready, userToken, reload]);

  if (!ready || !installed) return undefined;
  const problems = [
    !installed.supported && 'This REAPER can’t list its installed plugins (needs REAPER 6.37 or newer).',
    builtIn?.error && `Built-in records couldn’t be loaded: ${builtIn.error}.`,
    user?.error && `Your records couldn’t be loaded: ${user.error}.`,
  ].filter(Boolean);
  return {
    installed: installed.fx,
    records: [...(builtIn?.records ?? []), ...(user?.records ?? [])],
    installedSupported: installed.supported,
    userLayer: !userToken ? 'off' : user?.error ? 'error' : 'on',
    problem: problems.length ? problems.join(' ') : undefined,
    used,
    publish: publishToken
      ? async (record, options) => {
          const result = await publishRecord(__LOREKIT_API__, publishToken, record, options);
          setReload((n) => n + 1);
          return result;
        }
      : undefined,
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, '');
