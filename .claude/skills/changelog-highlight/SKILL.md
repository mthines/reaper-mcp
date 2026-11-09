---
name: changelog-highlight
description: Writes a highlight for the bridge page's What's new drawer — a short title and sentence plus an animation, graphic or screenshot that shows the feature — in the house style, then checks it renders. Use when a feature or fix is worth showing users ("add a changelog highlight for this", "show this off in What's new", "/changelog-highlight").
---

# Changelog highlight

A highlight is a hand-made changelog entry that **shows** a change instead of listing it: one card in the bridge page's
What's new drawer, above that release's plain notes. Every card has the same frame (a 16:10 stage, a title, one or two
sentences, an optional "Try it"), so the creativity goes into the media, never the layout.

Entries live in `apps/bridge-ui/changelog/highlights.json` with their media in `apps/bridge-ui/changelog/media/`. The page
reads them from `main` on GitHub, so a release newer than what a user runs shows its highlights **before** they update.
The dev server reads the working tree's copy, so you see your entry as you write it.

House style, palette and motion rules: [`references/style.md`](./references/style.md) — read it before making media.

## 1. Pick what to show

Read the PR (`gh pr view <n> --json title,body,files`) or the branch diff. Write down, in one sentence, what a musician
can now do or no longer suffers. No sentence → no highlight: plain release notes are enough for chores, refactors, docs.

One highlight per feature, at most two per release. A fix earns one only when users felt the bug.

## 2. Pick the medium

| The change | Kind | How |
| --- | --- | --- |
| Visible on the bridge page and it **moves** (a drawer, a toggle, a live meter, a flow of steps) | `animation`, `.mp4` | Record it from `?demo` (§ 3a) |
| Visible on the page but static (a new card, a new readout, a layout) | `screenshot`, `.webp` | Capture it from `?demo` (§ 3a) |
| Not on the page: a tool, the bridge, the sidecar, speed, a concept (routing, a render pass, an undo rule) | `graphic`, `.svg` (animated SVG for `animation`) | Draw it from the template (§ 3b) |

The page in `?demo` draws every tool from `src/demo/` fixtures; if the feature's view is not in the demo, add its example
there first (the repo needs it anyway, see `apps/bridge-ui/src/demo/CLAUDE.md`).

## 3a. Record or capture the page

Start this worktree's dev server (another may hold 8098; pick a free port):

```bash
BRIDGE_DEV_PORT=8097 pnpm dev:bridge     # http://127.0.0.1:8097/mcp_bridge.html?demo
```

Then script what a viewer does, with Playwright selectors:

```bash
node apps/bridge-ui/scripts/changelog-capture.mjs --url http://127.0.0.1:8097/mcp_bridge.html --params demo \
  --crop 560,0,720,450 \
  --steps '[{"wait":700},{"click":"role=button[name=\"Update available\"]"},{"wait":1700},{"click":"text=Show betas"},{"wait":1500}]' \
  --duration 7 --out apps/bridge-ui/changelog/media/<id>.mp4 --poster apps/bridge-ui/changelog/media/<id>.webp
```

- **Crop to the feature** (`--crop x,y,w,h` of the 1280×800 page, keep it 16:10: `720,450` or `960,600`). The card is
  ~400 px wide; a whole page there is unreadable. Clips are recorded at 1×, so a crop is also what keeps them sharp.
- A clip is 4-8 s and loops: start where the action starts, end on the result held for ~1.5 s.
- `--poster` (required for an animation) is the still shown with reduced motion and before it plays.
- A screenshot is the same command with a `.webp` `--out` and no `--duration`; `--clip <selector>` crops to an element.
- Look at what you made: `ffmpeg -i <clip> -vf "fps=1,tile=4x2" -frames:v 1 /tmp/sheet.png`, then read the image.
  Re-record until every frame reads at card size.

## 3b. Draw a graphic

Copy [`templates/graphic.svg`](./templates/graphic.svg) to `apps/bridge-ui/changelog/media/<id>.svg` and replace its
example with the idea: two to four labelled shapes and what flows between them. Keep its `viewBox`, palette and type
sizes. For an `animation`, animate one thing (the flow, a value rising) with SMIL or CSS inside the SVG, 1-3 s, looping;
then export a still as the poster:

```bash
node apps/bridge-ui/scripts/changelog-capture.mjs --url file://$PWD/apps/bridge-ui/changelog/media/<id>.svg --params '' --out apps/bridge-ui/changelog/media/<id>.webp
```

An SVG is drawn in an `<img>`, so it can't run script or load anything; the test refuses scripts, event handlers, links
and outside URLs anyway.

## 4. Write the entry

Add it to `highlights.json`, newest first:

```json
{
  "id": "whats-new-drawer",
  "pr": 104,
  "kind": "animation",
  "group": "new",
  "title": "What’s new, right on the bridge page",
  "blurb": "A pill tells you when a new release is out. Open it to see every change and update in one click.",
  "tryIt": "Update available, or ⌘K → What’s new",
  "media": "media/whats-new-drawer.mp4",
  "poster": "media/whats-new-drawer.webp",
  "alt": "The Update available pill opens the What’s new drawer, then the betas toggle shows the betas."
}
```

| Field | Rule |
| --- | --- |
| `pr` / `version` | The PR that ships it (the card shows on the release that lists `(#pr)`). Before the PR has a number, `version` (the next release, `x.y.z`); switch to `pr` once it exists |
| `group` | `new` (feat), `fixes` (fix) or `faster` (perf): tints the card like the release notes' groups |
| `title` | ≤ 60 characters, what the user gets, sentence case, no period, no jargon ("Sends render in one pass", not "perf(render): stem pass") |
| `blurb` | ≤ 220 characters, one or two sentences in the user's words: the before/after or what it lets them do |
| `tryIt` | Where to find it, as keys or a path ("⌘K → What’s new", "Plugins → Teach") |
| `alt` | What the media shows, for a screen reader and for when it fails to load |

Voice: the bridge drawer's ([`.claude/rules/bridge-drawer.md`](../../rules/bridge-drawer.md)): plain words a musician
uses, numbers with units, no marketing ("blazing", "revolutionary"), no exclamation marks.

## 5. Check it

```bash
pnpm --dir apps/bridge-ui exec vitest run src/features/changelog   # entry valid, media present, under the size limits, SVG safe
```

Then open `http://127.0.0.1:8097/mcp_bridge.html?demo&changelog=true`: the card shows on the release it names. The demo's
releases are fixed (`exampleReleaseJson()` in `apps/bridge-ui/src/demo/examples.ts`), so a new `pr` matches none of them:
add `(#<pr>)` to a line of the demo's next release (the running version's next minor) in the same change, or check with
`version` set to that next minor and switch to `pr` before committing. Click the stage to see it enlarged. Check it at reduced motion too
(macOS: System Settings → Accessibility → Display → Reduce motion): the poster, never a frozen first frame.

Commit the entry and its media with the feature's PR (`docs(changelog): highlight <feature>`). It goes live on the page
when the PR merges into `main`.

## Hard rules

- **Real UI only.** Record the page as it ships, from `?demo` fixtures; never mock a screen in a graphic or edit a capture.
- **One frame for every card.** Never style a card's layout per entry; vary the media only.
- **Media stay small.** Clips ≤ 1.5 MB (aim ≤ 400 KB), stills ≤ 400 KB, SVG ≤ 60 KB; the test enforces it.
- **No names from a user's session** in a capture: demo data only, never the user's projects, tracks or tokens.
