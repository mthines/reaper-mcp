# Guides

These are the pages on the hosted site at `/docs`, and the source of `/llms.txt`. GitHub renders them as they are.

Each guide is one `.md` file with frontmatter:

```yaml
---
title: Install and connect
nav: Install
summary: One sentence, used in the nav tooltip, on the index page and in llms.txt.
section: start
order: 3
youtube: dQw4w9WgXcQ
poster: media/x.webp
duration: 3 min
image: media/x.png
---
```

A value runs to the end of its line, so never put a `# comment` after one. What each field is:

- `nav` (optional): a shorter name for the sidebar when the title is long.
- `section`: `start`, `safe`, `try` or `know`.
- `order`: the position inside the section, unique.
- `youtube` (optional): the 11-character video id, not a URL. Without it the page says "Video coming soon".
- `poster` (optional): the still shown before the video plays.
- `duration` (optional): for example `3 min`.
- `image` (optional): a picture for the guide's card when it has no video.

Writing them:

- A casual, plain voice for musicians new to AI. The assistant helps; it doesn't compose or replace anyone's ears.
- Recipes in `section: try` end their steps with a `> your-call:` line and give a prompt to copy as `> say: …`.
- Link to another guide as `[text](other-guide.md)`. Put images in `media/` and use `![alt](media/file.webp)`.
- A collapsed block is `::: details Title` … `:::`. Put each video's transcript in one.
- A carousel of cards is `::: gallery Title` … `:::` around a list: one `- ![alt](media/file.webp) **Name**: what it does` per card, the picture optional (a card without one shows its name). GitHub shows it as a plain list.
- Add the guide's facts to the code or docs they came from first. If a page and the code disagree, the code wins.

`apps/bridge-ui/src/features/docs/docs.test.ts` checks every guide (frontmatter, links, images, the recipe template). `pnpm dev:bridge` serves them at `http://localhost:8098/docs`.
