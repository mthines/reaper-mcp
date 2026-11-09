---
name: make-plugin
description: >
  Makes the user a REAPER plugin for a specific need, end to end: reduces the request to the
  smallest plugin that does it, writes it as a self-contained JSFX with the shared UI toolkit
  (a small core view, advanced controls behind a section), loads it on a scratch track, proves
  by measurement that it does what was asked, and iterates. The result is just a plugin: it
  works without the bridge, the MCP server or a browser. Use when the user asks to "make/create/
  build a plugin that...", wants an effect that does not exist ("randomly mutate my samples and
  add reverb", "a trance gate", "keep my bass mono"), or to change a plugin made earlier.
  Triggers on "/make-plugin".
argument-hint: '[what the plugin should do | update <plugin>: <what to change>]'
license: MIT
metadata:
  author: mthines
  version: '1.3.0'
  workflow_type: applied
  tags: [plugins, jsfx, dsp, ui, reaper, live-verification]
---

# /make-plugin

Makes a plugin the user can keep: one `.jsfx` file in `Effects/reaper-mcp-generated/` that
REAPER loads like any other plugin. Everything it needs is inside the file, so it keeps working
on a machine with no reaper-mcp. This skill, `write_jsfx` and the bridge are only how it gets
made.

**Three principles, in this order of authority when they conflict:**

1. **Simple.** The smallest plugin that satisfies the request. Every control and every line of
   DSP has to earn its place. A plugin that does one thing well beats one that does five.
2. **Fast.** It runs in the audio thread. No work per sample that can be done per block or per
   change; nothing allocated while running; the UI redraws only when something changed.
   `reference/dsp-perf.md` is the checklist.
3. **Advanced controls by progressive disclosure.** The core view holds what is changed in most
   uses (3-5 controls, a level meter counts as one) and fills the window. Everything else sits
   in an **Advanced** drawer that slides up over the core view (the core never moves or
   shrinks). The lint enforces the counts.

## Rules that hold the whole way

- **Scratch track only.** Never add the plugin to the user's tracks, and never change their
  tracks, FX, selection or transport. Name it `[MCP] make-plugin <slug>`, add it at the end,
  and delete it **by exact name** when you are done, even when a step failed. Track indices
  shift while the user works: look the track up by name before every write.
- **No playback of the user's material.** Test with an item on the scratch track, rendered
  offline (`analyze_track_offline`, `verify_edit`); do not start the transport.
- **Ask at most one question**, and only when the request cannot be reduced to a plugin
  without it. Otherwise decide, say what you decided, and build.
- **The plugin has no dependencies**: no `gmem`, no bridge calls, no telemetry. The lint
  refuses `gmem`.
- **Never renumber a slider that has shipped.** Saved automation points at slider numbers.
  New controls go at the end. `write_jsfx` refuses a changed range or a removed slider unless
  `breaking: true`.
- **Do not commit** anything unless the user asks.

## Instructions

### Step 0: Load what earlier runs learned

Read the LoreKit lessons (`memory.list` in `project::reaper-mcp`, tag `loop::make-plugin-lessons`,
at most 5). They are considerations, not rules. Continue without them if LoreKit is not
connected, and say so in the report.

### Step 1: Reduce the request to a spec

In two or three lines, write down and show the user:

