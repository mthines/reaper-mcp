# Memory Protocol

How the mix skills recall and persist what they learn. Everything lives in the
**knowledge base** — one versioned layer — accessed at a stable path:

```
~/.claude/knowledge/            # the knowledge base (see "Where it resolves")
├── plugins/{vendor}/{plugin}.md   # PLUGIN memory — facts + settings, with context
└── lessons/mixing/                # PROCESS memory — procedural lessons, self-healing
    ├── INDEX.md                   #   ≤200 lines, ALWAYS read first
    └── entries/<yyyy-mm-dd>-<slug>.md
```

The mix skills get better over time by **reading** this before they act and
**writing** durable learnings back after.

## Where it resolves

`~/.claude/knowledge/` is the canonical path the skills read and write. With the
clone + symlink install (`scripts/sync-symlinks.sh`), it's a **symlink to your
clone's `knowledge/`** — so every write lands in the repo working tree: `git
status` shows it, `git log` tracks revisions, and committing to your fork ships it
to anyone who clones. This is the whole point: your plugins and lessons are
versioned and shareable.

If a project has its own `.claude/knowledge/` (a project-scoped install), prefer
that over the global one.

## Privacy guard

Only write audio knowledge — plugins and mixing. Never secrets, license keys, or
paths containing personal data.

---

## The self-improvement loop (every skill)

This loop is **general to all the mix skills** — `/mixer`, `/mastering`,
`/critique`, `/learn-plugin` — not just one. It is what makes them get better
over time instead of repeating mistakes. The design below is sound; the **only**
thing that breaks it is failing to capture — so capture is **mandatory and
reported**, never deferred to "later".

1. **Recall (start of every task).** Read `lessons/mixing/INDEX.md` and any
   relevant plugin notes before acting; treat matching lessons as soft
   constraints. A skill that changes nothing (e.g. `/critique`) still recalls —
   lessons sharpen what it looks for.
2. **Capture at the correction point — immediately, before your next action.**
   The moment the user reverts / rejects / overrides you, or a re-measure shows
   you made it worse, write the lesson; then **say you did** (file + one-line
   takeaway). Deferring it is how it gets lost. *No capture at all is the
   dominant failure of this loop — treat a silent skip as a bug.*
3. **End-of-session retrospective — always, even on a clean run.** Before the
   final report, ask: did the user correct or override me; did a measurement
   surprise me; did I guess at something that nearly didn't pay off; should a
   lesson I already had have fired earlier? Write or UPDATE a lesson for anything
   that surfaces (a recurrence bumps `seen_count`, never duplicates). Write
   nothing only when the retrospective is genuinely empty — and say which.
4. **Report what you captured.** The final message names the lesson(s) written
   (or states that none were), so a skipped capture is visible to the user.

"Read-only" skills (`/critique`) still write **process lessons about their own
analysis** — a flag the user corrected, a real problem they had to point out.
Read-only means they don't change the *mix*, not that they don't learn. The
promotion gate (`seen_count >= 3`) and the entrenchment guards below apply to
every skill.

---

## Plugin memory

### Read (before working with a plugin)
`Read ~/.claude/knowledge/plugins/{vendor}/{plugin}.md`. If it doesn't exist and
you're about to use the plugin, **bootstrap it first** (below).

### Bootstrapping an unknown plugin
Asked to use a plugin with no knowledge file, create one *before* mixing with it:

1. **Research the web** (`WebSearch` / `WebFetch`) — what it is, its category and
   character, key parameters, typical settings. Prefer the manufacturer's manual
   and reputable mixing sources.
2. **Inspect it live** — `add_fx` (or find it on a track) and `get_fx_parameters`
   for the **real parameter names and indices** of this build (ground truth).
3. **Write the file** at `~/.claude/knowledge/plugins/{vendor}/{plugin}.md` with
   frontmatter (`name`, `fx_match`, `category`, `style`, `vendor`, `preference`),
   a `## Recommended settings` section from research, and a `## Learned notes`
   section. `mkdir -p` the vendor dir first.
4. **Then use it** — and keep refining as you go.

`/learn-plugin` is the human-in-the-loop version of the same thing.

### Write — on a durable, reusable learning
Append to the file (creating it if needed) when you discover something worth
knowing next time:
- a **param-index map** verified via `get_fx_parameters`
- a **setting the user kept or approved** (not one you tried and reverted)
- a **gotcha** (non-linear param, VST2/VST3 index differs, a mode that breaks something)

