---
name: new-extension
description: >
  Builds or updates a reaper-mcp extension for one plugin or workflow, end to end:
  checks it is feasible, picks the right kind (VST3 state editor, preset-file builder,
  or bridge workflow), finds how the plugin stores its state, writes tools with
  behaviour tests, proves them live on a scratch track (including that the sound
  changes), documents them and teaches the mixing skills about it. Use when the user
  wants Claude to control a plugin's internals that host parameters cannot reach
  (wavetables, mod matrix, patch graphs, preset files), asks to "make an extension for
  X", "add support for X", "build a plugin for reaper-mcp", or to change, extend or
  fix an existing extension ("update the vital extension", "add macros to vital").
  Triggers on "/new-extension".
argument-hint: '[plugin or workflow to build an extension for | update <extension>: <what to change>]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: applied
  tags:
    - extensions
    - plugins
    - reaper
    - vst3
    - plugin-state
    - preset-files
    - synth
    - tdd
    - live-verification
---

# /new-extension

This skill builds or updates an **opt-in extension** (`docs/EXTENSIONS.md`) for one plugin
or workflow: tools that reach what `set_fx_parameter` cannot, such as a synth's
wavetables, mod matrix and LFO shapes, or a guitar rig's preset files. Read
`docs/EXTENSIONS.md` first; it holds the manifest, the API, the three kinds of
extension and the trust model. Two worked examples ship in the repo, copy their shape,
not their details:

- `extensions/vital/`: a **state editor** (VST3 saved state, `api.fxState`).
- `extensions/helix/`: a **file-format builder** (the plugin's state is encrypted, so it
  edits the documented preset file and imports it with a checked driver).

It works the way `/learn-plugin` does: do the research and the probing yourself, ask
the user only what you cannot find out, and prove the result on a scratch track
before calling it done. `/learn-plugin` teaches the mixing skills *about* a plugin;
this skill teaches reaper-mcp to *edit* one. They meet at the end (Step 8).

## Trigger

The user types `/new-extension [plugin or workflow]`, `/new-extension update <extension>: <change>`,
or asks for control of a plugin's internals that the existing tools cannot give.

