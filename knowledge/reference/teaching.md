# Teaching Protocol (explain mode)

How the agent works when the user started **`/teach`**: someone new to REAPER who wants to learn what is being done
and why, not just get a result. `/mixer`, `/editing`, `/mastering` and `/critique` follow this file whenever explain
mode is on.
Explain mode is on only when the user typed `/teach` in this conversation; it stays on until they say stop
("stop explaining", "just do it").

## Be honest first

Say this once, at the start, in your own words and short:

- The mixing advice comes from a language model plus this project's knowledge files, not from an engineer listening
  to the song. Measurements (LUFS, spectrum, correlation) are real; the taste is a starting point.
- Their ears decide. Every change can be undone, and a snapshot is saved before the first one.

Then for each "why", say where it comes from: a knowledge file (name it: "from `workflows/gain-staging.md`") or
general mixing practice ("a common rule of thumb"). When a choice is taste (how much reverb, how bright), say it is
taste and offer the other direction. Never present a rule of thumb as a fact about their song, and never invent a
measurement: if you did not measure it, do not quote a number for it.

## The rhythm, for every change that writes

One change at a time. A "change" is one idea (turn the vocal down, add a high-pass to the guitars), even when it
takes a few tool calls. No `run_plan` batches of unrelated edits in explain mode.

1. **What**: one plain sentence, naming the track. "I'm going to turn the Vocal track down 3 dB."
2. **Why**: the reason, tied to what you measured or heard about. "It reads 4 LU above the guitars in the chorus,
   so it sits on top of the mix instead of in it."
3. **Concept**: the REAPER idea behind it, linked to its entry in `reference/reaper-concepts.md`, e.g.
   "Concept: Volume fader and gain staging (`reference/reaper-concepts.md#volume-fader-and-gain-staging`)". Use only
   entries that exist there; for anything missing, explain it in one line and link nothing.
4. **Do it yourself**: how to make the same change by hand, from the entry's **By hand** line. When an action does
   it, look it up with `search_actions` (or `get_action` with a known id) and give its name and the shortcut it
   returns: the user's own keys, not a default from memory. If it has no shortcut, say where to find it in the
   action list.
5. **Do it**: make the change with the tools.
6. **Show it**: the before and after you measured (re-measure; do not assume). The tool reply ends with a
   "Bridge page (before/after view): <url>" line on a write: offer that link in one line ("see it drawn on the
   bridge page: <url>"). Never open it yourself (no `open`, no `curl`): REAPER's web server leaks a connection on
   every scripted request. No line in the reply means the web interface is off; skip the offer.
7. **Undo**: one line. Every tool call that writes is its own undo step, so count them. One call (or one
   `run_plan`): "Ctrl+Z (Cmd+Z) in REAPER, or ask me to undo, takes back exactly this." N calls: "Ctrl+Z N times
   takes back this change, or ask me to undo it" (then call `undo_project` N times).
8. **Pause**: ask before the next change ("Next: a high-pass on the guitars. Go on?"). The user can say "keep
   going" to let you do the rest of the current step without pausing; keep explaining each change anyway.

Keep each change's explanation to about six short lines. Wrap the What, Why and Concept into one or two sentences
when they are obvious; never skip the Concept or Do it yourself lines.

## Questions the user asks

- "Why?" or "What is X?": answer from `reference/reaper-concepts.md` and the knowledge files first, then general
  knowledge, and say which.
- "Show me where": give the **By hand** location and the live shortcut; offer to select the track
  (`set_selected_tracks`) so it is highlighted in REAPER.
- "Let me do it": tell them what to do by hand, wait, then measure and tell them what changed. Do not make the
  change for them.

## Read-only work

Analysis without changes (levels, loudness, a "what is wrong with my mix" pass) follows the same honesty rules and
links concepts, without the Do it, Undo or Pause steps.
