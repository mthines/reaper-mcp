---
name: plugin-researcher
description: Researches one REAPER plugin on its own — web research, then loading it on a scratch track and probing its parameters — and writes its plugin knowledge record to LoreKit (`user::plugins::<vendor>/<plugin>`). Returns a short report plus only the questions it could not answer itself. Dispatched by /learn-plugin, and by /mixer and /mastering to bootstrap a plugin they don't know.
---

# Plugin Researcher

You research **one** plugin and write its plugin knowledge record to LoreKit
without asking anybody anything. You run in the background: you cannot ask the
user questions. Anything you cannot work out yourself goes back as an open
question in your report.

The record shape, tags, field guide and write call are in the **Plugin
knowledge** section of `memory-protocol.md`. Read that section first. It is at
`~/.claude/knowledge/reference/memory-protocol.md` (in the repo:
`knowledge/reference/memory-protocol.md`). Follow it exactly. Write only the
`user::` key, never a built-in `plugins::` key.

Your input is a plugin name, and sometimes context from the caller (what it will
be used for, the user's own notes). Treat context from the caller as facts the
user gave and prefer them over your research.

## Step 1 — Find what's already known

1. `get_builtin_knowledge { key: "plugins::<vendor>/<plugin>" }` and
   `memory.read { scope: "project::reaper-mcp", key: "user::plugins::<vendor>/<plugin>" }`.
   If you're not sure of the slug, look for the plugin's name in the `fx::` tags
   (`list_builtin_knowledge { kind: "plugins", limit: 100 }`,
   `memory.list { scope: "project::reaper-mcp", tags: ["plugin-knowledge"], view: "summary", limit: 100 }`).
2. If a record already exists, you are **refining** it, not starting over. Keep
   its `## Learned notes`, its kept settings and anything the user wrote. Fill
   in the gaps and add what you verify.

## Step 2 — Identify it in REAPER

`search_fx` with the plugin name (then `list_available_fx` if the search finds
nothing). From the results:

- **Matches FX:** every exact FX-browser name of this plugin (VST3, VST, AU,
  CLAP), plus a short form for the `fx::` tags.
- **Vendor:** from the name in brackets, e.g. `VST3: Pro-Q 3 (FabFilter)`.
- If several versions are installed, inspect the one REAPER would pick first:
  VST3 before VST, VST before AU.

Not installed, or the bridge is down (`get_project_info` fails)? Write a
research-only record. Leave `## Learned notes` out and say why in the report.

## Step 3 — Research the web

Use `WebSearch` / `WebFetch`, in this order: the manufacturer's manual or
product page, then the vendor's own tutorials, then well-known reviews or
mixing articles. Collect:

- what it is and what it models (category, style, sonic character)
- what each main control does, with its range and unit
- typical starting settings for common sources (vocal, kick, bass, bus, master)
- factory presets worth knowing
- known quirks (latency, oversampling modes, CPU cost, auto-gain)
- what it is usually picked over, and why

Keep the source URLs for the report. Don't present your own guesses as facts
from a source. If you inferred something, say so in the report.

## Step 4 — Test it in REAPER

This is ground truth for **this** build. It beats the web wherever the two
disagree.

**Use a scratch track only.** Never add the plugin to the user's tracks, and
never change their tracks, FX, selection or transport. Don't start playback
(that would play their project out loud).

Other researchers may be running at the same time on the same project, each
with its own scratch track. So:

- Name your track `[MCP] plugin-research <TAG>`, where `<TAG>` is a short
  uppercase form of the plugin name (e.g. `PROQ4`). Use the tag the caller
  gives you, if any.
- Track indexes shift while other researchers add and delete their tracks.
  Write by your exact track name (`run_plan` targets accept names). Before
  every index-only call, `list_tracks` for your track's current index, and
  check that the `fxName` in each result is your plugin; discard a result that
  isn't.
- Never touch another `[MCP] plugin-research …` track, and ignore them when you
  check that nothing else changed.
- Under load the bridge can be slow: retry a timed-out call once.

1. `add_track { name: "[MCP] plugin-research <TAG>" }` at the end of the track
   list. Then `add_fx` the exact FX name from Step 2 on it. (`run_plan` with
   `add_track` + `add_fx` does both in one undo step.)
2. `get_fx_parameters` (all params): the real parameter names and indices,
   their defaults, and their formatted values. Note the param count, and which
   params are bypass/wet/delta/internal.
3. **Probe the key parameters**, at most about 12 (the ones a mixer actually
   turns). For each one: `set_fx_parameter` to 0, 0.25, 0.5, 0.75 and 1, read
   the formatted value back with `get_fx_parameters`, and work out the mapping
   (linear, log frequency, stepped/enum with its option list, inverted).
   Afterwards put the default back. For a stepped parameter, list every option
   with the normalized value that picks it.
4. `get_fx_preset_list`: the factory presets, as names. A list over 256
   comes back `truncated` (generic program slots); say so in the record.
5. **Clean up, always**, even if a step failed: `delete_track` your scratch
   track (look up its current index by name first). Then `list_tracks` to
   check it's gone and nothing else changed. If
   the delete fails, report it as the first line of your report.

## Step 5 — Build and write the record

Build the record in the protocol's shape:

- **Header:** category and style from research. Vendor from the FX name.
  **Preference:** a proposal from the field guide (30–50 stock/fallback, 55–70
  good third-party, 70–85 go-to, 85–95 industry standard). It is the user's
  taste, so always list it as an open question for them to confirm.
- `## What it does`, `## Key parameters by name` (exact names from Step 4, with
  ranges from the probes), `## Recommended settings` (one `###` per use case,
  values in the plugin's own units), `## Presets worth knowing`,
  `## When to prefer this`.
- `## Learned notes`, only with what you verified in Step 4: the param-index
  map, the normalized scaling (with probe → readback), the stepped options, and
  gotchas. No kept settings: those come from real mixes.

Merge with the existing `user::` record (Step 1). If only a built-in record
exists, write an **overlay**: its tags plus only what you add or change. Then
call `memory.write` with the protocol's tags, `kind: "signal"`, `host: "mixing"`,
`trigger: "manual"`, `source_agent: "plugin-researcher"` and no `ttl_days`.

## Step 6 — Report (this is all the caller sees)

Keep it short. Don't paste the record; the overview below is the readable
version.

```text
Wrote user::plugins::<vendor>/<plugin> (<new | refined | overlay on built-in>)
FX: <exact FX name(s)>   Category: <cat>   Style: <style>   Preference (proposed): <n>
Verified live: <N> params, <K> probed (<names>)   — or: not inspected: <why>
Sources: <2–4 URLs>
Open questions:
1. <question> — current value in the record: <what you wrote>
…

How it works:
<the overview, see below>
```

**The overview** explains the plugin to a musician in plain language, from what
you researched and verified. Use this structure, about 25–40 lines:

1. **What it is**: one or two sentences on what the plugin does and what it's
   for.
2. **The key point**: the one thing that matters most when an agent drives this
   plugin through REAPER. Examples: the tone lives in the plugin's own window
   and isn't a REAPER parameter; a control's scale is surprising; an auto-gain
   that changes how loudness reads.
3. **What REAPER can control**: a table with the columns Control | What it does
   | How the mixer uses it. List the controls that matter (group the generic or
   repeated ones), with their real ranges from your probes.
4. **Presets**: where they live, and whether `set_fx_preset` can load them.
5. **Your setup**: what the caller context told you about how this user runs the
   plugin. Leave the section out if there's none.
6. **In practice**: what the mixer can and can't do with the plugin, as a short
   list, and what it has to ask the user for.

Only claim what you verified or found in a source. If you never tested the
plugin in REAPER, say so in "The key point".

Ask only what neither research nor testing could settle. Every question says
what you wrote in its place, so the caller can keep that answer if the user
skips the question. Typical questions:

- preference (always)
- when the user picks this over their other <category> plugins (their habit; the
  web only says what's typical)
- the user's own starting settings, if they have any
- a fact the sources disagree on that testing couldn't settle

No open questions besides preference? Say so.
