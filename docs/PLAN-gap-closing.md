# Plan: composition tools, tool profiles and reach

Inspired by [xDarkzx/Reaper-MCP](https://github.com/xDarkzx/Reaper-MCP), which ships several of these ideas.
We are strong on measurement, safety, knowledge, the status page and depth. What is left is composition shortcuts,
sample/loop workflow, one-call recipes, tool-count control and onboarding outside macOS + Claude Code.

Rules for every item: follow "Adding New MCP Tools" in CLAUDE.md (8 places), `z.coerce.number()`, behaviour tests,
one undo point per write, validate before writing, a drawer card per tool (see `feedback_every_tool_needs_a_card`).

## Decisions (Mads, 2026-11-09)

- **Composition is subjective, so it lives in an opt-in extension** (`extensions/composition/`, tools named `composition_*`), not core. It covers
  items 1, 2, 4 and 6. Core keeps the objective tools (`quantize_midi`, `transform_midi`, `import_midi_file`, `detect_key`, `detect_chords`).
- **Audience is both** producers and mix engineers: the extension serves the first, items 3, 5 and 8 the second.
- **Windows and Linux already work**, so item 8 is verification, not a build.

## Status

- Done: extension scaffold, `composition_chord_progression`, `composition_drum_pattern` (item 1, 2); `REAPER_MCP_PROFILE` (item 3).
- Not started: items 4-10.

## Phase 1: quick wins (small, self-contained)

| # | Item | Notes | Done when |
|---|------|-------|-----------|
| 1 | `composition_chord_progression` (extension) | Parse `"Cm7, Fm7, Bb7, Eb"` (+ bars per chord, voicing, octave, inversion) into MIDI notes on a track. Pure TS parser (`chords-notation.ts`) feeding the existing `insert_midi_notes` path, so no new Lua. Reuse the chord vocabulary from `chords.ts`. | Parser tests cover qualities, slash bass, flats/sharps, bad input refused with the offending token; notes land in an item |
| 2 | `composition_drum_pattern` (extension) | Step-sequencer notation (`"kick: x---x---"`, per-lane pitch map, swing, velocity accents). Default pitch map GM; the user's kits (GGD Invasion: kick 24/23, snare 26) as a named map. | Pattern round-trips through `get_midi_notes`; map is selectable; length in bars |
| 3 | Hard tool profile (done) | `REAPER_MCP_PROFILE` (`full`, `music`, `mixing`, `analysis`, `minimal`; `music`, not `composition`, so it does not clash with the extension's name) filters registration using `TOOL_CATEGORIES`. Needed for clients that cap tools (~128). Coexists with progressive discovery. | Test: each profile registers exactly its categories; unknown profile fails loudly; `doctor` prints the active profile |

## Phase 2: workflow features

| # | Item | Notes | Done when |
|---|------|-------|-----------|
| 4 | `composition_scan_folder` + `composition_load_loops` (extension) | Parse BPM / key / role from filenames (the user's library has keyed filenames), return a paginated list; `load_loops` creates named tracks (plain names, see `feedback_track_naming`) and inserts items at bars, optionally warped to project tempo. Sidecar `detect_key` / transients as a fallback when the filename has no metadata. | A folder scan returns parsed BPM/key/role; load is one `run_plan`-style undo block; unparseable files are listed, not guessed |
| 5 | Bus recipes as skills first | Sidechain, drum bus, parallel compression, vocal chain as `/mixer` workflow docs in `knowledge/workflows/` built on `run_plan` + `set_fx_pins` + `add_send`. Promote to a `setup_sidechain` tool only if agents keep getting the pin mapping wrong. | Each recipe verified live and measured (before/after LUFS, correlation) |
| 6 | Vocal chop pipeline (in the composition extension) | Split at transients (have), pitch to chord tones, stutter, reverse, fade, style rhythms. Build as an extension (`extensions/chops/`) so it stays out of core, via the `/new-extension` path. Start with primitives (`take_set_pitch`, `take_set_playrate`, reverse, duplicate), then the pipeline. | Primitives tested in wasmoon; pipeline produces a new track, never edits the source |
| 7 | ReaScript runner | `script_list` / `script_run` limited to the user's `Scripts/` tree, with the same safety gate as `run_action` (dialogs refused, quit/close refused). Decide first whether `run_action` on a script already covers it (`get_action` reads a script's path). | Decision recorded; if built, refused outside the Scripts tree |

## Phase 3: reach and onboarding

| # | Item | Notes | Done when |
|---|------|-------|-----------|
| 8 | Verify Windows and Linux (already claimed in the README) | Not a build item: the README lists macOS, Windows and Linux and Windows users appear in telemetry. Confirm the split by OS in Dash0 (dataset `reaper-mcp`), add an OS matrix to CI for the TS + wasmoon suites so it stays true, and fix whatever the Windows users' errors show. | Usage by OS known; CI green on all three; OS-specific errors ticketed |
| 9 | Other MCP clients | `reaper-mcp init --client claude-desktop|cursor` writes the right config file. Document Cursor, LM Studio and Claude Desktop in the README. | Each client config generated and documented |
| 10 | Visibility | Short demo video, a "what it does that others don't" README section (measurement, `run_plan`, status page, memory), listing in MCP registries, Discord or Discussions. | Registry listing live; demo linked in README |

## Deliberately not copying

- `engine_mix(style)` / `engine_master(style)` fixed style profiles: the opposite of measure-and-verify. A mix skill that reads
  the session and picks values from measurements stays the better design. If wanted, ship genre targets as knowledge records, not a pipeline.
- Single `command.json`/`response.json` IPC: our per-command UUID files support concurrent sessions.

## Order and sizing

1 → 2 → 3 first (days, each independent), then 4, 8, 9 (the biggest reach gains), then 5, 6, 7, 10.
Items 1 and 2 (one extension), 3 and 9 can run in parallel as separate PRs.

## Open questions

- Scaffold with `reaper-mcp extension new composition`; keep parsers inside the extension (no core imports, per the boundary rule).
- Prefer `api.bridge()` with `insert_midi_notes` over new Lua handlers.
