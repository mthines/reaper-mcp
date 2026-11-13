import { useEffect, useRef, useState } from 'react';
import { parseGuide, sortGuides, SECTIONS, type Guide, type GuideMeta } from './docs.js';

export type IndexState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; guides: GuideMeta[] };
export type GuideState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; guide: Guide };

/** `docs/index.json` as the hosted build writes it: every guide's frontmatter. Bad rows are dropped, never trusted. */
export function parseIndex(json: unknown): GuideMeta[] {
  if (!Array.isArray(json)) return [];
  const out: GuideMeta[] = [];
  for (const row of json as Array<Record<string, unknown>>) {
    const section = SECTIONS.find((s) => s.key === row?.section)?.key;
    if (typeof row?.slug !== 'string' || typeof row.title !== 'string' || typeof row.summary !== 'string' || !section || !Number.isInteger(row.order)) continue;
    out.push({
      slug: row.slug,
      title: row.title,
      nav: typeof row.nav === 'string' ? row.nav : undefined,
      summary: row.summary,
      section,
      order: row.order as number,
      youtube: typeof row.youtube === 'string' ? row.youtube : undefined,
      poster: typeof row.poster === 'string' ? row.poster : undefined,
      image: typeof row.image === 'string' ? row.image : undefined,
      duration: typeof row.duration === 'string' ? row.duration : undefined,
    });
  }
  return sortGuides(out);
}

/** Where the guides are served from: beside the page on the hosted site (and under the dev server). */
export const DOCS_BASE = '/docs';

export function useGuideIndex(): IndexState {
  const [state, setState] = useState<IndexState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`${DOCS_BASE}/index.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: unknown) => !cancelled && setState({ status: 'ready', guides: parseIndex(json) }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** One guide's Markdown. A slug is fetched once it is known to be in the index, so an unknown one never hits the network. */
export function useGuide(slug: string | undefined): GuideState {
  const [loaded, setLoaded] = useState<{ slug: string; state: GuideState } | null>(null);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const load = async (): Promise<GuideState> => {
      const res = await fetch(`${DOCS_BASE}/${slug}.md`);
      if (res.status === 404) return { status: 'missing' };
      if (!res.ok) throw new Error(String(res.status));
      return { status: 'ready', guide: parseGuide(slug, await res.text()) };
    };
    load()
      .catch((): GuideState => ({ status: 'error' }))
      .then((state) => !cancelled && setLoaded({ slug, state }));
    return () => {
      cancelled = true;
    };
  }, [slug]);
  if (!slug) return { status: 'missing' };
  return loaded?.slug === slug ? loaded.state : { status: 'loading' };
}

/** The slug in `/docs/<slug>`, and a way to move without a reload. */
export function useDocsPath(): { slug: string | undefined; go: (slug: string | undefined, hash?: string) => void } {
  const read = () => /^\/docs\/([^/.]+)\/?$/.exec(location.pathname)?.[1];
  const [slug, setSlug] = useState(read);
  useEffect(() => {
    const onPop = () => setSlug(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (next: string | undefined, hash?: string) => {
    history.pushState(null, '', `${next ? `${DOCS_BASE}/${next}` : DOCS_BASE}${hash ?? ''}`);
    setSlug(next);
    // With an anchor the page scrolls to it once the guide has loaded (DocsPage); without one, to the top
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo({ top: 0 });
  };
  return { slug, go };
}

/**
 * The guide index from the hosted site, fetched the first time `enabled` turns true (the palette opening) and never
 * before: the bridge page asks nobody anything until a viewer goes looking for a guide.
 */
export function useRemoteGuideIndex(enabled: boolean, site: string): IndexState {
  const [state, setState] = useState<IndexState>({ status: 'loading' });
  const asked = useRef(false);
  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    fetch(`${site}${DOCS_BASE}/index.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: unknown) => setState({ status: 'ready', guides: parseIndex(json) }))
      .catch(() => setState({ status: 'error' }));
  }, [enabled, site]);
  return state;
}

const BRIDGE_KEY = 'reaper-mcp-bridge-url';

/** A bridge address the guides may link back to: this machine's own web interface page, nothing else. */
export function parseBridgeUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname.endsWith('.localhost');
    if (u.protocol !== 'http:' || !local || !/\/mcp_bridge\.html$/.test(u.pathname)) return undefined;
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * Where the bridge page this viewer came from lives, from `?bridge=` (written by the bridge's "Guides" entries) and
 * remembered in this browser, so the way back stays through every guide. Undefined for someone who didn't come from one.
 */
export function useBridgeLink(): string | undefined {
  const [url] = useState<string | undefined>(() => {
    const fromQuery = parseBridgeUrl(new URLSearchParams(window.location.search).get('bridge'));
    try {
      if (fromQuery) {
        window.localStorage.setItem(BRIDGE_KEY, fromQuery);
        return fromQuery;
      }
      return parseBridgeUrl(window.localStorage.getItem(BRIDGE_KEY));
    } catch {
      return fromQuery;
    }
  });
  return url;
}
