---
name: mix-memory
description: Recall and maintain the mixing skills' memory in LoreKit (scope project::reaper-mcp) — plugin knowledge records and self-healing process lessons, as a read-only built-in layer plus the user's own layer on top. Modes — recall (load what's relevant before work), consolidate (merge duplicate user lessons, fold proven plugin notes into recommended settings), promote (turn a recurring lesson into a hard rule), publish (maintainer only — move a user record into the built-in layer), status (what's stored, per layer). Triggers on "what have you learned", "recall mixing memory", "consolidate memory", "promote that lesson", "publish to built-in", "/mix-memory".
disable-model-invocation: false
argument-hint: '[recall|consolidate|promote|publish|status] [plugin-slug|lesson-slug]'
---

# /mix-memory

Maintain and recall the two kinds of memory the mixing skills keep in
**LoreKit** (scope `project::reaper-mcp`, via the `memory.*` MCP tools):

- **Process lessons** — tag `loop::mixing-lessons`
- **Plugin knowledge** — tag `plugin-knowledge`

Each comes in two layers: the built-in one, read through the `reaper` tools
`list_builtin_knowledge` / `get_builtin_knowledge` (public read-only token, no
LoreKit account needed), and the user's own, through `memory.*`:

| Layer | Keys | Tag | Writable here |
|-------|------|-----|---------------|
| Built-in (`reaper-mcp` org, curated) | `plugins::<vendor>/<plugin>`, `mixing-lessons::<slug>` | `layer::built-in` | only via `publish` |
| User (personal) | `user::plugins::<vendor>/<plugin>`, `user::mixing-lessons::<slug>` | `layer::user` | yes |

**Never write or `memory.delete` a built-in key outside `publish`** — a delete
without `org` archives the org row too.

The full contract — buckets, body shapes,
entrenchment guards — is `knowledge/reference/memory-protocol.md`; read it before
any write. If the `memory.*` tools are not connected, say so and stop.

## Mode detection

Parse the first argument:

| Mode | Default | Trigger phrases |
|------|---------|-----------------|
| `recall` | **yes** | "what have you learned", "recall", "what do you know about {plugin}" |
| `consolidate` | | "consolidate memory", "compress memory", "tidy memory" |
| `promote` | | "promote that lesson", "make it a rule" |
| `publish` | | "publish to built-in", "make it a default", "share this plugin record" |
| `status` | | "memory status", "what's stored", "list memory" |

State the detected mode in one line before acting.

---

## recall

1. Lessons: `memory.list { scope: "project::reaper-mcp", tags: ["loop::mixing-lessons"], order: "rank", limit: 5 }`
   — plus a `memory.search` on the current task's keywords. Surface those whose
   **Applies when** matches.
2. For a named plugin: `get_builtin_knowledge { key: "plugins::<vendor>/<plugin>" }`
   and `memory.read` of `user::plugins::<vendor>/<plugin>` (find the slug via the `fx::` tags if you
   only have an FX name) and report the combined record, marking what comes from
   the user's layer.
3. No argument: summarise — lesson count per layer, which plugins are known (built-in,
   user, or both; which have learned notes), anything
   promotion-eligible (`seen_count >= 3` or tag `status::structural`, not yet
   `status::promoted`).

This is what the mixer/mastering/critique skills do automatically at the start of
work — use this mode to inspect memory manually.

---

## consolidate

Show a preview of every change and get confirmation before writing.

Only `user::` records are touched — the built-in layer is read-only.

- **Lessons** — `memory.list` the bucket (`view: "summary"`), find near-duplicate
  `user::` lessons, merge each pair into the older key (rewrite its body with the
  sharper "Do this instead"), then `memory.delete` the duplicate. A `user::` lesson
  that just repeats a built-in one adds nothing beyond its recurrence count — keep
  it. Expiry is automatic — never archive by hand.
- **Plugin overlays** — when `## Learned notes` sprawl, or kept settings have
  proven themselves across contexts: fold them into the same `user::` record's
  `## Recommended settings` tables and trim them from the notes (read-merge-write,
  full tag list, no `ttl_days`). Param maps and gotchas stay in the notes.

---

## promote

The self-heal step. For a lesson at `seen_count >= 3` or tagged `status::structural`:
1. Show the lesson and the one-line hard rule it would become.
2. On approval, append that rule to the **`## Hard Rules` (or `## Rules`) of the
   skill that owns the behavior** — `mixer` for mix moves, `mastering` for
   master-bus moves, `critique` for analysis/flagging lessons
   (`.claude/skills/{skill}/SKILL.md`).
3. Re-write the lesson with the same key, value and `ttl_days`, adding the tag
   `status::promoted` (audit trail; it stops re-suggesting). For a built-in lesson,
   write that tag on a `user::` copy instead — or, as the maintainer, `publish` it.

Respect the entrenchment guards in `memory-protocol.md` — never promote a lesson
that would relax an existing hard rule.

---

## publish

Maintainer only: turn a proven `user::` record into a built-in default every user
of the `reaper-mcp` org sees.

1. `org.list` — continue only if the `reaper-mcp` org is listed with a writing
   role (member, admin or owner). A viewer, or no membership: say so and stop
   (the write would land in the personal store as a second copy).
2. Read the `user::` record and, if present, the built-in record of the same slug.
   Merge them (plugin: the overlay's sections over the built-in ones, learned
   notes folded together; lesson: the sharper body). Strip anything personal per
   the privacy guard. Show the merged record and get approval.
3. `memory.write` with `org: "reaper-mcp"`, the key **without** `user::`, the
   tags with `layer::built-in` in place of `layer::user`, and **no** `ttl_days`
   (curated records are permanent).
4. `memory.read` the built-in key to confirm, then `memory.delete` the `user::`
   key (never the built-in key).
5. **Plugin records only: update the built-in plugin list** (`docs/PLUGINS.md` in
   the reaper-mcp clone). Find the clone: the current directory when it has
   `scripts/plugin-list.mjs`, else the directory this skill is symlinked from
   (`readlink ~/.claude/skills/mix-memory` → `<clone>/.claude/skills/mix-memory`).
   Run `node <clone>/scripts/plugin-list.mjs`; it rebuilds the table from the
   built-in layer, so it also picks up anything published earlier. Show the
   changed rows and tell the maintainer to commit `docs/PLUGINS.md` (the
   bridge's one-click Update refuses while the clone has local changes). No
   clone found, or the script fails: say so; the daily **Plugin list** workflow
   updates the list on `main` anyway.

---

## status

Print a compact summary from `list_builtin_knowledge { limit: 100 }` (built-in) and
`memory.list { scope: "project::reaper-mcp", tags: ["loop::mixing-lessons", "plugin-knowledge"], view: "summary", limit: 100 }` (yours):
lesson count per layer (`layer::` tag) and how many are promotion-eligible,
nearest lesson expiries, and known plugins grouped by `category::` (with
preference, marked built-in / user / both). If the built-in tools error, say the
built-in layer is unreachable (offline) and the user's own layer works alone. Suggest `consolidate`
when duplicate lessons show up or a plugin record's notes sprawl.
