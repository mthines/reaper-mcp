# Memory Protocol

How the mix skills recall and persist what they know.

| What | Where |
|------|-------|
| **Reference knowledge** — genres, workflows, reference material | `~/.claude/knowledge/` (symlink to the repo's `knowledge/`, versioned in git) |
| **Plugin knowledge + process lessons** | **LoreKit**, scope `project::reaper-mcp`, via the `memory.*` MCP tools — in two layers, below |

## The two layers

| Layer | Owner | Keys | Tag | Who writes it |
|-------|-------|------|-----|---------------|
| **Built-in** | the `reaper-mcp` LoreKit org — curated by the maintainer | `plugins::<vendor>/<plugin>`, `mixing-lessons::<slug>` | `layer::built-in` | Only the maintainer, via `/mix-memory publish`. **Read-only for the skills.** |
| **User** | each user's personal store | `user::plugins::<vendor>/<plugin>`, `user::mixing-lessons::<slug>` | `layer::user` | The mix skills, automatically, for whoever runs them |

**Reading the built-in layer — everyone, no LoreKit account needed:** the `reaper`
MCP server ships a public read-only LoreKit token and exposes the layer as two tools:

| Tool | Does |
|------|------|
| `list_builtin_knowledge { kind?, tags?, query?, limit? }` | `kind`: `plugins` / `lessons` / `all`. Without `query`: summaries (key, tags, preview), `tags` OR-filtered (e.g. `["category::eq"]`). With `query`: full-text search with full bodies |
| `get_builtin_knowledge { key }` | One record by its built-in key (`plugins::…` / `mixing-lessons::…`), or `record: null` |

**Reading and writing the user layer** goes through the user's own LoreKit
connection (`memory.*`). Org members also get the built-in rows back from `memory.*`
(org and personal rows come back together); the `layer::` tag tells them apart
(responses carry no owner field), so every record carries one — skip
`layer::built-in` rows there, the built-in tools already returned them.

Without the user's own LoreKit connected, the skills still get the built-in layer;
they just can't write anything.

### Hard rules for the two layers

1. **Never write a built-in key** (`plugins::…`, `mixing-lessons::…`) from a skill.
   Every skill write goes to the `user::` key, with no `org`.
2. **Never `memory.delete` a built-in key.** A delete without `org` archives
   *every* row with that scope + key the caller can write — for an org member that
   includes the built-in row. Only ever delete `user::` keys.
3. **The `user::` prefix is mandatory, not cosmetic.** When a personal row and an org
   row share scope + key, `memory.read` silently returns whichever was updated
   last; distinct keys are what keep both layers visible.

**Not connected?** If the `memory.*` tools are unavailable, say so in one line and
continue on the built-in layer plus general mixing knowledge — nothing is written.
If the built-in tools error (offline), continue on the user layer alone.

## Privacy guard

Only write audio knowledge — plugins and mixing. Never secrets, license keys,
names of the user's clients/songs, or paths containing personal data. A candidate
record that contains one is **dropped, not written**.

---

## The self-improvement loop (every skill)

This loop is **general to all the mix skills** — `/mixer`, `/mastering`,
`/critique`, `/learn-plugin`. The **only** thing that breaks it is failing to
capture — so capture is **mandatory and reported**, never deferred to "later".

1. **Recall (start of every task)** — the read step below. A skill that changes
   nothing (`/critique`) still recalls; lessons sharpen what it looks for.
2. **Capture at the correction point — immediately, before your next action.**
   The moment the user reverts / rejects / overrides you, or a re-measure shows
   you made it worse, write the lesson; then **say you did** (key + one-line
   takeaway). *No capture at all is the dominant failure of this loop — treat a
   silent skip as a bug.*
3. **End-of-session retrospective — always, even on a clean run.** Before the
   final report, ask: did the user correct or override me; did a measurement
   surprise me; did I guess at something that nearly didn't pay off; should a
   lesson I already had have fired earlier? Did a lesson I applied work? Write or
   UPDATE a lesson for anything that surfaces. Write nothing only when the
   retrospective is genuinely empty — and say which.
4. **Report what you captured.** The final message names the record(s) written
   (or states that none were), so a skipped capture is visible to the user.

"Read-only" skills (`/critique`) still write **process lessons about their own
analysis**. Read-only means they don't change the *mix*, not that they don't learn.

---

## Read step (start of every task)

Lessons are capped — at most 5 per layer per read, so memory never crowds out the session.

```text
# built-in
list_builtin_knowledge { kind: "lessons", query: "<task / area keywords>", limit: 5 }
# yours
memory.list   { scope: "project::reaper-mcp", tags: ["loop::mixing-lessons"], order: "rank", limit: 5 }
# when the task names an area (drum bus, vocals, limiting, track numbering…), one targeted search:
memory.search { q: "<area keywords>", scopes: ["project::reaper-mcp"], tags: ["loop::mixing-lessons", "layer::user"], limit: 5 }
```

Match each lesson's **Applies when** line against the task and apply the matching
**Do this instead** lines as **soft constraints** — they bias the run unless they
conflict with the user's stated intent (the user wins; say so). When a built-in
lesson and a `user::` lesson with the same slug both match, the user's wins.

### Plugin lookup

**Pick a plugin for a job** (which EQ / compressor / limiter to use):

```text
list_available_fx                                              # what is installed
list_builtin_knowledge { kind: "plugins", tags: ["category::<category>"], limit: 100 }        # built-in
memory.list { scope: "project::reaper-mcp", tags: ["category::<category>"], view: "summary", limit: 100 }   # yours
```

A record matches an installed FX when any of its `fx::<pattern>` tags is a
case-insensitive substring of the installed name. Group the results by
`plugin::<vendor>/<plugin>`; when a plugin has both layers, the **user record's
tags win** (its `preference::` overrides the built-in one). The highest
`preference` wins; when the user asks for a character (`transparent`,
`vintage`, …) prefer a matching `style::` tag. Nothing matches → fall back to the
stock REAPER plugin for that category.

**Before touching a plugin** (adding it, setting a parameter, interpreting one on
the chain), read both layers:

```text
get_builtin_knowledge { key: "plugins::<vendor>/<plugin>" }                             # built-in (may be null)
memory.read { scope: "project::reaper-mcp", key: "user::plugins::<vendor>/<plugin>" }   # yours (may be absent)
```

No key at hand (you only have the FX name from a track)? Find it via the `fx::`
tags of `list_builtin_knowledge { kind: "plugins", limit: 100 }` and
`memory.list { scope: "project::reaper-mcp", tags: ["plugin-knowledge"], view: "summary", limit: 100 }`.
Neither layer has it → bootstrap it (below) before using the plugin.

**Combining the two:** the user record is an overlay. A section it contains
replaces the built-in section of the same heading; `## Learned notes` from both
apply (user notes first, and they win on a conflict); everything else comes from
the built-in record.

---

## Plugin knowledge

### The record

One record per plugin per layer, pure markdown (no frontmatter, no HTML comments,
no dates or counts — the store and tags carry those). The header line repeats the
tag facts for human readers; the tags are what lookups filter on, so keep the two
in step.

```markdown
# <Plugin name>

**Category:** <category> · **Style:** <style> · **Vendor:** <Vendor> · **Preference:** <n>/100  
**Matches FX:** `<exact REAPER FX name>`, `<alternate>`  
**Replaces:** `<stock id>`

## What it does

<one paragraph — purpose, sonic character, primary use cases>

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|

## Recommended settings

### <Use case>

| Parameter | Value | Why |
|-----------|-------|-----|

## Presets worth knowing

## When to prefer this

## Learned notes

**Param indices (<VST3|VST|AU|JS>, N params):** 0 Name · 1 Name · …

**Normalized (0–1) scaling, verified by probing:**

- <Param>: <mapping> (<probe → readback>)

**Gotchas:** <…>

**Kept settings (with context):**

- <Context — genre, source, goal>: <setting the user kept and why it worked>
```

A **user overlay** for a plugin that already has a built-in record needs only the
header (so its tags can be set) and the sections it adds or overrides — usually
just `## Learned notes`. A plugin the built-in layer doesn't know gets a full record.

Field guide:
- **category** — `eq`, `compressor`, `limiter`, `saturator`, `reverb`, `delay`,
  `gate`, `de-esser`, `amp-sim`, `channel-strip`, `analyzer`, `stereo-imager`,
  `multiband`, `pitch-correction`.
- **style** — `transparent`, `character`, `vintage`, `modern`, `surgical`.
- **preference** — 30–50 stock/fallback, 55–70 good third-party, 70–85 go-to,
  85–95 industry standard. Decides which plugin wins in a category.
- **fx patterns** — the exact strings REAPER shows (`VST3: Pro-Q 3 (FabFilter)`)
  plus a short form (`Pro-Q 3`); add VST and VST3 variants. Matching is a
  case-insensitive substring.
- **replaces** — stock plugin slugs this supersedes (`rea-eq`, `rea-comp`).

Write (user layer — the only layer a skill writes):

```text
memory.write {
  scope:   "project::reaper-mcp",
  key:     "user::plugins::<vendor>/<plugin>",
  value:   "<the markdown record or overlay>",
  tags:    ["plugin-knowledge", "layer::user", "plugin::<vendor>/<plugin>", "category::<cat>",
            "vendor::<vendor>", "preference::<n>", "style::<style>", "fx::<pattern>", …, "replaces::<id>", …],
  kind:    "signal",
  host:    "mixing",
  trigger: "<manual | gotcha | paid-off>",
  source_agent: "<mixer | mastering | critique | learn-plugin>"
}
```

No `ttl_days` — plugin knowledge does not expire. An overlay copies the built-in
record's tags (changing only what the user overrides) so lookups by category and
FX name still find it. A write **replaces** the whole record (value *and* tags), so
always read-merge-write the `user::` key.

### Bootstrapping an unknown plugin
Asked to use a plugin neither layer knows, create a user record *before* mixing
with it. Dispatch the **`plugin-researcher`** agent with the plugin name (and
what you need it for) and wait for its one-paragraph report. That keeps the web
pages and parameter dumps out of your context. Its steps, which you follow
inline when the agent isn't available:

1. **Research the web** (`WebSearch` / `WebFetch`): what it is, its category and
   character, key parameters, typical settings. Prefer the manufacturer's manual.
2. **Test it on a scratch track** (`[MCP] plugin-research`, never the user's
   tracks): `get_fx_parameters` for the **real parameter names and indices** of
   this build (ground truth). Probe the key params at 0/0.25/0.5/0.75/1 and read
   the formatted values back to get their scaling. Then delete the scratch track.
3. **Write the record** above: research in the main sections, the verified param
   map and scaling under `## Learned notes`. The preference is a proposal from
   the field guide.
4. **Then use it**, and keep refining it as you go. Mention the proposed
   preference to the user once; don't block the mix on it.

`/learn-plugin` runs the same agent, then asks the user only what it couldn't
work out.

### Update — on a durable, reusable learning
Fold into the `user::` record's `## Learned notes` (creating the overlay if the
plugin only has a built-in record) when you discover something worth knowing next
time:
- a **param-index map / normalized scaling** verified via `get_fx_parameters`
- a **setting the user kept or approved** (not one you tried and reverted)
- a **gotcha** (non-linear param, VST2/VST3 index differs, a mode that breaks something)

