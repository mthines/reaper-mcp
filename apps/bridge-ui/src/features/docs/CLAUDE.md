# The guides page (`/docs`)

Guides for musicians new to AI, as a page on the hosted build (`BRIDGE_HOSTED=1`, Vercel). The source is Markdown in
[`docs/guides/`](../../../../../docs/guides/README.md) (frontmatter and writing rules are there); this folder draws it.
The REAPER page never bundles the guides: the hosted build copies them next to the page and writes `docs/index.json`,
`/llms.txt` and `/llms-full.txt` (`hostedDocs()` in `vite.config.ts`, rendering in `docs.ts`).

- **`docs.ts`** is pure: frontmatter parsing, section order (`SECTIONS`), previous/next, headings, the `llms.txt` text. A bad
  guide throws `guide "slug": …`, so the hosted build fails instead of shipping it.
- **`useDocs.ts`** fetches the index and a guide, reads the slug from the path, and holds the bridge link (`?bridge=`, only
  an `http://localhost` / `127.0.0.1` `…/mcp_bridge.html` address, remembered in localStorage). Never ping REAPER's web port
  from the hosted page: stray connections leak its sockets. The way back to the bridge exists only for someone who came from it.
- **Palette**: `GuideCommands` registers "Docs…" (each guide a child, found by a search from the top level). The bridge page
  asks the hosted site for the list the first time the palette opens (`useRemoteGuideIndex`), never at load.
- **Markdown** renders with `MarkdownDoc` (`components/Markdown.tsx`): `> say:` → `PromptBox`, `> your-call:` → `YourCall`,
  fenced code → `CodeBlock`, relative images only. Add a new block type there and here together.
- **The video** is a click-to-load facade: nothing reaches Google until a viewer presses play (`youtube-nocookie.com`).
- No usage analytics here: the hosted page is always the demo, so telemetry is off.
- Follow `.claude/rules/command-palette.md` for palette commands. Stories and play-function tests: `DocsPage.stories.tsx`,
  `DocsPage.test.stories.tsx`; `docs.test.ts` checks every real guide.
