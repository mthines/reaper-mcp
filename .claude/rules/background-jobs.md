# Background jobs (bridge page)

A **background job** is work the bridge runs for the page on one click, detached so REAPER never blocks, while the page follows it: the **update** (`reaper-mcp update` / `scripts/update.sh`) and the **sidecar install** (`reaper-mcp setup-sidecar --yes`). A new one (anything slow the page can start) follows this pattern, so every job looks and behaves like the others. Code to copy: the sidecar install, the smaller of the two.

## The flow

1. **Page asks.** `request/<action>-<token>` in ExtState `MCPBridge` (`controlUrl()` in `lib/update.ts`, sent by `useBridgeRequest`). `action` is letters only (`update`, `sidecar`, `sidecarsep`); the token is the per-run one from the status feed. Add the action to `BridgeAction`. Only `restart` and `rebuild` expect the page to reload.
2. **Bridge runs it.** In `mcp_bridge.lua`, `check_control` starts one job at a time (a second request while one runs does nothing), detached: `( job > <name>.log 2>&1; echo $? > <name>.exit ) &`, with the node from `mcp_update.conf` first on PATH (REAPER from the Dock has a bare PATH). Not on Windows. The sidecar install keeps its state in one table (`sidecar_job`): the chunk is near Lua's 200-locals limit, so never add a local per job.
3. **Bridge reports.** Every second it reads the log tail (colours and `\r` redraws stripped) and the exit file, and publishes the job in `status.control`: `{ kind, state: running | done | failed (| current), startedAt, log }`, plus a `can…` flag when the job is possible (`canUpdate`, `canInstallSidecar`). Type it in `lib/status.ts` and keep the Lua and the type together.
4. **Page shows it, three places, one voice.**
   - **Toast** (`jobToast` in `components/JobToast.tsx`, one `<Toaster>` in `UpdateToasts`): `running` (a spinner and the step), then `done` / `info` / `failed`. One toast per job id. It speaks only for a job **this page watched start** (`watched` ref): the bridge keeps `done` and `failed` until it restarts, so a page opened later would announce an old job.
   - **Notice** (`app/Notices.tsx`): the standing reminder, with the action as the `Notice`'s `action`. One bold line (what is wrong), one muted line under it (why, and the command), the button at the right.
   - **The failed call's drawer** (when a failed tool is the reason for the job): the error, one sentence why, and the same action. Wired through a context so the drawer needs no props.
5. **Fall back to the command.** When the bridge can't run the job (`can…` false: Windows, ReaPack-only, an old bridge), the notice and drawer say the exact command to run by hand. A failed job says so, shows the log tail and offers Try again.

## Components (use these, never a second copy)

| Piece | Where |
| --- | --- |
| `jobToast.running/info/done/failed`, `JobFailure`, `Swap`, `lastStep`, `JOB_TOAST_THEME` | `components/JobToast.tsx` (import from `components/index.ts`) |
| `Sidecar.Fix` (button, progress, failure, command), `Sidecar.Toasts`, `Sidecar.Provider` | `features/sidecar/` |
| The update's toasts | `app/UpdateToasts.tsx`, built on `jobToast` |

Wording: toasts say what is happening in the present (`Installing audio analysis…`), then the result (`Audio analysis is installed`) and the next step for the person (`Ask the agent to try again.`). A failure names the reason first and the way out second. Never an emoji, never a bare "Error".

## Telling the agent

A job exists because a tool failed for a missing setup step. That tool's answer (see `sidecarNotInstalledMessage()` in `sidecar-hint.ts`) says what is wrong, that REAPER and the bridge are fine, that the **user** fixes it (the exact command), not to retry before then and not to install it itself, and what still works. The page's one-line log entry (`sidecarMissingLog()`) is what the notice and drawer are derived from; keep the server's and the page's matching (`isSidecarMissing`) in step.

## Checklist for a new job

- Lua: action in `check_control`, a detached run with log and exit files, state in `status.control`, a `can…` flag. Test in `bridge-status.test.ts` (start with the right flags, one at a time, wrong token ignored, done and failed read from the exit file, flag false without the CLI).
- Page: `BridgeAction` + `BridgeControl` types, toast through `jobToast` with the `watched` rule, notice, an action component with the four states (idle, running, done, failed) and the by-hand fallback.
- Stories for every state (`Default` side by side, `Playground`, a `StepByStep` for the toast) and play tests (`*.test.stories.tsx`) for what a viewer sees: the click sends the request, no button while running, silence for a job from before the page opened.
- `CLAUDE.md`'s bridge page section names the job; the guide for the feature (`docs/guides/`) says what the button does.