- **What it does**, in one sentence of DSP ("on each hit, replays a short mutated grain through
  a reverb").
- **Core controls** (3-5): what a person changes in most uses. Always include a way to set the
  amount (Mix, or the effect's own amount) and, for anything that changes level, Output.
- **Advanced controls** (0-8): set-and-forget, character, safety. If nothing qualifies, there is
  no Advanced section.
- **Suggested presets** (3-5): settings that teach what the plugin is for, each named for its
  intent in 2-3 words ("Ghost tails", "Crushed drums", "Tight low end"), values picked from what
  the user asked for. No "Default"/"Init" preset: REAPER has one.

Cut before you add. If a control could be a sensible fixed value, make it one. Pick the closest
example in `examples/` (`mutate-verb.jsfx` random and granular plus reverb, `tape-sat.jsfx`
nonlinear plus tilt EQ, `width-bass-mono.jsfx` linear stereo plus meter, `multiband-compressor.jsfx` frequency graph with
crossover handles in Hz, per-band gain reduction and a transfer curve via `ui_freqgraph`,
`ui_fhandle`, `ui_grmeter`, `ui_transfer`; `ui_keyboard` shows MIDI notes) and read it. Each has its
suggested presets beside it (`<name>.presets.json`): the shape `write_jsfx` takes.

### Step 2: Write the source

Read `reference/toolkit.md` (the UI API) and `reference/dsp-perf.md`. Start from the closest
example and change what the spec changes. The shape is always:

- header: `desc:Name`, **unnamed** sliders (`slider1:0.5<0,1,0.01>Label`), then `@init`,
  `@slider`, `@block`, `@sample`, `@gfx W H`.
- `@init` ends with `ui_boot(animated)` (1 when the UI has a meter, 2 when it has graph feeds: redraws only on activity); allocate buffers from
  `ui_mem`; compute coefficients in `update()`, called from `@init`, `@slider` and
  `@block: ui_changed() ? update();`.
- `@gfx` draws the core row(s), then `ui_section("Advanced") ? ( ... )` for the rest.
- Do not write the toolkit: `write_jsfx` inlines it.
- Never assign `ui_adv_open` (or any `ui_` state) in plugin code: REAPER re-runs `@init` when
  playback starts, so the Advanced drawer would snap shut on Play (lint `ui-state-reset`).
- `desc:` is the plain name: do not add `(reaper-mcp)` yourself, `write_jsfx` appends it.
- Never set the accent (`ui_cAccent`, `ui_theme`) or read keys/mouse yourself: the toolkit owns
  gestures (double-click types a value, Cmd/Ctrl/Alt-click resets, Shift-drag is fine).

### Step 3: Write it

Call `write_jsfx` with `name`, `source`, a one-line `request` (a comment in the file, never
sent anywhere or shown) and `presets` (the 3-5 from the spec: `[{name, values: {"Mix": 0.3, "Size":
0.8}}]`, keyed by slider label or index, in the slider's own units; sliders left out take their
default). A lint refusal lists every problem with its rule id and line: fix them all and call
again. A preset value outside its slider's range or step refuses the whole call too. Nothing is
written until everything passes. The presets land in the plugin's preset dropdown in REAPER;
presets the user saved there are never touched. Check one: `set_fx_preset` then
`get_fx_parameters` (raw values).

**Colour.** Each plugin gets its own accent from its name. When the user asks for a colour
("make it orange", "#ff8800"), call `write_jsfx` again with the same `source`, `overwrite: true`
and `accent: "orange"` (names: blue, teal, green, amber, orange, red, pink, violet; or `#rrggbb`).
Do not touch the source for a colour. Later writes without `accent` keep it; `accent: "auto"`
goes back to the name's colour.

### Step 4: Load it

1. Add the scratch track (`add_track`, name `[MCP] make-plugin <slug>`) and an item with a test
   signal on it. Generate one (a few seconds of band-limited noise bursts and a sine) with a
   short `node` script into the scratchpad as a WAV and `insert_audio_file` it, or use the
   user's own audio file if they gave one.
2. `add_fx` with the `fxName` that `write_jsfx` returned, then `get_fx_parameters`: the declared
   sliders are all there (REAPER adds Bypass, Wet and Delta after yours).
3. **A loaded plugin does not recompile when its file changes.** After every `write_jsfx`:
   `remove_fx`, then `add_fx` again.

### Step 5: Prove it by measurement

JSFX code does not run until audio is processed, so a compile error shows up as a plugin that
**does nothing**, not as an error. Never conclude "it loaded" from the parameter list alone.
Measure the track offline (`analyze_track_offline`, `verify_edit`, `measure_masking`,
`analyze_stereo_bands`, `analyze_loudness_curve`, as the plugin calls for), with and without the
plugin (`set_fx_enabled`):

1. **It runs.** At its default settings the output differs from the bypassed output
   (`verify_edit` with `expect: "changed"`, or a loudness/spectrum difference). Identical output
   means the plugin did not compile: look for an unbalanced parenthesis, an undefined function,
   a `1e9` literal, `local()` at the top of a section, then re-add it (Step 4.3).
2. **Transparent where it should be.** With the amount at 0 (Mix 0, Width 1...) the output is
   identical to bypass (`verify_edit`, `expect: "identical"`).
3. **Safe.** At defaults the true peak stays at or below 0 dBTP; no silence, no NaN.
4. **Does what was asked.** One check chosen from the request: a reverb tail after the last
   note (`analyze_loudness_curve`), correlation near 1 below the crossover
   (`analyze_stereo_bands`), added harmonics for a saturator (`analyze_track_offline` band
   balance), a gate's rhythm (`detect_transients`).
5. **Extremes.** Each control at its minimum and maximum: no blow-up (peak under +6 dBFS),
   no stuck silence. Use `set_fx_parameter` (values are normalized 0-1).

Fix the **plugin**, not the check. At most 4 rounds; after that stop and tell the user what
still fails.

### Step 6: Clean up

Delete the scratch track by exact name and confirm it is gone (`list_tracks` with
`nameContains`). The plugin file stays: it is the deliverable.

### Step 7: Report

Call `report_plugin_build` (outcome, rounds, checks passed/failed, the example you started
from, `scratchTag` = the slug in your track name), then one short message: the plugin's name
and where to find it (FX browser, folder **reaper-mcp-generated**), the core and advanced
controls in plain words, what you measured (with the numbers), and what you could not check.
It is a plain REAPER plugin: say so, and that the UI draws inside its own window.

### Step 8: Lessons

Save each non-obvious thing you hit as a LoreKit lesson in `project::reaper-mcp`, tag
`loop::make-plugin-lessons`, phrased as an observation. Nothing that is already in this file,
the toolkit or the code.

## Updating a plugin

`Read` the file, change the plugin part only (the toolkit block is replaced for you), and pass
the whole file back to `write_jsfx` with `overwrite: true`. Keep every existing slider's number,
range and options; add new sliders at the end. The old version is kept outside `Effects/`.
Pass `presets` again when they should change (without it the preset file is left as it is; with
`breaking: true` and no `presets`, the old suggested presets are removed).
Then Steps 4-8.

## Definition of done

- [ ] Core view 3-5 widgets, Advanced at most 8, nothing the request did not need
- [ ] `write_jsfx` accepted it (lint clean) with 3-5 suggested presets
- [ ] Measured: runs, transparent at zero, safe at defaults, does the one thing, extremes
- [ ] Scratch track deleted by name and confirmed gone; the user's tracks untouched
- [ ] `report_plugin_build` called; lessons saved (or the report says why not)

## Known gotchas (seed lessons)

- JSFX code does not run until audio is processed. A slider set in `@init`/`@slider`/`@block`
  reads back unchanged through `get_fx_parameters` (probed live, every variant), so there is no
  way to read a "compiled" flag: the audio check in Step 5 is the compile check.
- `1e9`-style literals make EEL2 reject the whole plugin and run no code. Write `1000000000`.
- `local()` is only valid inside a function, never at the top of `@sample`/`@block`.
- Named sliders (`slider1:g=0<...`) do not keep their value in `sliderN`: always unnamed.
- Memory below `ui_mem` (2048) belongs to the toolkit: allocate from it.
- `@init` runs again whenever playback starts (and on a sample-rate change). Anything it assigns
  is reset on Play: keep UI and interaction state out of unguarded `@init` assignments.
- `rand()` cannot be seeded: use the seeded generator in `examples/mutate-verb.jsfx` when a
  result must be repeatable.
- REAPER names the second plugin with the same `desc` with its path appended
  (`JS: Name [reaper-mcp-generated/x.jsfx]`): do not read that as a compile signal.
