# Highlight house style

Every highlight sits in the same card (`apps/bridge-ui/src/features/changelog/HighlightCard.tsx`): a 16:10 stage on the
page background, a 1 px border and soft gradient tinted by `group`, the caption under it. Media is the only thing that
changes, so it must look like it belongs to the bridge page.

## Palette (the page's own tokens, `apps/bridge-ui/src/styles.css`)

| Token | Hex | Use in a graphic |
| --- | --- | --- |
| `--bg` | `#0e0f11` | The stage. Always the graphic's full-bleed background |
| `--panel-2` | `#1b1d21` | Boxes (a track, a plugin, a file) |
| `--line-2` | `#2f333a` | Box borders, quiet wires |
| `--text` | `#e7e9ec` | Labels |
| `--muted` | `#8a909a` | Secondary labels, units |
| `--accent` | `#7cc4ff` | The thing that changed, the signal, "now" |
| `--h1` | `#c4a5ff` | The accent's gradient partner (`#7cc4ff → #c4a5ff`) |
| `--live` | `#4ade80` | Success, a fix landing, "ok" |
| `--warn` | `#f5b84b` | Speed, a level near the limit |
| `--bad` | `#f87171` | The old problem, "before", an error |

At most one accent colour plus one state colour per graphic. "Before" is dashed or hollow, "now" is solid accent, as in
the bridge drawer.

## Type and layout (graphics, `viewBox="0 0 1600 1000"`)

- Font: `-apple-system, Inter, 'Segoe UI', sans-serif`; mono `ui-monospace, 'SF Mono', Menlo, monospace` for values.
- Sizes: labels 44, secondary 32, never below 28 (the card shows it at a quarter of its size).
- Keep 120 px clear on every side; centre the idea; two to four elements, one idea.
- Corners: boxes `rx="28"`, chips `rx="999"`. Strokes 3 (quiet) or 6-10 (the signal).
- Gradients on strokes use `gradientUnits="userSpaceOnUse"`: in the default bounding-box units a straight horizontal or
  vertical line has zero height or width, and its gradient stroke silently paints nothing.
- No drop shadows on text; a single soft glow (`filter` blur on a copy) for the accent element is the most it gets.

## Motion

- One moving thing per highlight: the flow along a wire, a value rising, a panel sliding in.
- Graphics: 1-3 s loops, `ease-in-out`, nothing that strobes or flashes more than 3 times a second.
- Clips: 4-8 s, start on the action, hold the result ~1.5 s before the loop.
- Every animation has a poster (the result frame), shown with reduced motion.

## Words

- Title: what the user gets, ≤ 60 characters, sentence case, no period.
- Blurb: one or two sentences, before → after or what it lets them do; plain words a musician uses.
- Never: "blazing", "seamless", "revolutionary", "powerful", exclamation marks, emoji.
