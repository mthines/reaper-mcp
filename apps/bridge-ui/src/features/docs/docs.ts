import { headingId } from '../../lib/heading-id.js';

/**
 * The guides: Markdown files in `docs/guides/` with a small frontmatter block. Pure functions only (no React, no
 * browser), because the hosted build's vite plugin reads the same files to write `docs/pages.json` and `llms.txt`.
 */

/** The nav groups, in the order they are listed. The key is what a guide's `section:` says. */
export const SECTIONS = [
  { key: 'start', title: 'Getting started', blurb: 'From nothing to your first conversation with it, in order.' },
  { key: 'safe', title: 'Safety and privacy', blurb: 'Undo, privacy and what it can’t do. Read these before you trust it with a session.' },
  { key: 'try', title: 'Things to try', blurb: 'Pick one. Each has a short video, the steps written down, and a line to copy.' },
  { key: 'know', title: 'Reference', blurb: 'For when you need a word explained or something stops working.' },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['key'];

export interface GuideMeta {
  /** The file name without `.md`, and the page's path under /docs */
  slug: string;
  title: string;
  /** A shorter name for the sidebar and palette, when the title is long */
  nav?: string;
  /** One sentence: the nav tooltip, the link text on index pages and the `llms.txt` line */
  summary: string;
  section: SectionKey;
  /** Position inside its section */
  order: number;
  /** A YouTube video id; a guide without one shows "Video coming soon" */
  youtube?: string;
  /** Still image for the video, relative to the guide folder (`media/…`) */
  poster?: string;
  /** A picture for the guide's card on the front page, for a guide with no video (`media/…`) */
  image?: string;
  /** "4 min" */
  duration?: string;
}

export interface Guide extends GuideMeta {
  body: string;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const YOUTUBE_ID = /^[\w-]{11}$/;
const MEDIA = /^media\/[\w./-]+$/;

/** Split `---` frontmatter from the Markdown body. A file without it, or with an unclosed block, is refused. */
export function splitFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const text = raw.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) throw new Error('missing frontmatter (--- … ---) at the top of the file');
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([a-z][\w-]*):\s*(.*)$/i.exec(line);
    if (!kv) throw new Error(`frontmatter line is not "key: value": ${line}`);
    data[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: text.slice(m[0].length).replace(/^\n+/, '') };
}

/** A guide from its file name and contents; throws a message naming the slug when anything is off. */
export function parseGuide(slug: string, raw: string): Guide {
  const fail = (why: string): never => {
    throw new Error(`guide "${slug}": ${why}`);
  };
  if (!SLUG.test(slug)) fail('the file name must be lower case words joined with dashes');
  let parsed: ReturnType<typeof splitFrontmatter>;
  try {
    parsed = splitFrontmatter(raw);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const { data, body } = parsed;
  if (!data.title) fail('missing title');
  if (!data.summary) fail('missing summary');
  const section = SECTIONS.find((s) => s.key === data.section)?.key;
  if (!section) fail(`section must be one of ${SECTIONS.map((s) => s.key).join(', ')}`);
  const order = Number(data.order);
  if (!Number.isInteger(order) || order < 1) fail('order must be a whole number from 1');
  if (data.youtube && !YOUTUBE_ID.test(data.youtube)) fail('youtube must be the 11-character video id, not a URL');
  if (data.poster && !MEDIA.test(data.poster)) fail('poster must be a path under media/');
  if (data.image && !MEDIA.test(data.image)) fail('image must be a path under media/');
  if (!body.trim()) fail('the guide is empty');
  return {
    slug,
    title: data.title,
    nav: data.nav || undefined,
    summary: data.summary,
    section: section as SectionKey,
    order,
    youtube: data.youtube || undefined,
    poster: data.poster || undefined,
    image: data.image || undefined,
    duration: data.duration || undefined,
    body,
  };
}

/** Every guide in reading order: section by section, then `order`. */
export function sortGuides<T extends GuideMeta>(guides: T[]): T[] {
  const rank = (g: GuideMeta) => SECTIONS.findIndex((s) => s.key === g.section);
  return [...guides].sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.slug.localeCompare(b.slug));
}

/** The nav: sections that have guides, each with its guides in order. */
export function groupGuides<T extends GuideMeta>(guides: T[]): Array<{ key: SectionKey; title: string; blurb: string; guides: T[] }> {
  const sorted = sortGuides(guides);
  return SECTIONS.map((s) => ({ key: s.key, title: s.title, blurb: s.blurb, guides: sorted.filter((g) => g.section === s.key) })).filter((s) => s.guides.length > 0);
}

/** The guides before and after `slug` in reading order. */
export function neighbours<T extends GuideMeta>(guides: T[], slug: string): { previous?: T; next?: T } {
  const sorted = sortGuides(guides);
  const at = sorted.findIndex((g) => g.slug === slug);
  if (at < 0) return {};
  return { previous: sorted[at - 1], next: sorted[at + 1] };
}

/** The `##` headings of a guide, for its "On this page" list. Fenced code and `:::` blocks are skipped over correctly. */
export function pageHeadings(body: string): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  let fence: string | null = null;
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      fence = fence === null ? f[1] : line.trim().startsWith(fence) ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    const h = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) out.push({ id: headingId(h[1]), text: h[1].replace(/[`*_]/g, '') });
  }
  return out;
}

/** The page's embed: `https://www.youtube-nocookie.com/embed/<id>`, which sets no cookie until the viewer plays it. */
export function embedUrl(youtube: string): string {
  return `https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0`;
}

const BLURB =
  'reaper-mcp lets an AI assistant (Claude Code, Codex CLI, Gemini CLI or Cursor) work inside a live REAPER session: it measures, mixes, edits and builds plugins while you stay in charge. It is an assistant, not a composer. These guides are written for musicians who are new to AI.';

/** `llms.txt`: what this is, then every guide with its one-line summary and a link to the raw Markdown. */
export function renderLlmsTxt(guides: GuideMeta[], origin = ''): string {
  const lines = ['# reaper-mcp', '', `> ${BLURB}`, ''];
  for (const section of groupGuides(guides)) {
    lines.push(`## ${section.title}`, '');
    for (const g of section.guides) lines.push(`- [${g.title}](${origin}/docs/${g.slug}.md): ${g.summary}`);
    lines.push('');
  }
  lines.push('## Optional', '', `- [Everything on one page](${origin}/llms-full.txt): every guide, in reading order`, '- [Source and tool reference](https://github.com/mthines/reaper-mcp): the repository, with docs/TOOLS.md', '');
  return lines.join('\n');
}

/**
 * A guide's relative links (`install.md#x`, `media/x.png`) only work beside the guide; on one page at the site root they
 * would 404, so they become absolute links to the `/docs/` files.
 */
function absoluteLinks(body: string, origin: string): string {
  return body.replace(/(!?\[[^\]]*\]\()(?:\.\/)?((?:media\/)?[a-z0-9][a-z0-9./-]*?(?:\.md|\.[a-z0-9]+)?(?:#[\w-]+)?)\)/gi, (whole, open: string, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
    return `${open}${origin}/docs/${target}\u0029`;
  });
}

/** `llms-full.txt`: every guide in reading order, one after another. */
export function renderLlmsFull(guides: Guide[], origin = ''): string {
  const parts = [`# reaper-mcp docs`, '', `> ${BLURB}`, ''];
  for (const g of sortGuides(guides)) parts.push('---', '', `# ${g.title}`, '', `${g.summary}`, '', absoluteLinks(g.body.trim(), origin), '');
  return parts.join('\n');
}
