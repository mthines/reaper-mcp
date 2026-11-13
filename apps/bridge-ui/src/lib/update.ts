import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BridgeUpdate } from './status.js';

export type BridgeAction = 'update' | 'rebuild' | 'restart';

export const RELEASES_API = 'https://api.github.com/repos/mthines/reaper-mcp/releases/latest';
/** What `npm install -g` resolves against: the abbreviated package document (the registry allows browser origins). Not its
 * `/latest` shortcut, which once named a release `npm install` could not find. */
export const NPM_PACKAGE_API = 'https://registry.npmjs.org/@mthines%2Freaper-mcp';
export const RELEASE_KEY = 'mcp-bridge-latest-release';
const RELEASE_TTL_MS = 6 * 3600_000; // unauthenticated GitHub API allows 60 requests an hour

/** Where this install gets its releases: npm for an npm install (a GitHub release npm hasn't published can't be installed), GitHub for a clone */
export type ReleaseSource = 'npm' | 'clone';

/**
 * The update to offer, or null: a release newer than `current`, unless this is a developer install (it rebuilds from its
 * working tree instead), the user skipped that version, or an update is running or just failed (the notice shows its
 * progress or Try again). The header pill, ⋯ menu, palette and notice all read this.
 */
export function updateOffer(
  release: Release | null,
  current: string,
  { dev, skipped, update, ready = false }: { dev: boolean; skipped: string | null; update?: BridgeUpdate; ready?: boolean },
): Release | null {
  if (!release || dev || skipped === release.version) return null;
  // An update is running, failed (the notice has Try again), or is installed and waiting for this page to reload
  if (update?.state === 'running' || update?.state === 'failed' || ready) return null;
  return compareVersions(release.version, current) > 0 ? release : null;
}

let updateReady = false;
const readyListeners = new Set<() => void>();

/** An update finished while this page was open: its version is installed, this page is the old one until it reloads. */
export function markUpdateReady(): void {
  updateReady = true;
  readyListeners.forEach((listener) => listener());
}

export function resetUpdateReady(): void {
  updateReady = false;
  readyListeners.forEach((listener) => listener());
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    () => updateReady,
    () => false,
  );
}

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

/** The latest release this install can get (see ReleaseSource), cached per browser for 6 hours; null until known or when offline. */
export function useLatestRelease(enabled: boolean, source: ReleaseSource = 'clone'): Release | null {
  const key = cacheKey(source);
  const [release, setRelease] = useState<Release | null>(() => readCache(key)?.release ?? null);
  const [shownKey, setShownKey] = useState(key);
  // The source is known once the bridge's status arrives: switch to that source's cached release while rendering
  if (shownKey !== key) {
    setShownKey(key);
    setRelease(readCache(key)?.release ?? null);
  }
  useEffect(() => {
    if (!enabled) return;
    const cached = readCache(key);
    if (cached && Date.now() - cached.at < RELEASE_TTL_MS) return;
    let cancelled = false;
    fetch(source === 'npm' ? NPM_PACKAGE_API : RELEASES_API, {
      headers: { Accept: source === 'npm' ? 'application/vnd.npm.install-v1+json' : 'application/vnd.github+json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { tag_name?: string; html_url?: string; 'dist-tags'?: { latest?: string }; versions?: Record<string, unknown> } | null) => {
        const version = source === 'npm' ? installableNpmVersion(body) : body?.tag_name?.replace(/^v/, '');
        if (cancelled || !version || !/^\d+\.\d+\.\d+$/.test(version)) return;
        const url = source === 'npm' ? `https://github.com/mthines/reaper-mcp/releases/tag/v${version}` : body?.html_url;
        if (!url) return;
        const next = { version, url };
        try {
          localStorage.setItem(key, JSON.stringify({ at: Date.now(), release: next }));
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
  }, [enabled, key, source]);
  return release;
}

/** npm's `latest`, only when the version list holds it too: the registry's own shortcuts have named releases `npm install` could not find. */
export function installableNpmVersion(doc: { 'dist-tags'?: { latest?: string }; versions?: Record<string, unknown> } | null | undefined): string | undefined {
  const latest = doc?.['dist-tags']?.latest;
  return latest && /^\d+\.\d+\.\d+$/.test(latest) && doc?.versions && latest in doc.versions ? latest : undefined;
}

function cacheKey(source: ReleaseSource): string {
  return source === 'npm' ? `${RELEASE_KEY}-npm` : RELEASE_KEY;
}

function readCache(key: string): { at: number; release: Release } | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
