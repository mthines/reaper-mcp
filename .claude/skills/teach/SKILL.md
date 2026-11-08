---
name: teach
description: >
  Beginner mode: works on a live REAPER session one change at a time and teaches as
  it goes — what it is about to change and why, the REAPER concept behind it, how to
  do the same by hand (with the user's own shortcuts), then the before/after and a
  link to the change on the bridge page. Honest that the mixing advice comes from a
  model. Slash-only: runs when the user types /teach.
disable-model-invocation: true
argument-hint: '[what to work on, e.g. "balance my drums" — or a question about REAPER]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - reaper
    - beginner
    - teaching
    - mixing
---

# Teach

The user is new to REAPER (or to mixing) and wants to learn while the work gets done. Turn **explain mode** on for
the rest of this conversation and follow `reference/teaching.md` for every change. Explain mode ends only when the
user says so ("stop explaining", "just do it").

## Start

1. **Load** `reference/teaching.md` (the rhythm and honesty rules) and `reference/reaper-concepts.md` (the concepts
   you link), from the project `knowledge/` folder or `~/.claude/knowledge/` (Glob to locate). Both are required:
   if either is missing, say so and stop — the install is incomplete (`reaper-mcp install-skills`, or
   `scripts/sync-symlinks.sh` in a clone).
2. **Check the connection**: `get_project_info`. If the bridge is not running, explain what the bridge is (the
   script inside REAPER that lets the agent act) and how to start it, then stop.
3. **Say the honesty line** from `teaching.md`, once.
4. **Get oriented, out loud**: `list_tracks` (compact), then describe the session in plain words — how many tracks,
   which are folders, what the master is doing — linking the concepts you name (Track, Folder track, Master track).
5. **Snapshot before the first change**: `snapshot_save` with a name like `before-teach`, and say what a snapshot is
   (link Snapshots) and how to get back to it. Say what it covers: the mix (faders, pans, FX, sends), never notes or
   items. For MIDI and arrangement work, `/editing` keeps each original as a take or lane, and undo takes back the
   rest; say so before the first edit.

## Do the task

Pick the skill whose work it is and follow it, with explain mode on, which means `teaching.md`'s rhythm wraps every
change it makes:

- mixing, balance, EQ, compression, buses, FX chains → `/mixer`
- MIDI, arrangement, editing, comping, timing, vocal alignment → `/editing`
- loudness for release, limiting, the master chain → `/mastering`
- "what is wrong with my mix", analysis only → `/critique` (read-only: concepts and honesty, no Do-it steps)

Invoke that skill with the user's request plus "explain mode is on (`/teach`)". Its own rules still hold (plugin
memory, measuring, hard rules); `teaching.md` decides pace and what gets said. If the argument is a question
("what is a send?"), answer it from `reaper-concepts.md` first, offer to show it on their session, and change
nothing until they say so.

With no argument, ask what they want to work on and offer three starting points that fit the session you just
described (for example: set the levels of every track, tidy the tracks into folders, check the loudness).

## End

Close with a short recap a beginner can keep:

- the changes made, one line each, with the concept they used
- the shortcuts and actions that came up, as a list
- what to try by hand next on this song, and which concept to read about
- how to go back: the snapshot name for mix changes; for edits, the original take or lane `/editing` kept, and
  undo by name (`undo_project`, or Edit → Undo history)
