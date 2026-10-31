---
description: How the bridge page drawer shows a tool call (summary sentence, card, legend, zoom)
paths: ["apps/bridge-ui/src/features/log/**", "apps/bridge-ui/src/features/edit-views/**", "apps/bridge-ui/src/features/measurements/**", "apps/bridge-ui/src/demo/**", "apps/bridge-ui/src/styles/chart.module.css"]
---

# Bridge page: how a tool call is shown

The status page's drawer explains one call an **AI agent** made in the user's REAPER session. The reader is a
musician watching an agent work: every part of the drawer answers "what did the agent do, to what, and what
changed?" in their words, before anything technical. Every tool follows the same layout and rules.

## Layout (top to bottom, the same for every tool)

1. **Head**: the tool's plain name (`TOOLS[c].title` in `apps/bridge-ui/src/features/log/tools.ts`, e.g.
   "Delete a track"), then the raw command as a small filter button and how long ago.
2. **Summary**: one sentence from the agent's side, `<agent> <did…>.` (`TOOLS[c].did`): who did what to what, and
   the answer or effect. A failed call says what was tried ("… tried to delete a track on “Old Vox”, and REAPER
   refused.") with the error under it.
3. **Card**: the visual, titled by what it shows ("Levels", "Timeline", "Modulation"; never "Result" or
   "Change"), with a note on the right: `before → after` for a write, `as it is now` for a read.
4. **Params**: the call's input as sent.
5. **Details** (closed): handler time, timestamps, session, sequence. Debugging facts never sit above the answer.

## Rules for the summary sentence (`did`)

- Past tense, following the agent's name: "deleted the track “Old Vox”", "read the levels on track 1: …".
- Name things as the user sees them in REAPER: track names in quotes, `track N` 1-based, "the master", plugin
  names without the `VST3:` prefix and vendor, times as `m:ss.s`, levels in dB.
- Give the answer, not just the action: a read says what it found (and a verdict when there's one, e.g. "within
  6 dB of clipping"); a write says the effect ("everything after it moved 16.0 s earlier").
- Compare with the previous call on the same target when the card does ("4.3 dB hotter than 30 s ago").
- Return `null` when the call carries too little to say more; the fallback reads `ran “<title>” on <target>`.
- Prefer what the bridge recorded (`r`, through `editViewOf()` / `measurementOf()`) over the params: params are
  cut at 400 chars (a list arrives as `"[…]"`), and `r` holds the names and the before/after ("turned the send to
  “Verb” on “Vox” down from −6.0 to −9.0 dB"). Count a list param only when it parsed; otherwise say "the items".
- Numbers as the readouts print them: a real minus sign (`−14`, `fmt()` / `signed()`), notes as `C4`, grids as
  "16th notes", pan as "30% left".
- Every sentence is checked: `tools.test.ts` renders one for every example and demo call and fails on
  `undefined`, `NaN`, empty quotes or a double space.

## Rules for the card

- **One title per kind**, typed `Record<kind, string>` (`TITLE` in `Measurement.tsx` / `EditViews.tsx`).
- **Every mark has a legend entry**, drawn like the mark itself (the swatch for a dashed line is a dashed line);
  two different marks never share a look. Name colours by meaning ("Within 6 dB of clipping"), and show an entry
  only when that mark is drawn.
- **Before is dashed or hollow, now is solid accent**, everywhere. A "Before" entry only appears when the earlier
  state draws differently from now.
- **Each number once.** The card's readouts hold the numbers; bars and curves don't repeat them as text. The
  summary sentence may restate the one number that answers the question.
- **Labels in full words, never truncated**: shorten the word, don't let it ellipsize ("Tracks", not "Tracks
  touch…"); no abbreviations a musician wouldn't use ("Plugin", not "FX"; "Baseline", not "base").
- **Counts in words, zeros left out**: `Counts` (`views/Counts.tsx`) shows "Added 2", "Removed 1"; never "+0 −1".
- **Don't repeat the head**: a readout never restates the tool's name ("Edit: Remove time" under "Remove time").
- **Changes show direction and unit**: `−5.5 → −1.2 dB ▲ 4.3 dB`, never a bare `+4.3`.
- **Zoom to the change**: a view along project time (the timeline) opens on the changed span padded
  by half its length on each side (at least 8 s) via `focusOf()`, with `ZoomSwitch` (Change / Whole, icons and a
  tooltip) to see the whole project. The choice is one per-viewer preference for every such view (`useZoom()`,
  localStorage). When the change already fills most of the project there is no switch.
- **Fit the narrowest drawer** (320 px): check every view's `Narrow` story. Readouts sit three to a row, so a
  label stays at about 10 characters ("Range", not "Loudness range"); the unit and a `title` carry the rest
  ("Range · LU", title "Loudness range (LRA)…"). A row with more than three columns stacks under ~420 px.
- **Legend swatches match the mark's shape too**: a hollow tick (`lgWas`) for a hollow tick, a hollow dot
  (`lgWasDot`) for a hollow dot, a bar (`lgRange`) for a bar; a dashed line only for a dashed line. A view-only mark
  gets its swatch in the view's own module (`lgTonic`, `lgSection`). Glyphs and chips (`→ Send`, `M muted`) are
  their own swatch.
- **Colour states need a legend as well as marks**: what's lit (Tonic / In the key / Outside the key), what plays
  (Plays / Plays layered / Silent), what's connected, armed, or how dark a heat-map cell is.
- **No two homes for one number**: a readout and a tag or bar label never repeat it (the render's target sits in
  its readout, not in a "Normalize" tag too; the loudness target is in the legend, not a label over the bar).
- **Changes in a hint use words too**: "Fix: play offset 0.00 → −0.84 ms, polarity inverted", never a parameter
  name (`playOffsetMs`); a score change is `▲ 0.3`, never `+0.3`.
- **Zoom only along project time**: views already scoped to the change's own window (Envelope, Lanes zoomed to
  their takes, Stretch inside one item) get no switch.

## Adding a tool

`TOOLS` and `DEMO_CALLS` are `Record<LoggedCommand, …>`: a new command fails typecheck until it has a title, a
`did` sentence and a demo call. A command with a view also needs an example in `src/demo/examples.ts`, so
`?demo` and Storybook draw it (`examples.test.ts` checks this).
