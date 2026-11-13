# Updating reaper-mcp

How an installed reaper-mcp updates itself, what each kind of install does, and how to test it.

## For users

| You installed with | Update with |
| --- | --- |
| npm | Press **Update** on the bridge page in REAPER, or run `reaper-mcp update` in a terminal |
| A git clone | **Update** on the bridge page, or `scripts/update.sh` (`git pull --ff-only`, then the installer) |
| ReaPack | ReaPack updates the REAPER files. The server and Claude Code side is still npm: `reaper-mcp update` |

**Update** on the page downloads in the background and shows a toast: "Updating reaper-mcp…" while it runs, then
"reaper-mcp is up to date" with a **Reload** button. The page never reloads by itself. After Reload, restart Claude Code
(or type `/mcp` there) to load the new tools. If nothing newer exists the toast says "Already up to date"; if something
fails it says so and the notice above keeps a **Try again**.

## How it works

```text
page: Update ──► ExtState MCPBridge/request/update-<token> ──► Lua bridge (mcp_bridge.lua, start_update)
                                                                   │ reads Scripts/mcp_update.conf
                                                                   ▼
                        npm install:  node <cli> update --bridge      clone:  bash <clone>/scripts/update.sh
                                                                   │ detached, output → update.log, exit code → update.exit
                                                                   ▼
                       status.control.update.state: running → done | current | failed   ──► page toast
```

- **`mcp_update.conf`** is `key=value`, written by `reaper-mcp setup`. A clone writes `repo=<path>`; an npm install writes
  `mode=npm`, `node=<node binary>`, `cli=<main.js>` and `dev=0`. Without it (or without the files it names) the page can't
  run the update and shows the manual commands instead (`control.canUpdate`).
- **`reaper-mcp update`** (`apps/reaper-mcp-server/src/update.ts`): asks npm for the latest installable version, runs
  `npm install -g @mthines/reaper-mcp@<version>` with the npm beside the running node, then `node <cli> setup --yes` in a
  fresh process so the new code does the REAPER side. `--force` reinstalls even when nothing is newer.
- **Exit codes:** 0 updated (or already current), 1 download failed or npm unreachable, 2 downloaded but `setup` failed,
  3 already current under `--bridge`. The bridge maps 0 → `done`, 3 → `current`, anything else → `failed`. `done` restarts the
  bridge (`set_action_options(3)`); `current` does not, because nothing was installed.
- **Which version counts as "latest":** the abbreviated package document (`Accept: application/vnd.npm.install-v1+json`),
  and only when its `dist-tags.latest` is also a key in `versions`. npm's `/latest` shortcut can name a release `npm install`
  cannot resolve (`ETARGET`; 0.83.1 and 0.83.2 sat in that state for a while). The server (`update-check.ts`) and the page
  (`installableNpmVersion()` in `apps/bridge-ui/src/lib/update.ts`) use the same rule, so the page never offers what the
  command cannot install. For an npm install the page asks npm (`control.updateSource: "npm"`); for a clone it asks GitHub.
- **Developer mode** (`dev=1`, a clone on a branch other than `main`, or with local changes) hides the release notice and shows
  **Rebuild & reload** instead (`update.sh --rebuild`). An npm install never rebuilds.
- **Windows:** the bridge-started updater is off; `reaper-mcp update` works from a terminal (npm is run through a shell there).
  This path has not been run on Windows.
- **Telemetry:** `update_finished {result: ready|current|failed, source}` and `update_reload_clicked {source}`
  (`apps/bridge-ui/tracking-plan.yaml`).

## Testing

| What | How |
| --- | --- |
| Logic, exit codes, config, status mapping | `pnpm nx test reaper-mcp-server` (`update.test.ts`, `update-check.test.ts`, the update cases in `bridge-status.test.ts`, which run the real bridge in wasmoon) |
| The page: offer, toasts, Reload | `pnpm nx test bridge-ui` (`UpdateToasts.test.stories.tsx`, `Notices.test.stories.tsx`, `update.test.ts`) |
| The CLI against the real npm registry, in a sandbox | `scripts/test-update.sh` (below) |
| The button, bridge restart and toast in a real REAPER | Manual, on a clean npm install, once a release newer than the installed one is on npm (below) |

### `scripts/test-update.sh`

Needs node, npm and a network; build first (`pnpm nx run-many --target=build`). It packs this working tree as `99.0.0`,
installs it into a throwaway npm prefix and then runs, in order:

1. `setup --yes` → expects `mcp_update.conf` with `mode=npm`, this node and CLI, `dev=0`, and the bridge in the sandbox REAPER;
2. `update --bridge` → expects exit 3 and the install unchanged (99.0.0 is newer than anything on npm);
3. `update --force --bridge` → downloads npm's real latest, replaces the install, runs `setup --yes`; expects exit 0.

`HOME`, the npm prefix and cache and `REAPER_RESOURCE_PATH` all point into the sandbox, and telemetry and the update check are
off, so your REAPER, `~/.claude` and global npm packages are never touched. Step 3 also proves npm can resolve its own `latest`.
`KEEP=1` keeps the sandbox for inspection; a failure keeps it and prints the log tails. Run it before and after every release.

### Testing the real button

The button only exists in releases that include the updater, so the first real test is the release *after* the first one that
ships it (0.83.2 and earlier have no button):

1. On a clean profile (another macOS user, or a machine without the clone), `npm install -g @mthines/reaper-mcp@<first release with the updater>`,
   `reaper-mcp setup && reaper-mcp init`, then start REAPER.
2. Publish the next release. Open the bridge page; an **Update available** pill and notice appear (checked against npm).
3. Press **Update**: the loading toast, then "reaper-mcp is up to date" with **Reload**. Press Reload; the footer shows the new
   version. `update.log` and `update.exit` in `Scripts/mcp_bridge_data/` hold the run.
4. `npm ls -g @mthines/reaper-mcp` shows the new version.

Keep a git clone for development (it stays in developer mode); it can't prove the npm path, because a clone runs `update.sh`.

### Not covered yet

- **ReaPack installs.** `setup` leaves the REAPER files to ReaPack once it installed the bridge, so the button would update the
  server but not ReaPack's copy of the bridge files. Whether `mcp_update.conf` is written for that layout is untested.
- **Windows.** See above.
- **Publishing.** The update can only install what npm lists. Check the registry directly after a release
  (`npm view @mthines/reaper-mcp dist-tags`); a green release job has not always meant the package arrived.