No learning → no write. Record settings **with context** in `## Learned notes` —
never as an absolute rule:

```markdown
## Learned notes
- [2026-06-28] Bright female pop vocal — dynamic bell -4 dB @ 7.5 kHz tamed
  sibilance cleaner than a dedicated de-esser. (context: pop, bright vocal)
- [2026-06-28] Param map (VST3): Drive=2, Mix=5, Output=7. Drive non-linear above 0.7.
```

Context is mandatory — settings that work on a bright pop vocal can be wrong on a
dark rock one; capturing context is what stops the skill ossifying on one sound.
**Update, don't duplicate** — refine an existing note in place; if a new
observation contradicts an old one, keep both with their differing context.

> For a symlinked clone, mention to the user that the file changed so they can
> commit it to their fork (`git add knowledge/plugins/...`).

---

## Process memory (mixing lessons)

Procedural "do better next time" lessons about **your own process** — not facts
about the user's mix. Advisory input, never an automatic action.

### Read (at the start of any mixing task)
`Read ~/.claude/knowledge/lessons/mixing/INDEX.md`. Treat lessons whose `trigger`
tags match the task as **soft constraints**. If the INDEX nears 200 lines, suggest
`/mix-memory consolidate`.

### Write — at a correction point (immediately) or in the end-of-session retrospective
Write a lesson the moment the process goes wrong, **before your next action** —
not batched for the end — and tell the user you captured it. Triggers:
- the user **reverted** a snapshot you made, said "no, that's wrong", or
  **overrode** a target/decision you proposed
- a **re-measure** (meters/LUFS/correlation/crest) showed your change made it worse
- you hit a **recurring trap** (over-compressed, widened before checking mono, clipped the bus)
- the **end-of-session retrospective** surfaced friction even though nothing was
  formally reverted (a surprise, a near-miss, a lesson that should have fired)

One file per lesson, `lessons/mixing/entries/<yyyy-mm-dd>-<slug>.md`:

```markdown
---
type: process-lesson
seen_count: 1
status: active            # active → structural (promotion-eligible) → retired
expires: 2026-09-26       # ~90 days out; consolidate prunes stale ones
trigger: [bus-compression, crest-factor]
---
What happened: Applied 2:1 bus comp with no attack check; crest dropped to 5 dB
and the user reverted.
Why: Didn't read crest factor before compressing — assumed the mix needed glue.
Do next time: Read `read_track_crest` on the bus BEFORE adding compression. If
crest is already < 8 dB, propose dynamics restoration instead of more compression.
Promotion target: mixer skill → Hard Rules
```

Add/update a one-line pointer in `INDEX.md`. If a lesson already exists for the
same trap, **increment its `seen_count`** and sharpen "Do next time" instead of
adding a new file.

### Self-heal (the slow tier)
When a lesson reaches **`seen_count >= 3`** (or `status: structural`), surface it:

> "I've hit *'read crest before bus comp'* 3× now. Promote it to a permanent rule
> in the mixer skill?"

On approval, add a one-line hard rule to the **mixer skill**'s `## Hard Rules`
(`~/.claude/skills/mixer/SKILL.md`; the `mastering` skill if mastering-specific) and mark
the lesson `status: retired`. The recurring mistake becomes a guaranteed rule, no
longer dependent on recall.

### Entrenchment guards (non-negotiable)
1. Lessons are **advisory**; the only path to a behavior guarantee is the
   confirmed promotion edit above.
2. **Recurrence** (`seen_count >= 3`), not one bad run, gates promotion.
3. Every lesson **expires** (~90 days); `consolidate` prunes stale ones.
4. **Contradictions are flagged, not overwritten.**
5. A lesson must **never** relax an existing hard rule (e.g. "always snapshot
   before changes"). Those are invariants.

---

## Consolidation

Run via `/mix-memory consolidate` when an INDEX nears 200 lines or a plugin's
`## Learned notes` grows sprawling:
- **Plugin notes** → fold proven, repeated notes into the file's `## Recommended
  settings` tables; archive the raw notes.
- **Lessons** → merge duplicates (sum `seen_count`), retire expired ones to
  `lessons/mixing/archive/`, keep the INDEX tight.
