import { useEffect, useState } from 'react';
import { load, save } from '../../lib/storage.js';
import type { ChangeGroup, ChangelogRelease } from './changelog.js';

/**
 * Highlights: hand-made changelog entries that show a feature (an animation, a graphic or a screenshot) above the
 * plain release notes. They live in `apps/bridge-ui/changelog/highlights.json` with their media beside it, written by
 * the `/changelog-highlight` skill. The page reads them from `main` on GitHub, so a release newer than the installed
 * one shows its highlights before the update; the dev server reads the working tree's copy instead.
 */
export const HIGHLIGHTS_URL = 'https://raw.githubusercontent.com/mthines/reaper-mcp/main/apps/bridge-ui/changelog/highlights.json';
const CACHE_KEY = 'mcp-bridge-highlights';
const CACHE_TTL_MS = 6 * 3600_000;

export type HighlightKind = 'animation' | 'graphic' | 'screenshot';

export interface Highlight {
  id: string;
  /** The pull request that shipped it: the highlight shows on the release that lists it */
  pr?: number;
  /** Or the release itself, for a highlight written before its pull request had a number */
  version?: string;
  kind: HighlightKind;
  /** The release-notes group it belongs to: tints the card */
  group: Extract<ChangeGroup, 'new' | 'fixes' | 'faster'>;
  title: string;
  /** One or two sentences in the user's words */
  blurb: string;
  /** Where to find it, e.g. "⌘K → What’s new" */
  tryIt?: string;
  /** Absolute URL of the media file */
  media: string;
  /** A still frame for an animation: shown before it plays and with reduced motion */
  poster?: string;
  alt: string;
}

const KINDS: HighlightKind[] = ['animation', 'graphic', 'screenshot'];
const GROUPS = ['new', 'fixes', 'faster'];
/** Media sits next to the index, under media/, in a format an <img> or <video> plays everywhere */
export const MEDIA_PATH = /^media\/[a-z0-9][a-z0-9-]*\.(webp|png|svg|mp4|webm)$/;
const VIDEO = /\.(mp4|webm)$/;

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** The index's valid highlights, media resolved against `indexUrl`; an entry with anything wrong is left out. */
export function parseHighlights(json: unknown, indexUrl: string): Highlight[] {
  const list = (json as { highlights?: unknown })?.highlights;
  if (!Array.isArray(list)) return [];
  const out: Highlight[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id, 80);
    const title = str(raw.title, 60);
    const blurb = str(raw.blurb, 220);
    const alt = str(raw.alt, 200);
    const media = typeof raw.media === 'string' && MEDIA_PATH.test(raw.media) ? raw.media : null;
    const poster = typeof raw.poster === 'string' && MEDIA_PATH.test(raw.poster) && !VIDEO.test(raw.poster) ? raw.poster : undefined;
    const kind = KINDS.find((k) => k === raw.kind);
    const group = GROUPS.find((g) => g === raw.group) as Highlight['group'] | undefined;
    const pr = typeof raw.pr === 'number' && Number.isInteger(raw.pr) && raw.pr > 0 ? raw.pr : undefined;
    const version = typeof raw.version === 'string' && /^\d+\.\d+\.\d+$/.test(raw.version) ? raw.version : undefined;
    if (!id || !title || !blurb || !alt || !media || !kind || !group || (pr === undefined && version === undefined)) continue;
    // An animation is a video or an animated SVG; a screenshot is never a video
    if (kind === 'screenshot' && VIDEO.test(media)) continue;
    out.push({
      id,
      pr,
      version,
      kind,
      group,
      title,
      blurb,
      tryIt: str(raw.tryIt, 80) ?? undefined,
      media: new URL(media, indexUrl).href,
      poster: poster ? new URL(poster, indexUrl).href : undefined,
      alt,
    });
  }
  return out;
}

export const isVideo = (h: Highlight) => !h.media.startsWith('data:') && VIDEO.test(h.media.split(/[?#]/)[0]);

/** The highlights a release shows: those for a pull request it lists, or for its version. */
export function highlightsFor(release: ChangelogRelease, highlights: Highlight[]): Highlight[] {
  const prs = new Set(release.changes.map((c) => c.pr).filter((n): n is number => n !== null));
  return highlights.filter((h) => (h.pr !== undefined && prs.has(h.pr)) || h.version === release.version);
}

/**
 * The highlights, fetched while `enabled` (the drawer is open). Production reads `main` on GitHub (cached 6 hours);
 * the dev server reads the working tree's file on every open, so an author sees an entry as they write it.
 */
export function useHighlights(enabled: boolean): Highlight[] {
  const dev = import.meta.env.DEV;
  const [highlights, setHighlights] = useState<Highlight[]>(() => (dev ? [] : (readCache()?.highlights ?? [])));
  useEffect(() => {
    if (!enabled) return;
    const cached = dev ? null : readCache();
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return;
    const indexUrl = dev ? new URL('/changelog/highlights.json', location.origin).href : HIGHLIGHTS_URL;
    let cancelled = false;
    fetch(indexUrl, { cache: dev ? 'no-store' : 'default' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: unknown) => {
        if (cancelled) return;
        const next = parseHighlights(json, indexUrl);
        if (!dev) save(CACHE_KEY, JSON.stringify({ at: Date.now(), highlights: next }));
        setHighlights(next);
      })
      .catch(() => {
        // offline or not published yet: the plain release notes are enough
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, dev]);
  return highlights;
}

function readCache(): { at: number; highlights: Highlight[] } | null {
  try {
    const raw = load(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.highlights) ? parsed : null;
  } catch {
    return null;
  }
}