No learning → no write. Refine notes in place, don't duplicate; if a new
observation contradicts an old one (or the built-in notes), keep both with their
differing context. Context is mandatory on kept settings — a setting that works on
a bright pop vocal can be wrong on a dark rock one.

---

## Process memory (mixing lessons)

Procedural "do better next time" lessons about **your own process** — not facts
about the user's mix. Advisory input, never an automatic action.

### Write — at a correction point (immediately) or in the retrospective
Triggers:
- the user **reverted** a snapshot you made, said "no, that's wrong", or
  **overrode** a target/decision you proposed
- a **re-measure** (meters/LUFS/correlation/crest) showed your change made it worse
- you hit a **recurring trap** (over-compressed, widened before checking mono, clipped the bus)
- the **retrospective** surfaced friction, or a lesson you applied paid off

1. **Deduplicate** — a recurrence must UPDATE, not add:

   ```text
   memory.search { q: "<key words of the lesson>", scopes: ["project::reaper-mcp"], tags: ["loop::mixing-lessons"], limit: 10 }
   ```

   Also run `list_builtin_knowledge { kind: "lessons", query: "<same words>" }`.
   A match on a `user::mixing-lessons::<slug>` → rewrite that key. A match on a
   **built-in** `mixing-lessons::<slug>` → write `user::mixing-lessons::<slug>`
   (same slug, so the two read as one lesson; it carries your recurrence count).

