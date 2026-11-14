/**
 * What a link to the hosted site looks like when it is shared (Discord, Slack, iMessage, social): the title, the line
 * under it and a 1200x630 picture, one per kind of page. Crawlers read the HTML and never run the page, so the hosted
 * build writes one HTML file per kind with these tags in its head (`hostedShare()` in `vite.config.ts`).
 * The pictures are drawn by `scripts/og-images.mjs` and committed in `share/`.
 */
export type SharePage = 'bridge' | 'docs' | 'changelog';

export const SHARE: Record<SharePage, { title: string; description: string; image: string; path: string }> = {
  bridge: {
    title: 'reaper-mcp: see what your AI assistant does in REAPER',
    description: 'A live demo of the status window: every move the assistant makes in a REAPER session, with before and after.',
    image: 'share/og-bridge.png',
    path: '/',
  },
  docs: {
    title: 'reaper-mcp docs: a music assistant inside REAPER',
    description: 'Plain-language guides for musicians: install it, stay safe, and try it on your own mix. You make every call.',
    image: 'share/og-docs.png',
    path: '/docs',
  },
  changelog: {
    title: 'What’s new in reaper-mcp',
    description: 'Every release, with the changes shown instead of listed.',
    image: 'share/og-changelog.png',
    path: '/changelog',
  },
};

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The page's HTML with its title and share tags swapped in for `kind`. `origin` is the site's public address (images must be absolute URLs). */
export function withShareMeta(html: string, kind: SharePage, origin: string): string {
  const s = SHARE[kind];
  const image = `${origin}/${s.image}`;
  const tags = [
    ['name', 'description', s.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'reaper-mcp'],
    ['property', 'og:title', s.title],
    ['property', 'og:description', s.description],
    ['property', 'og:url', `${origin}${s.path}`],
    ['property', 'og:image', image],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', s.title],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', s.title],
    ['name', 'twitter:description', s.description],
    ['name', 'twitter:image', image],
  ]
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttr(value)}">`)
    .join('\n');
  return html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(s.title)}</title>\n${tags}`);
}
