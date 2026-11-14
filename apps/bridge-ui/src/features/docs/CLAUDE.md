# The guides page (`/docs`)

Guides for musicians new to AI, as a page on the hosted build (`BRIDGE_HOSTED=1`, Vercel). The source is Markdown in
[`docs/guides/`](../../../../../docs/guides/README.md) (frontmatter and writing rules are there); this folder draws it.
The REAPER page never bundles the guides: the hosted build copies them next to the page and writes `docs/pages.json`,
`/llms.txt` and `/llms-full.txt` (`hostedDocs()` in `vite.config.ts`, rendering in `docs.ts`).

- **`docs.ts`** is pure: frontmatter parsing, section order (`SECTIONS`), previous/next, headings, the `llms.txt` text. A bad
  guide throws `guide "slug": …`, so the hosted build fails instead of shipping it.
- **`useDocs.ts`** fetches the index and a guide, reads the slug from the path, and holds the bridge link (`?bridge=`, only
  an `http://localhost` / `127.0.0.1` `…/mcp_bridge.html` address, remembered in localStorage, then dropped from the
  address bar, since page views send the referrer). Never ping REAPER's web port
  from the hosted page: stray connections leak its sockets. The way back to the bridge exists only for someone who came from it.
- **Palette**: `GuideCommands` registers "Docs…" (each guide a child, found by a search from the top level). The bridge page
  asks the hosted site for the list the first time the palette opens (`useRemoteGuideIndex`), never at load.
- **Markdown** renders with `MarkdownDoc` (`components/Markdown.tsx`): `> say:` → `PromptBox`, `> your-call:` → `YourCall`,
  fenced code → `CodeBlock`, relative images only. Add a new block type there and here together.
- **The video** is a click-to-load facade: nothing reaches Google until a viewer presses play (`youtube-nocookie.com`).
- **Usage analytics and session replay** run here on the hosted build (`startSiteAnalytics()` in `src/lib/analytics.ts`,
  started from `main.tsx`; service `reaper-mcp-site`): page views, errors, fetch timings, rage clicks, a replay with every
  input masked, and the `site.*` events in `tracking-plan.yaml` (`trackSite()`: copy, video, scroll depth, links followed, and every plain click through the one listener in `analytics.ts`: give a new control a name and keep it inside a `data-testid` container, add no tracker call; `data-capture="off"` opts out).
  Add an event there and in `SiteEvent` together. The query (`?bridge=`) is scrubbed from URL attributes, not from the replay, which records the page address and the link back to the bridge; the demo at `/` stays silent.
- Follow `.claude/rules/command-palette.md` for palette commands. Stories and play-function tests: `DocsPage.stories.tsx`,
  `DocsPage.test.stories.tsx`; `docs.test.ts` checks every real guide.