2. **Write** — to the user layer only:

   ```text
   memory.write {
     scope:    "project::reaper-mcp",
     key:      "user::mixing-lessons::<kebab-slug>",
     value:    "<markdown body — shape below>",
     tags:     ["loop::mixing-lessons", "layer::user", "source::<trigger>", "topic::<area>"],   # + "status::structural" for a design gap
     trigger:  "<assumption-wrong | gotcha | near-miss | stuck-loop | paid-off>",
     ttl_days: 90,
     source_agent: "<mixer | mastering | critique | learn-plugin>",
     cited:    ["project::reaper-mcp::mixing-lessons::<slug>", …]   # lessons that actually shaped this run
   }
   ```

   Same scope + key overwrites in place: **the store increments `seen_count`**
   and re-passing `ttl_days` refreshes the expiry. Never write a count, date or
   status into the body. A lesson you applied that *worked* is still worth an
   UPDATE — successful application is recurrence evidence.

Body shape — one lesson per record, ~1,500 characters max:

```markdown
# <one-line takeaway — what to do, not what it is about>

**Applies when:** <concrete signal — task, bus/track type, tool name, measurement>

**What happened:** <the concrete observable>
**Why:** <root cause, or "unknown">
**Do this instead:** <prescriptive, testable instruction>
**Promotion target:** <skill → Hard Rules, or "none">
```