**Mode.** `ls extensions/` and `reaper-mcp extension list`. If the argument names an
existing extension, or the work is "add X to / fix Y in" one, you are in **update mode**
(see [Updating an extension](#updating-an-extension)); otherwise **new mode**: run Steps
1-9.

## Rules that hold the whole way

- **Scratch track only.** Never add the plugin to the user's tracks, never change their
  tracks, FX, selection or transport, and never start playback of their material. The
  user edits the session live, so track indices shift: look a track up by name before
  each write batch. Name it `[MCP] extension-research <TAG>`, add it at the end of the
  track list and delete it when you are done, **even when a step failed**.
- **Never write a user's file in place.** Anything that touches a preset or library file
  writes a copy, or backs up first (`.bak`) and verifies afterwards. Do not run an import
  or write against the user's real library slots; use a scratch slot.
- **Extensions never import core.** Only `@reaper-mcp/extension-api` (eslint enforces it).
- **Test behaviour, never implementation** (`CLAUDE.md`): drive the tools through a fake
  `ExtensionApi` and real state fixtures; assert what the agent gets and what state
  REAPER ends up with. Mock only REAPER.
- **Fixtures are small and impersonal.** No personal presets, no license keys, no file
  paths from the user's machine.
- **Do not commit** unless the user asks. The tree may hold other sessions' edits: stage
  explicit paths (or hunks) of your own files only.
- **Do not guess a format and write it.** A wrong write can make a plugin silently ignore
  the change or load garbage. Stay on read-only probes until the parse is exact.

## Instructions

### Step 0: Load what earlier runs learned

Read `docs/EXTENSIONS.md`. Then read the LoreKit lessons for extensions (capped at 5:
`memory.list` in `project::reaper-mcp` with tag `loop::extension-lessons`, plus one
`memory.search` on the plugin's name) and the plugin's own record (`user::plugins::…`, or
`get_builtin_knowledge`). Treat them as considerations, not rules; verify against what
you see. If LoreKit is not connected, continue without it and say so in the report.

### Step 1: Scope it, pick the kind, check it is worth building

From the arguments (or one question: "Which plugin or workflow, and what should Claude be
able to change in it?"), settle:

1. **What for.** Read, edit, build, or all three. Smallest useful set wins: an extension
   that reads and edits the thing people actually tweak beats one that models all of it.
2. **Does it already exist?** `reaper-mcp extension list`, `ls extensions/`, and
   `list_tool_categories`. If one covers it, switch to update mode.
3. **Can the host parameters do it?** If `get_fx_parameters` already exposes everything
   needed, stop: `/learn-plugin` is the right tool. An extension earns its place only
   for state that lives outside the parameters.
4. **Pick the kind** (the table in `docs/EXTENSIONS.md`). `search_fx` for the plugin first.

   | Kind | Choose it when | Core of the work |
   |---|---|---|
   | **State editor** | A **VST3** build is installed and its saved state holds a recoverable format | `api.fxState` + `state.ts` parse/build (Steps 3-6 as written) |
   | **File-format builder** | The state is closed or encrypted (probe shows no readable document) but the plugin imports a documented preset file | Parse/build/validate the file in Node; a checked import (`extensions/helix/src/import.ts`) |
   | **Bridge composer** | No plugin internals needed, only a new multi-step REAPER workflow | `api.bridge` calls, `handlers.lua` only if a ReaScript call is missing from core |

   `api.fxState` supports **VST3** only (VST2, AU, CLAP and FX inside containers are
   refused). If only other formats are installed, say so and offer the file-format or
   bridge route, or `/learn-plugin`.
5. **Name it.** Lowercase, digits, dashes, 2-32 characters. It prefixes every tool
   (`<name>_<tool>`).

### Step 2: Research how the plugin stores its state

`WebSearch` / `WebFetch`, in this order: the vendor's docs on the **preset file format**,
open-source parsers or format write-ups, then forum threads. You are looking for:

- the preset format (JSON, XML, a binary chunk), its version field, and which parts are
  safe to edit
- how the VST3 state wraps it (a JUCE bank, a raw preset, a custom blob)
- limits that make an edit invalid (counts, ranges, name rules)
- the license, if you will port any parser logic (credit it, or write your own)

Keep the URLs. Do not present guesses as facts. If the format is closed and
undocumented, say so now: you will have to work it out from probes in Step 3, and
should tell the user it may not be feasible.

### Step 3: Scaffold, then probe the real state

1. `reaper-mcp extension new <name> --dir extensions`. It scaffolds plain JavaScript
   (`index.mjs`, a manifest). In this repo make it a TypeScript project like
   `extensions/vital/`: copy its `project.json` (tag `type:extension`, esbuild to
   `dist/index.mjs`), `tsconfig.json`, `package.json` and `vitest.config.ts`, set `main`
   to `dist/index.mjs`, delete the scaffold's `index.mjs`, and run `pnpm install` once so
   the new package is linked (the `extensions/*` workspace glob covers it).
2. Add the plugin to the scratch track (`add_fx`, exact FX name from `search_fx`).
   Check `get_fx_parameters`: a plugin showing only 3 parameters is not loaded (offline),
   toggle it online first.
3. **State editor:** write a throwaway **probe tool** that uses `api.fxState.get` and
   returns, as JSON: state length, the 44-byte header's two length fields, the first and
   last 64 bytes (hex and ASCII), every printable-string run over 8 characters, and
   whether a JSON or XML document starts inside it and where it ends.
   **File-format builder:** if the probe shows an encrypted or opaque blob, record that
   (it is the reason for this kind) and work from the preset files instead: collect two or
   three real files from the user's library or the vendor's factory content, read them,
   and write the layout down.
4. Build it (`pnpm nx build <name>`), link it (`reaper-mcp extension add <name>`, a
   symlink to this clone's `extensions/<name>`), and run it with the harness. A running
   Claude Code session only sees new tools after a restart, so use:

   ```bash
   node scripts/ext-call.mjs <name>_probe '{"trackIndex": N}'
   ```

   (Needs `pnpm nx build reaper-mcp-server` and a running bridge.)
5. Learn the encoding by **changing one thing and diffing**: set one parameter with
   `set_fx_parameter`, run the probe again, compare the bytes. Then change one thing
   the host cannot reach (load a preset, switch a wavetable) and diff again. Save two or
   three real states as **test fixtures**.
6. Write down the layout: where the editable document starts and ends, which length
   fields wrap it (and what they count), and anything after it that must be preserved.

Stay on probes until the parse is exact on every fixture. Delete the probe tool before
Step 7.

### Step 4: Design the tools

Propose the tool list to the user in one short message (name, one line each, what is
read and what is written) and fold in their answer. Defaults that have worked:

- `read_*`: a **summary first** (structure, names, counts), raw values only on request
  (`settingsMatching`-style filter, pagination). Never return the whole state.
- `write_*`: validate everything first and write nothing on one bad edit; `dryRun: true`
  returns what would change with before → after; one undo point; say how to undo
  (`undo_project`).
- One **domain tool** for the thing people want to build (Vital: `set_wavetable`), not a
  generic "set any byte".
- `z.coerce.number()` for numbers, descriptions that tell an agent *when* to use the tool
  and what the units are. Locate the plugin automatically when exactly one is on the track.
- Keep the user's selection, transport and track list as they were.

### Step 5: Implement, with behaviour tests first

Split the extension like `extensions/vital/src/`:

- `state.ts` (or `hlx.ts`-style for a file format): `parse` and `build`, pure and
  byte-exact. `build` must keep every byte it does not edit, fix every inner length field
  the edit changes, and (state editor) leave the VST3 wrapper's two outer lengths to
  `api.fxState.set`.
- `patch.ts` (or similar): the edits as pure functions over the parsed document, each
  returning an error list instead of throwing.
- `index.ts`: tool registration and the read → mutate → write helper.
- `__fixtures__/fake-api.ts`: a fake `ExtensionApi` (copy Vital's).

Tests (`*.test.ts`), each named after a behaviour:

- **round trip**: `build(parse(x), {})` returns `x` byte for byte, on every real fixture
- an edit changes exactly what was asked and nothing else
- a bad edit is refused and `set` is never called
- a wrong FX on the track gives a clear message, not a write
- a state the plugin changed after load (extra trailing bytes) still edits correctly
- file builders: an invalid file is refused before anything is written; an overwrite keeps
  a `.bak`

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
6. Call a tool with a deliberately bad input: the refusal must be readable and change nothing.

If anything fails, keep the failing state's bytes (`api.fxState.get`) as a new fixture and
fix it with a test first. If it cannot be made reliable, say so in the report and do not
ship a tool that only sometimes works.

### Step 7: Gates

`reaper-mcp doctor` must list the extension as ok (manifest valid, `main` built, `lua`
present). Then everything: `pnpm nx run-many --target=build,lint,typecheck,test`, run with
`REAPER_RESOURCE_PATH` pointed at a temp folder so live-REAPER suites don't touch the
user's bridge. Delete the scratch track.

### Step 8: Teach the rest of the system

1. **Docs.** All four, in the same change:
   - `docs/EXTENSIONS.md`: a section for the extension (what it does, a tool table, what is
     not covered, env vars) next to Vital and Helix, plus a row in the table at the top.
   - **Root `README.md`**: a row in the "Extensions" table (`## 🧩 Extensions`) with the emoji,
     name, and what Claude can do with it in plain words for a non-coder, and the plugin in
     the FAQ answer if it names them. Plain words, no jargon.
   - `docs/assets/extensions.svg`: if it is a headline extension, add or swap a card so the
     picture stays true (keep the file valid: `xmllint --noout`).
   - `CLAUDE.md` (the structure block) and `docs/REFERENCE.md` (Project Structure).

   Rebuild with `--skip-nx-cache` after editing knowledge or `.claude` files (Nx ignores
   asset-dir changes).
2. **Plugin record.** Write or update the plugin's `user::plugins::<vendor>/<plugin>`
   record in LoreKit (`project::reaper-mcp`) following
   `knowledge/reference/memory-protocol.md`: copy the built-in record's tags, add
   `extension::<name>`, and put the workflow, the raw-name vs host-name difference, what
   must be enabled before it sounds, and what you verified live in `## Learned notes`. A
   write replaces the record: read, merge, write.
3. **Lessons.** Save each non-obvious gotcha you hit as a LoreKit lesson in
   `project::reaper-mcp`, tag `loop::extension-lessons`, phrased as an observation with
   what you saw. Do not save anything that is already in this file or in the code.

### Step 9: Report

One short message: what the extension does and its tools, what you verified live (with
the numbers from Step 6), what is **not** covered or not verified, and the install line
(`reaper-mcp extension add <name>`, then restart the MCP server). Offer to commit and
open a PR; do not do either unprompted.

## Updating an extension

For "add X to", "fix Y in" or "support Z in" an existing extension. Same rules, shorter loop:

1. **Read it first.** Its manifest, `README` section in `docs/EXTENSIONS.md`, tool list,
   tests and fixtures; then `git log --oneline -- extensions/<name>` for how it grew. Read
   the Step 0 lessons.
2. **Reproduce or probe.** A bug: capture the failing state (`api.fxState.get` on a scratch
   track) as a fixture and write the failing test first. A new capability: probe the one
   thing it needs (Step 3, steps 2-6) on the scratch track, diffing as before.
3. **Keep tools compatible.** Existing tool names and parameters keep working; add
   optional parameters rather than renaming. A breaking change needs the user's yes and a
   `version` major bump.
4. **Behaviour tests, then code,** then Steps 6 and 7 for the changed tools (live proof of
   the new behaviour **and** one regression check on an old tool).
5. **Bump `version`** in the manifest (patch for fixes, minor for new tools or parameters;
   `apiVersion` only changes when `libs/extension-api` does).
6. **Docs.** Update the extension's section in `docs/EXTENSIONS.md` (move the item out of
   its "Not yet" list), the root README row if what Claude can do changed, and the plugin's
   LoreKit record. Lessons only for new gotchas.
7. Report as in Step 9, adding what changed for existing users (usually: rebuild, restart).

## Definition of done

- [ ] Parse round-trips every fixture byte for byte (or the file builder validates every fixture)
- [ ] Tools validate before writing; `dryRun` on every write; one undo point
- [ ] Live proof on a scratch track: read, write, read back, audible change, two writes, undo
- [ ] `reaper-mcp doctor` shows the extension ok; build, lint, typecheck, test green
- [ ] `docs/EXTENSIONS.md`, root `README.md`, `CLAUDE.md`, `docs/REFERENCE.md` updated
- [ ] LoreKit plugin record and lessons written (or the report says why not)
- [ ] Scratch track deleted; the user's tracks, selection and transport untouched
- [ ] Nothing committed unless asked

## Known gotchas (seed lessons, from building `vital` and `helix`)

- REAPER ignores changed VST3 state unless the FX gets a **new `FXID`**, and it checks two
  outer length fields (header bytes 32..35 = state length; state bytes 0..3 = state length
  minus 16). `api.fxState.set` handles both; never write the chunk by hand.
- After loading an edited state, a plugin can save itself with a few **extra trailing
  bytes** while REAPER keeps the lengths it was given. Parse tolerantly, and keep trailing
  bytes on `build`.
- A plugin whose host exposes only 3 parameters is **offline** (not loaded). Toggle it
  online (`set_fx_offline`) before probing or writing, and refuse to write while offline.
- Some plugins (Helix Native) keep an **encrypted** state blob: do not try to edit it. Use
  the plugin's preset file and verify the result on disk, rolling back if more than the
  intended slot changed.
- The bridge's JSON decode is flat (SWS has no `CF_Json_Parse`): extension params travel as
  a JSON string (`paramsJson`, decoded for you before your Lua handler runs), and large
  state travels as files in the bridge folder, never inside a command.
- `mcp_bridge.lua` is near Lua's 200-locals limit. New Lua goes in a lib file or on the
  `ext` table, not as new top-level locals.
- A write reloads the plugin, so held notes cut off. Do not write mid-playback.
- `register(api)` must finish within 10 s: register tools, do slow work inside handlers.
- Extension tools are not in the Claude Code allow-list, so each new one asks for
  permission the first time.
- A running Claude Code session only sees a new or changed extension after a restart. Use
  `node scripts/ext-call.mjs` to test in the meantime.
