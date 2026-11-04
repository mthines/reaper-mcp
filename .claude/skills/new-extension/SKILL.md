---
name: new-extension
description: >
  Builds a reaper-mcp extension for one plugin or workflow, end to end: checks it is
  feasible, finds how the plugin stores its state, scaffolds the extension, writes
  tools with behaviour tests, proves them live on a scratch track, documents them and
  teaches the mixing skills about it. Use when the user wants Claude to control a
  plugin's internals that host parameters cannot reach (wavetables, mod matrix,
  patch graphs), or asks to "make an extension for X", "add support for X", or
  "build a plugin for reaper-mcp". Triggers on "/new-extension".
argument-hint: '[plugin or workflow to build an extension for]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - extensions
    - plugins
    - reaper
    - vst3
    - plugin-state
    - synth
    - tdd
    - live-verification
---

# /new-extension

This skill builds an **opt-in extension** (`docs/EXTENSIONS.md`) for one plugin or
workflow: tools that reach what `set_fx_parameter` cannot, such as a synth's
wavetables, mod matrix and LFO shapes. Read `docs/EXTENSIONS.md` first; it holds the
manifest, the API and the trust model. `extensions/vital/` is the worked example:
copy its shape, not its details.

It works the way `/learn-plugin` does: do the research and the probing yourself, ask
the user only what you cannot find out, and prove the result on a scratch track
before calling it done. `/learn-plugin` teaches the mixing skills *about* a plugin;
this skill teaches reaper-mcp to *edit* one. They meet at the end (Step 8).

## Trigger

The user types `/new-extension [plugin or workflow]`, or asks for control of a plugin's
internals that the existing tools cannot give.

## Rules that hold the whole way

- **Scratch track only.** Never add the plugin to the user's tracks, never change their
  tracks, FX, selection or transport, and never start playback. The user edits the
  session live, so track indices shift: look a track up by name before each write batch.
  Name it `[MCP] extension-research <TAG>`, add it at the end of the track list and delete
  it when you are done, even when a step failed.
- **Extensions never import core.** Only `@reaper-mcp/extension-api` (eslint enforces it).
- **Test behaviour, never implementation** (`CLAUDE.md`): drive the tools through a fake
  `ExtensionApi` and real state fixtures; assert what the agent gets and what state
  REAPER ends up with. Mock only REAPER.
- **Do not commit** unless the user asks. The tree may hold other sessions' edits: stage
  explicit paths (or hunks) of your own files only.

## Instructions

### Step 1: Scope it, and check it is worth building