No run residue (no song names, session narrative or timestamps) — a lesson is
written for the *next* session, which has none of that context.

### Self-heal (the slow tier)
When a `user::` lesson has **`seen_count >= 3`** (the store's column) or carries
`status::structural`, surface it — never act silently:

> "I've hit *'read crest before bus comp'* 3× now. Promote it to a permanent rule
> in the mixer skill?"

On approval, add a one-line hard rule to the owning skill's `## Hard Rules`
(`.claude/skills/{mixer|mastering|critique}/SKILL.md`), then UPDATE the lesson
adding the `status::promoted` tag (keep it as the audit trail of why the rule
exists; it stops re-suggesting). A lesson worth sharing with every user can also be
published to the built-in layer (below) — suggest it, never do it unasked.

### Entrenchment guards (non-negotiable)
1. Lessons are **advisory**; the only path to a behavior guarantee is the
   confirmed promotion edit above.
2. **Recurrence** (`seen_count >= 3`), not one bad run, gates promotion.
3. User lessons **expire** (`ttl_days: 90`, refreshed on recurrence) — the store
   drops stale ones. Built-in lessons and plugin records are curated, so they do
   not expire.
4. **Contradictions are flagged, not overwritten** — the dedup search finds the
   prior lesson; a genuine reversal is the user's call.
5. A lesson must **never** relax an existing hard rule (e.g. "always snapshot
   before changes"). Those are invariants.
6. **Lesson reads are capped** (5 per query) so memory never crowds out the session.

---

## Publishing to the built-in layer (maintainer only)

`/mix-memory publish <key>` turns a proven `user::` record into a built-in one. It
needs write access to the `reaper-mcp` org (member/admin/owner) — for everyone
else the write lands in their personal store, so check `org.list` first and stop
if the role is `viewer` or the org is absent.

1. Read the `user::` record and, if one exists, the built-in record of the same
   name; merge them (for a plugin: the overlay's sections over the built-in ones,
   notes folded together) and show the result for approval.
2. Write it with `org: "reaper-mcp"`, the key **without** `user::`, tag
   `layer::built-in` instead of `layer::user`, and **no** `ttl_days`.
3. `memory.delete` the `user::` key (safe — never delete the built-in key).

## Consolidation

Run via `/mix-memory consolidate` when the user's notes sprawl or lessons overlap.
It only ever touches `user::` records:
- **Plugin overlays** → fold proven, repeated kept settings from `## Learned notes`
  into the overlay's own `## Recommended settings`; keep param maps and gotchas.
- **Lessons** → merge near-duplicate `user::` lessons into the older key (rewrite
  its body, then `memory.delete` the duplicate). Expiry is automatic.
