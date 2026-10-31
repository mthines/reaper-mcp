import { useEffect, useState } from 'react';
import type { BridgeUpdate } from './status.js';

export type BridgeAction = 'update' | 'rebuild' | 'restart';

export const RELEASES_API = 'https://api.github.com/repos/mthines/reaper-mcp/releases/latest';
export const RELEASE_KEY = 'mcp-bridge-latest-release';
const RELEASE_TTL_MS = 6 * 3600_000; // unauthenticated GitHub API allows 60 requests an hour

/** -1, 0 or 1 for two `x.y.z` versions (a leading `v` and any `-pre` suffix are ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Ask the bridge to update or restart. The token is only readable from the status feed, so other sites can't. */
export function controlUrl(action: BridgeAction, token: string): string {
  return `/_/SET/EXTSTATE/MCPBridge/request/${action}-${token}`;
}

export function updateLog(update: BridgeUpdate | undefined): string[] {
  return Array.isArray(update?.log) ? update.log : [];
}

export interface Release {
  version: string;
  url: string;
}

/** The latest GitHub release, cached per browser for 6 hours; null until known or when offline. */
export function useLatestRelease(enabled: boolean): Release | null {
  const [release, setRelease] = useState<Release | null>(() => readCache()?.release ?? null);
  useEffect(() => {
    if (!enabled) return;
    const cached = readCache();
    if (cached && Date.now() - cached.at < RELEASE_TTL_MS) return;
    let cancelled = false;
    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { tag_name?: string; html_url?: string } | null) => {
        if (cancelled || !body?.tag_name || !body.html_url) return;
        const next = { version: body.tag_name.replace(/^v/, ''), url: body.html_url };
        try {
          localStorage.setItem(RELEASE_KEY, JSON.stringify({ at: Date.now(), release: next }));
        } catch {
          /* storage blocked: check again next load */
        }
        setRelease(next);
      })
      .catch(() => {
        /* offline: no notice */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return release;
}

function readCache(): { at: number; release: Release } | null {
  try {
    const raw = localStorage.getItem(RELEASE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
