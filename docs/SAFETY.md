# Safety: what the agent can and cannot do to a session

The first worry is usually "what if it deletes my project?". This page says what reaper-mcp guarantees, where each
guarantee lives in the code, and what it does **not** cover. Everything here is checked against the source; if a row
and the code disagree, the code wins and this page has a bug.

## What is enforced

| Guarantee | How it works | Where |
|---|---|---|
| **Read-only mode** | A switch in the bridge window. While on, only `get_*`, `list_*`, `read_*`, `analyze_*`, `search_*`, `measure_*`, `snapshot_list`, renders to a temp file, `play`, `stop`, cursor and time-selection moves pass. Everything else, including `record`, is refused with an error that tells the agent to ask you. Persists across REAPER restarts. | `readonly_allows()` in `reaper/mcp_bridge.lua` |
| **Pause** | A button in the bridge window. While on, every command fails until you resume. Resets when REAPER restarts. | `cfg_paused` in `reaper/mcp_bridge.lua` |
| **One change, one undo** | Each edit runs in one undo block labelled `MCP: …`, so `undo_project` (or Cmd/Ctrl+Z) reverts exactly that edit. A multi-step edit that fails half way is undone, but only when its own block is the top undo entry, so an earlier edit is never undone by mistake. `run_plan` is all-or-nothing the same way. | `with_undo` in `reaper/mcp_*_lib.lua`, `reaper/mcp_plan_lib.lua` |
| **Validate, then write** | Indexes, files, colors and paths are checked before the first write. A refused call changes nothing and says why. | the `*-lib.test.ts` suites |
| **No dialogs** | An action whose name ends in `...` opens a modal dialog that would freeze REAPER and the bridge, so `run_action` refuses it unless `allowDialog: true`. `save_project` without a path on a never-saved project is refused, and `render_project` refuses when a target file exists. | `reaper/mcp_actions_lib.lua`, `reaper/mcp_project_lib.lua` |
| **Never closes or quits** | Quit, close/open/new project, project tabs and switching tabs are always refused, including inside a `Custom:` macro (every step is checked). | `reaper/mcp_actions_lib.lua` |
| **The master track is never deleted** | `delete_track` refuses it. | `reaper/mcp_tracks_lib.lua` |
| **FX chains and templates stay in REAPER's folders** | `save_fx_chain` and `save_track_template` take a name under `FXChains/` or `TrackTemplates/`. Absolute paths, drive letters and `..` are refused. An existing file is replaced only with `overwrite: true`. | `resource_path()` in `reaper/mcp_items_lib.lua` |
| **See everything it does** | Every command is logged with timing and errors in the bridge window, tagged by session. | `apps/bridge-ui` |

## What is not enforced

- **Snapshots are not automatic.** The mix skills save a snapshot before and after a task, and `run_plan` has an
  optional `snapshotBefore`. The bridge never saves one on its own, so a raw tool call from another client does not
  get one.
- **Some things cannot be undone.** `snapshot_delete`; render files that `render_project` removes when you pass
  `overwrite: true`; the metronome and repeat toggles (REAPER does not undo them); and anything saved over your
  project file. Saving after a bad edit drops REAPER's undo history for it on reopen.
- **File writes are not all confined to REAPER's folders.** `save_project` with `path` writes any absolute `.rpp`,
  `render_project` / `render_versions` write to the project's render directory, and `separate_stems` writes to its
  `outDir`. Each refuses to overwrite an existing file unless you pass `overwrite: true`.
- **The action gate reads names, not behavior.** A ReaScript or SWS action can still open its own prompt.
- **Extensions are code.** An extension runs as your user, TypeScript in the MCP server and Lua in REAPER, with no
  permission model. Their tools are not in the allow-list `reaper-mcp init` writes, so Claude Code asks before each new
  one. See [Trust](EXTENSIONS.md#trust).
- **Your model sees what the tools return.** Track names, FX settings and file paths go to whichever model your client
  uses. reaper-mcp trains nothing and sends nothing elsewhere, apart from [opt-out usage telemetry](../TELEMETRY.md).

## Habits that make it boring

1. **Save, then work on a copy** of a project that matters (`save_project` with a `path` writes a copy and keeps the
   open project where it is).
2. **Turn on read-only mode** when you only want it to listen, measure or advise (`/critique` never writes either).
3. **Ask for a dry run** of a big edit: `run_plan` with `dryRun: true` lists what it would do and any conflicts.
4. **Snapshot first** for anything you may want to A/B: ask for one, or let the mixer skill do it.
5. **Keep the bridge window open** next to REAPER. Pause is one click.
