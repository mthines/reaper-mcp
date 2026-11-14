# Install-docs eval

How well do the install guides work when someone just points their agent at them ("set this up for me: <link>")?
This eval runs Claude Code headless on a throwaway machine, hands it a scenario's prompt, and grades two things:
what actually got installed, and whether the agent got there the way the guide says.

```bash
export CLAUDE_CODE_OAUTH_TOKEN=…        # `claude setup-token`, or ANTHROPIC_API_KEY
pnpm eval:install-docs                  # every default scenario, once, against this working tree's docs + package
pnpm eval:install-docs --runs 3 --scenario install-guide,docs-home
pnpm eval:install-docs --docs live --package registry   # what a user gets today
pnpm eval:install-docs --baseline       # no agent: the guide's three commands typed verbatim (the control)
node --test evals/install-docs/grade.test.mjs           # the grader's own tests
```

Each run writes `results/<stamp>/` (gitignored): `summary.md`, `summary.json`, and per run the agent's
`transcript.jsonl`, `facts.json` (what was found on the machine, `reaper-mcp doctor` output included) and `grade.json`.
The command exits 1 when a run misses a required check, so you can compare a docs change before and after.

## The machine

A temp folder with an empty `HOME`, a REAPER resource folder at the platform's default place (with a `reaper.ini`, as
after REAPER's first start, unless the scenario says otherwise), and only `node`, `npm`, `npx`, `git` and `claude` on
`PATH`, plus a `pgrep` that never finds REAPER. npm installs globally into the sandbox. Telemetry is off.

| Flag | Default | What it does |
|---|---|---|
| `--docs local\|live` | `local` | `local` copies `docs/guides` into `~/Downloads/reaper-mcp-docs` (with a generated `index.md` standing in for `/docs`) and hands the agent file paths; `live` hands it https://reaper-mcp.vercel.app/docs URLs. |
| `--package local\|registry` | `local` | `local` builds and packs this working tree; an `npm`/`npx` shim swaps `@mthines/reaper-mcp` for the tarball, so the agent types what the guide says. `registry` installs the published package. |
| `--runs N` | 1 | Agents vary run to run: use 3+ before drawing conclusions. |
| `--model`, `--budget USD`, `--timeout MIN` | default, 3, 20 | Passed to `claude -p` (`--max-budget-usd`). |
| `--keep`, `--no-build`, `--dry-run` | | Keep the sandbox to inspect it, reuse the last build, print the prompts only. |

The agent runs with permissions bypassed. HOME is the sandbox, but it is still a process on your computer: run the
eval in a VM or container if that matters to you. It cannot start REAPER, so it is expected to hand that step back.

## Scenarios (`scenarios.json`)

| Id | The user… |
|---|---|
| `install-guide` | pastes the install guide's link. |
| `docs-home` | only knows where the docs live. |
| `what-you-need` | starts at the first getting-started page. |
| `reaper-never-opened` | has never started REAPER (no `reaper.ini`). Only the CLI, registration and the hand-off are required. |
| `github-readme` *(opt-in)* | points at the GitHub repo, whose README installs from a clone. Clone-specific checks are skipped; it always reads the live README and the clone pulls `main`. |

A scenario is `{ id, prompt, reaperIni?, required?, skip?, optIn? }`. In `prompt`, `{page:<slug>}` becomes the guide's
URL or file and `{docs}` the docs home.

## Checks (`grade.mjs`)

Outcome checks weigh 2, process checks 1. The score is the weighted share passed. A run passes when every required
check passes (default: CLI installed, bridge installed, Claude Code lists `reaper`, skills installed, REAPER hand-off).

| Check | Kind | Passes when |
|---|---|---|
| `cli_installed` | outcome | `reaper-mcp` is in the npm global bin |
| `bridge_installed` | outcome | `Scripts/mcp_bridge.lua` is in the REAPER folder |
| `autostart` | outcome | `Scripts/__startup.lua` holds the bridge's startup block |
| `web_interface` | outcome | `reaper.ini` has the HTTP control surface for `mcp_bridge.html` |
| `claude_registered` | outcome | `claude mcp list`, from another folder, lists `reaper` |
| `skills_installed` | outcome | `~/.claude/skills/mixer/SKILL.md` exists |
| `documented_commands` | process | it ran `npm install -g @mthines/reaper-mcp`, `reaper-mcp setup` and `reaper-mcp init` (`setup --yes` counts for init) |
| `no_manual_config` | process | it did not run `claude mcp add … reaper` or edit a file the CLI manages |
| `no_clone`, `no_sudo` | process | no `git clone`, no `sudo` |
| `handoff_reaper` | process | its last message tells the user to start or restart REAPER (or run `mcp_bridge.lua`) |
| `handoff_verify` | process | its last message says how to check: `/mcp`, the status window, the tempo question, or `doctor` |

Alongside the checks the report shows turns, tool calls, failed tool calls, cost and time, and which pages the agent
read. A good guide shows as few turns, no failed commands, and no improvising: no hand-edited configs, no clone.
