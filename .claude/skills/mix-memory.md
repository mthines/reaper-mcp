---
name: mix-memory
description: Recall and maintain the mixing skills' memory in the versioned knowledge base (~/.claude/knowledge/) — plugin knowledge (facts + settings) and self-healing process lessons. Modes — recall (load what's relevant before work), consolidate (merge + prune), promote (turn a recurring lesson into a hard rule), status (what's stored). Triggers on "what have you learned", "recall mixing memory", "consolidate memory", "promote that lesson", "/mix-memory".
disable-model-invocation: false
argument-hint: '[recall|consolidate|promote|status] [plugin-name|lesson-slug]'
---

# /mix-memory

Maintain and recall the two memory types the mixing skills learn into — plugin
knowledge and process lessons — both in the versioned knowledge base. The full
contract lives in `knowledge/reference/memory-protocol.md` — read it before any
write. Knowledge base: `~/.claude/knowledge/` (a symlink to the repo for cloned
installs, so writes are committable to the fork).

## Mode detection

Parse the first argument:

| Mode | Default | Trigger phrases |
|------|---------|-----------------|
| `recall` | **yes** | "what have you learned", "recall", "what do you know about {plugin}" |
| `consolidate` | | "consolidate memory", "compress memory", "tidy memory" |
| `promote` | | "promote that lesson", "make it a rule" |
| `status` | | "memory status", "what's stored", "list memory" |

State the detected mode + resolved store paths in one line before acting.

---

## recall

1. `Read ~/.claude/knowledge/lessons/mixing/INDEX.md` (process lessons) — surface
   the ones whose `trigger` tags match the current task.
2. For a named plugin: read `~/.claude/knowledge/plugins/{vendor}/{plugin}.md` and
   report it.
3. If no argument, summarise: how many lessons, which plugins have notes, anything
   flagged `status: structural` (promotion-eligible).

This is what the mixer/mastering skills do automatically at the start of work —
use this mode to inspect or prime memory manually.

---

## consolidate

Follow the **Consolidation** section of `memory-protocol.md`:
- Plugin `## Learned notes` → fold proven, repeated notes into `## Recommended
  settings` tables; archive the raw notes.
- Lessons → merge duplicates (sum `seen_count`), retire expired (`expires` past) to
  `~/.claude/knowledge/lessons/mixing/archive/`, rewrite a tight INDEX (≤200 lines).

Show a preview of merges/prunes and get confirmation before writing.

---

## promote

The self-heal step. For a lesson at `seen_count >= 3` or `status: structural`:
1. Show the lesson and the one-line hard rule it would become.
2. On approval, append that rule to the mixer skill's `## Hard Rules`
   (`.claude/skills/mixer.md`, or `~/.claude/skills/mixer.md` if installed globally;
   the `mastering` skill if mastering-specific).
3. Mark the lesson `status: retired` (keep it as an audit trail; the rule now
   guarantees the behavior).

Respect the entrenchment guards in `memory-protocol.md` — never promote a lesson
that would relax an existing hard rule.

---

## status

Print a compact summary: lesson count + how many are promotion-eligible, plugins
with personal notes (and their note counts), and the last consolidation date.
Suggest `consolidate` if either INDEX is near 200 lines.
