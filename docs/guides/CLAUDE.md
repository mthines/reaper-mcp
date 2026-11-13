# Guides (`docs/guides/`)

Plain-language pages for musicians new to AI, served at `/docs` on the hosted site and readable on GitHub as they are.
Frontmatter, voice and the recipe template are in [`README.md`](README.md); the page that draws them is
[`apps/bridge-ui/src/features/docs/`](../../apps/bridge-ui/src/features/docs/CLAUDE.md).

- Check every fact against the code or `docs/SAFETY.md`, `TELEMETRY.md` and the skills first. If a guide and the code disagree, the code wins.
- A music assistant, never a composer or a replacement for ears. Casual, second person, at most one emoji, subtle humour in asides.
- A new or changed user-facing feature edits its guide in the same change; a new guide is one `.md` with frontmatter and a unique `order` in its section.
- Images go in `media/` (reuse `docs/assets/`); a `poster` for a video, an `image` for a guide without one.
- Run new prose through `/humanizer` before merging. `docs.test.ts` checks links, images, the recipe template and word count.
