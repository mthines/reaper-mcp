

export const REPO_URL = 'https://github.com/mthines/reaper-mcp';

/** The guides for musicians (docs/guides): the same pages the hosted site serves at /docs */
export const GUIDES_URL = `${REPO_URL}/tree/main/docs/guides`;

/**
 * Members of the reaper-mcp LoreKit org publish their records into the built-in layer straight from the
 * plugin drawer, without the GitHub contribution PR. LoreKit checks the membership on every write.
 */
export const DISCORD_URL = 'https://discord.gg/Eg8tznuXp4';

/** Where the guides are served: the hosted site (the REAPER page and the packaged page have no copy), the dev server's own under `pnpm dev:bridge` */
export const DOCS_SITE = import.meta.env.DEV ? '' : 'https://reaper-mcp.vercel.app';

/**
 * A guide on the hosted site. `bridge` is where this bridge page lives (REAPER's own web address), handed over so the
 * guides can offer a way back: it never leaves the viewer's browser except in this link's query.
 */
export function guideUrl(slug?: string, bridge?: string): string {
  const base = `${DOCS_SITE}/docs${slug ? `/${slug}` : ''}`;
  return bridge ? `${base}?bridge=${encodeURIComponent(bridge)}` : base;
}