From the arguments (or one question: "Which plugin or workflow, and what should Claude be
able to change in it?"), settle:

1. **What for.** Read, edit, build, or all three. Smallest useful set wins: an extension
   that reads and edits the thing people actually tweak beats one that models all of it.
2. **Does it already exist?** `reaper-mcp extension list`, `ls extensions/`, and
   `list_tool_categories`. If one covers it, extend that one instead.
3. **Can the host parameters do it?** If `get_fx_parameters` already exposes everything
   needed, stop: `/learn-plugin` is the right tool. An extension earns its place only
   for state that lives outside the parameters.
4. **Is it a VST3?** `search_fx` for the plugin. `api.fxState` supports **VST3** only
   (VST2, AU, CLAP and FX inside containers are refused). A VST3 build installed:
   continue. Only other formats installed: say so, and offer what is possible without
   state access (a Lua-only extension through `api.call`, or `/learn-plugin`).

### Step 2: Research how the plugin stores its state

`WebSearch` / `WebFetch`, in this order: the vendor's docs on the **preset file format**,
open-source parsers or format write-ups, then forum threads. You are looking for:

- the preset format (JSON, XML, a binary chunk), its version field, and which parts are
  safe to edit
- how the VST3 state wraps it (a JUCE bank, a raw preset, a custom blob)
- limits that make an edit invalid (counts, ranges, name rules)
- the license, if you will port any parser logic

Keep the URLs. Do not present guesses as facts. If the format is closed and
undocumented, say so now: you will have to work it out from probes in Step 3, and
should tell the user it may not be feasible.

### Step 3: Scaffold, then probe the real state

1. `reaper-mcp extension new <name> --dir extensions` (lowercase, dashes; becomes the tool
   prefix `<name>_<tool>`). It scaffolds plain JavaScript (`index.mjs`, a manifest). In this
   repo make it a TypeScript project like `extensions/vital/`: copy its `project.json` (tag
   `type:extension`, esbuild to `dist/index.mjs`), `tsconfig.json` and `vitest.config.ts`, set
   `main` to `dist/index.mjs`, the `extensions/*` workspace glob already covers it (run `pnpm install` once so the new
   package is linked).
2. Add the plugin to the scratch track (`add_fx`, exact FX name from `search_fx`).
3. Write a throwaway **probe tool** in the extension that uses `api.fxState.get` and
   returns, as JSON: state length, the 44-byte header's two length fields, the first and
   last 64 bytes (hex and ASCII), every printable-string run over 8 characters, and
   whether a JSON or XML document starts inside it and where it ends.
4. Build it (`pnpm nx build <name>`), link it (`reaper-mcp extension add <name>`, a symlink to this clone's
   `extensions/<name>`), and run it with the harness. A running Claude Code session only
   sees new tools after a restart, so use:

   ```bash
   node scripts/ext-call.mjs <name>_probe '{"trackIndex": N}'
   ```

5. Learn the encoding by **changing one thing and diffing**: set one parameter with
   `set_fx_parameter`, run the probe again, compare the bytes. Then change one thing
   the host cannot reach (load a preset, switch a wavetable) and diff again. Save two or
   three real states as **test fixtures** (small, no personal presets).
6. Write down the layout: where the editable document starts and ends, which length
   fields wrap it (and what they count), and anything after it that must be preserved.

Do not guess a layout and write it: a wrong write can make the plugin silently ignore the
state, or load garbage. Stay on probes until the parse is exact on every fixture.

### Step 4: Design the tools

Propose the tool list to the user in one short message (name, one line each, what is
read and what is written) and fold in their answer. Defaults that have worked:

- `read_*`: a **summary first** (structure, names, counts), raw values only on request
  (`settingsMatching`-style filter). Never return the whole state.
- `write_*`: validate everything first and write nothing on one bad edit; `dryRun: true`
  returns what would change with before → after; one undo point; say how to undo
  (`undo_project`).
- One **domain tool** for the thing people want to build (Vital: `set_wavetable`), not a
  generic "set any byte".
- `z.coerce.number()` for numbers, descriptions that tell an agent *when* to use the tool
  and what the units are. Locate the plugin automatically when there is one on the track.

### Step 5: Implement, with behaviour tests first

Split the extension like `extensions/vital/src/`:

- `state.ts`: `parse(state)` and `build(parsed, patch)`, pure and byte-exact. `build`
  must keep every byte it does not edit, fix every inner length field the edit changes,
  and leave the VST3 wrapper's two outer lengths to `api.fxState.set` (it fixes them).
- `patch.ts` (or similar): the edits as pure functions over the parsed document, each
  returning an error list instead of throwing.
- `index.ts`: tool registration and the read → mutate → write helper.

Tests (`*.test.ts`), each named after a behaviour:

- **round trip**: `build(parse(x), {})` returns `x` byte for byte, on every real fixture
- an edit changes exactly what was asked and nothing else
- a bad edit is refused and `set` is never called
- a wrong FX on the track gives a clear message, not a write
- a state the plugin changed after load (extra trailing bytes) still edits correctly

Run `pnpm nx run-many --target=test,lint,typecheck,build --projects=<name>` until green.

### Step 6: Prove it live

On the scratch track, with the harness (a fresh process, so no restart):

1. `read_*` and compare with what you know about the loaded patch.
2. `write_*` with `dryRun: true`, then for real. Read it back: the change must be there.
3. **Prove it sounds different.** Add a MIDI item with a note or chord on the scratch
   track (`create_midi_item`, `insert_midi_notes`), then `analyze_track_offline` before
   and after the edit. Spectral centroid, band balance or loudness must move the way the
   edit should move them. A read-back that matches does not prove the plugin loaded it.
4. Edit **twice in a row** (the state the plugin saves after loading your first write can
   differ from the one you wrote; the second write is where a stale length shows up).
5. `undo_project` once and read back: the edit is gone.

If anything fails, keep the failing state's bytes (`api.fxState.get`) as a new fixture and
fix it with a test first.

### Step 7: Gates

`reaper-mcp doctor` must list the extension as ok (manifest valid, `main` built, `lua`
present). Then everything: `pnpm nx run-many --target=build,lint,typecheck,test`, run with
`REAPER_RESOURCE_PATH` pointed at a temp folder so live-REAPER suites don't touch the
user's bridge.

### Step 8: Teach the rest of the system

1. **Docs.** Add the extension to `docs/EXTENSIONS.md` (what it does, tools, what is not
   covered) and to the structure block of `CLAUDE.md`. Rebuild with `--skip-nx-cache`
   after editing knowledge or `.claude` files (Nx ignores asset-dir changes).
2. **Plugin record.** Write or update the plugin's `user::plugins::<vendor>/<plugin>`
   record in LoreKit (`project::reaper-mcp`) following
   `knowledge/reference/memory-protocol.md`: copy the built-in record's tags, add
   `extension::<name>`, and put the workflow, the raw-name vs host-name difference, what
   must be enabled before it sounds, and what you verified live in `## Learned notes`. A
   write replaces the record: read, merge, write.
3. **Lessons.** Save each non-obvious gotcha you hit as a LoreKit lesson in
   `project::reaper-mcp`, tag `loop::extension-lessons`, phrased as an observation with
   what you saw. Read that bucket (capped at 5, plus one search on the plugin name) at the
   start of Step 3 next time.

### Step 9: Report

One short message: what the extension does and its tools, what you verified live (with
the numbers from Step 6), what is **not** covered or not verified, and the install line
(`reaper-mcp extension add <name>`, then restart the MCP server). Offer to commit and
open a PR; do not do either unprompted.

## Known gotchas (seed lessons, from building `vital`)

- REAPER ignores changed VST3 state unless the FX gets a **new `FXID`**, and it checks two
  outer length fields (header bytes 32..35 = state length; state bytes 0..3 = state length
  minus 16). `api.fxState.set` handles both; never write the chunk by hand.
- After loading an edited state, a plugin can save itself with a few **extra trailing
  bytes** while REAPER keeps the lengths it was given. Parse tolerantly, and keep trailing
  bytes on `build`.
- The bridge's JSON decode is flat (SWS has no `CF_Json_Parse`): extension params travel as
  a JSON string (`paramsJson`), and large state travels as files in the bridge folder,
  never inside a command.
- `mcp_bridge.lua` is near Lua's 200-locals limit. New Lua goes in a lib file or on the
  `ext` table, not as new top-level locals.
- A write reloads the plugin, so held notes cut off. Do not write mid-playback.
- Extension tools are not in the Claude Code allow-list, so each new one asks for
  permission the first time.
