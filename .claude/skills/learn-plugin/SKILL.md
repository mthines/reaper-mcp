---
name: learn-plugin
description: Teach the mixing skills one plugin or a list of them (researched in parallel): researches each on the web, tests it live in REAPER and writes its plugin knowledge record to LoreKit, asking the user only what it couldn't work out
---

# /learn-plugin

This skill teaches the mixing skills a plugin. It writes the plugin's **plugin
knowledge record** to the user's own LoreKit layer: scope `project::reaper-mcp`,
key `user::plugins::{vendor}/{plugin}`, following
`knowledge/reference/memory-protocol.md`.

It does the work itself before asking anything. The **`plugin-researcher`**
agent researches the plugin on the web, loads it on a scratch track, probes its
parameters, and writes the record. Then this skill asks the user **only** the
questions the agent couldn't answer, and folds the answers in.

The mixing skills use the same agent to bootstrap plugins they don't know. To
recall or tidy memory, use `/mix-memory`. If the `memory.*` tools are not
connected, say so and stop.

## Trigger

The user types `/learn-plugin [plugin]`, or asks Claude to "learn about a
plugin", "research this plugin" or "add plugin knowledge".

## Instructions

### Step 1: Get the plugin name(s)

Take them from the arguments: one plugin, or a list (one per line, or comma
separated). If there are none, ask a single question:

> "Which plugin should I learn?"

If the user already said something about one (what they use it for, how they
set it up), keep it as caller context for that plugin in Step 2. Don't ask for
anything else yet.

### Step 2: Dispatch the researchers, all at once

One `plugin-researcher` per plugin, **all in the same message** so they run in
parallel. Even when the user says "one at a time", run them in parallel: the
agents are built for it, and only the questions are asked plugin by plugin.
Give each one a short, unique uppercase tag for its scratch track:

```text
Agent(subagent_type: "plugin-researcher",
      prompt: "Plugin: <exact name>\nScratch track tag: <TAG, e.g. PROQ4>\nCaller context: <anything the user said, or 'none'>")
```

Tell the user what is happening, in one line: each researcher looks the plugin
up on the web and briefly adds a scratch track `[MCP] plugin-research <TAG>` to
their project, which it removes afterwards. Several at once can make REAPER lag
for a moment while heavy plugins load. Then wait for the reports. As each one
arrives, give a one-line status (key, proposed preference, what was verified
live, number of open questions). Don't ask yet.

**No `plugin-researcher` agent available** (the Agent tool is missing, or the
agent isn't installed)? Do its steps here instead. Read
`~/.claude/agents/plugin-researcher.md` (in the repo:
`.claude/agents/plugin-researcher.md`) and follow it.

### Step 3: Ask only the open questions

Show the report's summary lines: the key written, FX names, category/style,
what was verified live, sources.

Then ask **only** the report's open questions, all at once in one
`AskUserQuestion` call (up to 4). Each question offers the value the agent
already wrote as the first option, labelled "(keep)":

- **Preference:** offer the proposed number plus the neighbouring bands from
  the field guide (e.g. "65 — good third-party (keep)", "80 — go-to",
  "45 — fallback only").
- **Habit or settings questions:** offer "Use the researched defaults (keep)"
  and let the user type their own in "Other".

More than 4 open questions? Ask the 4 that change the record the most. List the
rest as already filled in from research, and say the user can change them with
another `/learn-plugin`.

No open questions besides preference? Ask only the preference confirmation.

**Several plugins:** start asking once most reports are in, without waiting for
a slow last one. `AskUserQuestion` takes 4 questions per call, so batch across
plugins and name the plugin in every question:

1. Preferences first, 4 plugins per call. Two utilities with the same kind of
   question can share one question.
2. Then the facts about the user's setup that change the records the most,
   e.g. what an offline instance or a hardware-control track is for.
3. Then habits, settings and naming questions, which matter less.

Stop after about 3–4 calls. Anything still unasked keeps the researched value;
list those questions at the end, and say the user can change any of them with
another `/learn-plugin`. When an answer can be checked in REAPER (e.g. "it was
offline, check again"), check it read-only and fold in what you find.

### Step 4: Fold the answers in

Answers that only kept the agent's values change nothing; skip the write.
Otherwise `memory.read` the `user::` key and change only what the user answered:

- preference → the header line **and** the `preference::<n>` tag
- when they pick it → `## When to prefer this`
- their own settings → a `###` use case under `## Recommended settings`,
  marked as the user's own

Then `memory.write` the full record and full tag list (a write replaces both),
with `source_agent: "learn-plugin"` and no `ttl_days`. Keep everything else the
agent wrote, `## Learned notes` included.

**Several plugins:** make the writes in parallel, one subagent per record, or a
single subagent for several records that only change the preference. Give each
one the key, the exact changes, and the rule to keep everything else word for
word.

### Step 5: Confirm

> "Done! **[Plugin Name]** is saved to LoreKit as
> `user::plugins::{vendor}/{plugin}` (preference n/100, [category]).
> [Verified live: N params, the scaling of K of them. | Not tested live: reason.]
>
> The mixing skills will use it for **[category]** jobs when it's your
> highest-preference installed plugin, and will add to its learned notes as they
> work with it."

If the report said the scratch track couldn't be removed, say that first and
name the track.

**Several plugins:** one table instead (plugin, key, preference, category,
verified live), then the Step 6 overviews, shortened to a few lines each.

### Step 6: Show how it works

Always end with the overview from the report's **How it works** section, under
the heading **"How [Plugin Name] works"**. Update it with the user's answers
from Step 3 first: fill in or correct **Your setup**, and adjust **In practice**
where an answer changes what the mixer can do. Keep the agent's structure (what
it is, the key point, the control table, presets, your setup, in practice). Keep
it plain, not fancy.

The report has no overview (an older agent, or you did the steps inline)?
Write one in that structure from the final record.

## Notes

- **Ask little.** Anything the web or REAPER can answer (exact FX name, vendor,
  category, parameters, ranges, presets, typical settings) is never asked.
  The user is asked about their taste and habits, or a fact the sources disagree
  on and testing couldn't settle.
- **Self-improvement loop (per `memory-protocol.md`).** The main output is the
  plugin record. If a run shows a recurring process lesson (e.g. a vendor whose
  FX names don't match its marketing name, a category that's often mis-picked,
  a plugin type whose params can't be probed), dedup-search and write or update
  a `user::mixing-lessons::<slug>` lesson (`source_agent: "learn-plugin"`) and
  mention it.
- The `fx::` tags must be the **exact** FX-browser names. They're matched as
  case-insensitive substrings of installed FX names. The agent takes them from
  `search_fx`, so they always match this machine.
- The header line and the tags must stay in step: lookups filter on the tags,
  people read the header.
