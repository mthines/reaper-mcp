---
name: editing
description: >
  Edits a live REAPER session through the reaper MCP tools: MIDI parts (writing,
  rewriting, quantizing, importing), arrangement (split, move, copy, insert or
  remove time), timing and phase, crossfades and comping, and A/B-testing
  variations in fixed lanes. Changes notes and items, not levels or FX — use
  /mixer for those. Use when the user asks to edit, rewrite, tighten, comp, change
  the groove or arrangement, or compare two versions of a part. Triggers on "edit
  the drums", "change the chorus", "make a variation", "A/B these takes",
  "comp this", "tighten the timing", "/editing".
argument-hint: '[what to edit or compare]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - editing
    - midi
    - arrangement
    - comping
    - reaper
---

# Editing

Edit the notes, items and structure of a **live** REAPER session through the
`reaper` MCP tools. This skill changes what plays and when. Levels, EQ,
compression and the master belong to `/mixer` and `/mastering`; what a sampled
instrument expects (note map, keyswitches) comes from `/learn-plugin`'s LoreKit
record. After an edit, hand the balance question to `/mixer`.

The step-by-step procedures (crossfades, phase, stretch markers, head and tail
cleanup, arrangement edits) are in `knowledge/workflows/editing.md`; load it for
audio editing. The rest of this skill is the MIDI, variation and safety side.

## Rules that save sessions

1. **Re-list before every index-based write.** The user edits the session while
   you work: a deleted or added track moves every index after it (this once put
   an EQ on the wrong tracks). `list_tracks` (filtered by `parent`) or
   `get_track_lanes` right before each batch, and target by name where it is
   unique. Item indexes also change after every move, import or delete.
2. **Snapshots do not store items.** `snapshot_save` keeps faders and FX
   parameters, so it cannot undo a MIDI or arrangement edit. Before changing
   items, keep the original: a muted copy, or the A lane of a lane pair (below).
   Delete the original only when the user says the new version won.
3. **Keep the user's selection in mind.** `set_selected_items` and item actions
   replace it; say so when it ends up changed.
4. **Validate, then write.** Check pitch range, track and item before the first
   write. A MIDI write that fails halfway is undone by the server; a bad import
   can still leave an item you did not want, so list items after.
5. **Check the instrument before writing MIDI.** A sampled instrument has note
   ranges and keyswitch zones (Odin x Ari Lite: notes below 36 are keyswitches,
   so music written there is silent or switches articulation). Read the plugin's
   record (`get_builtin_knowledge`, `memory.read` of `user::plugins::…`) before
   writing a part, and probe one note if it is unverified.

## Writing and rewriting MIDI

- **Fast path for a whole part:** generate one `.mid` per instrument with a node
  script (480 PPQ, a tempo and 4/4 meta event, an end-of-track at the last bar
  line), then `import_midi_file { path, trackIndex, position }`. Thousands of
  `insert_midi_note` calls are far slower. The file's tempo is **not** applied:
  set the project tempo first.
- **Drum maps are not General MIDI.** Check the kit's record (GGD Invasion: kick
  R24/L23, snare 26, toms 33-38, hats 43/45, crash L52, china 65). Alternate kick
  feet when two hits are a 16th apart.
- **Small changes:** `edit_midi_notes` / `insert_midi_notes` (batch),
  `transform_midi` (transpose, velocity, humanize, length) and `quantize_midi`
  (grid, strength, swing). Positions are in beats, velocity 1-127.
- **Replacing a section:** import the new section at its start time on the same
  track, then keep the old item (muted, or in another lane) until approved.
  Imported items never overwrite existing ones.
- **Big MIDI calls can hit the 10 s bridge timeout** (seen on a 400-note
  `transform_midi` while the user was in the session). Prefer re-importing a
  generated file over editing hundreds of notes in place.

## A/B-testing MIDI or arrangement variants (fixed lanes)

Use this to compare alternatives that change notes or arrangement: a drum
groove, a bass line, a different chorus. A snapshot cannot switch them (rule 2),
and a muted duplicate is easy to leave muted.

**One lane per complete version.** Each lane holds the whole song, so one switch
plays a whole version and nothing is left silent. A lane with only a changed
section forces the unchanged sections into another lane, and playing one lane
alone then silences them.

1. `set_track_lanes { track, fixedLanes: true }`: every item goes on lane 0
   (version A). `laneCount` needs `fixedLanes: true`.
2. With only lane 0 playing, run action 42505 ("Track lanes: Duplicate items from
   playing lanes to new lanes"): lane 1 starts as a full copy.
3. Make the change in lane 1. To bring a newly imported item in, `set_selected_items`
   then 40068 (up one lane), 40107 (down one lane) or 42588 (bottom lane), and
   delete the copy it replaces. Run `get_track_lanes` after each move.
4. Name the lanes: `names: [{ lane: 0, name: "A original" }, { lane: 1, name: "B half-time chorus" }]`
   (objects, not strings).
5. **Switch:** `set_track_lanes { track, play: 1 }` plays lane 1 alone, `play: 0`
   lane 0. A number is exclusive, an array (`play: [0, 2]`) is layered.
6. **Decide:** `comp_lanes` takes sections from either lane onto a new comp lane
   (a committed copy, not a switch). Delete the losers afterwards (action 42691
   removes lanes that are not playing, with their items).

Gotchas:
- Unchanged sections exist in every lane, so an edit in one lane does not reach
  the others. Finish shared edits first, or make them in each lane.
- `get_track_lanes` / `set_track_lanes` take `track`, not `trackIndex`.
- Turning lanes off puts every item on one lane, all playing (`undo_project`
  restores).
- A full A/B is a lane choice plus a mix snapshot: lanes for notes and
  arrangement, snapshots (`/mixer`) for faders, EQ and the master.
- For a few-note tweak, edit in place; lanes are for whole alternatives.

## Workflow

1. **Understand** the edit and the song structure (`list_regions`, `list_markers`,
   `get_tempo_map`). Load `workflows/editing.md` for audio editing.
2. **Protect:** `snapshot_save { name: "before-{task}" }` for the mix, and keep
   the original items (rule 2).
3. **Re-list**, then edit (rule 1), explaining the musical reason for each change.
4. **Verify:** list the items and lanes again, play the changed range for the user
   (`set_cursor_position` + `play`), and check the result with the meters through
   `/mixer` when level or tone may have moved. Ask the user to listen: their ear
   decides.
5. **Report** what changed, where the originals are, and how to switch back.

## Interpreting vague requests

"Slows down", "bigger", "less busy" can mean several things. State the reading you
chose (for "the groove slows down": half-time at the same tempo, not a tempo
change, since the other parts would have to follow) and offer the other.
