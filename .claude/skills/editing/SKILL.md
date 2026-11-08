---
name: editing
description: >
  Edits a live REAPER session through the reaper MCP tools: MIDI parts (writing,
  rewriting, quantizing, importing), arrangement (split, move, copy, insert or
  remove time), timing and phase, vocal alignment and stretch checks, crossfades and comping, voice recordings into
  arrangements, audio stem separation, and A/B-testing variations in fixed lanes.
  Changes notes and items, not levels or FX; use /mixer for those. Use when asked
  to edit, rewrite, tighten, comp, change the groove, compare parts, turn humming
  or beatboxing into music, or split a recording into stems. Triggers on "edit
  the drums", "align the backing vocals", "change the chorus", "make a variation", "A/B these takes",
  "comp this", "tighten the timing", "compose from this recording", "turn my
  humming into a song", "split stems", "/editing".
argument-hint: '[what to edit, voice recording, stems, or versions to compare]'
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
audio cleanup. Voice sketches and stem separation use the workflows below, not
the recorded-track cleanup procedure.

## Rules that save sessions

1. **Re-list before every index-based write.** The user edits the session while
   you work: a deleted or added track moves every index after it (this once put
   an EQ on the wrong tracks). `list_tracks` (filtered by `parent`) or
   `get_track_lanes` right before each batch, and target by name where it is
   unique. Item indexes also change after every move, import or delete.
2. **Snapshots do not store items.** `snapshot_save` keeps faders and FX
   parameters, so it cannot undo a MIDI or arrangement edit. Before changing
   items, keep the original as a **take** of the item it replaces (see "Keeping
   the original" below), or as the A lane of a lane pair. **Never mute an
   original and leave it under or beside the new item**: overlapping muted items
   clutter the timeline and are easy to leave muted. Delete the original only
   when the user says the new version won.
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
6. **Plugin gate — no plugin is touched before its memory is read.** Before the
   first call that adds, sets, loads a preset for, writes MIDI to, or reads parameters
   of a plugin (`add_fx`, `setup_fx_chain`, `set_fx_parameter`,
   `set_multiple_fx_parameters`, `set_fx_preset`, `load_fx_chain`, MIDI for an
   instrument track, take FX), look it up — every plugin, every time it is new to this
   session, including ones the user named, ones already in the project and ones you
   only meet while listing a chain. Never skip it because the plugin looks familiar.
   Look up both layers: `list_builtin_knowledge { query: "<plugin name>" }` (or `tags:
   ["fx::<FX name>"]`) / `get_builtin_knowledge { key: "plugins::{vendor}/{plugin}" }`,
   and `memory.search` / `memory.read` of `user::plugins::{vendor}/{plugin}` (the user's
   record wins). Then **follow the record**: its MIDI map and note ranges, parameter
   scaling, recommended settings and gotchas decide what you do, and a setting you were
   about to use that the record warns against is not used. Say it in one chat line
   ("Recalled Odin x Ari Lite: notes <36 are keyswitches → transposing"). Keep a running
   list of recalled plugins and don't re-read those. No record in either layer: say so
   and carry on (or bootstrap it when the user asked for the plugin by name). LoreKit
   not connected: say so once and use the built-in read only.

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
  track, then fold old and new into one item of takes (below) until approved.
  Imported items never overwrite existing ones.
- **Keeping the original (takes, never mute).** For one section replaced:
  1. `set_selected_items` on exactly the old and new item of **one** section,
     then `run_action 40543` ("Take: Implode items on same track into takes").
     Do one section per call: selecting several sections at once merges them
     all into a single item (seen live; `undo_project` reverts it). Work from
     the highest item index down, since indexes shift after each implode.
  2. The takes keep the lower-indexed item first. `list_takes` the item, then
     `set_active_take` the version that should play (`takeIndex` 1 when the
     new item came after the old one).
  3. The imploded item can inherit the mute: `get_media_item_properties`, and if
     `muted`, `set_media_item_properties { mute: 0 }` (the parameter is `mute`,
     a number 0/1, not a boolean).
  4. Switch versions later with `set_active_take`; when the user decides, delete
     the losing take (or keep it). Take names are blank for imported items; say
     which take is which in chat.
  Use fixed lanes below instead when whole-song versions are compared.
- **Big MIDI calls can hit the 10 s bridge timeout** (seen on a 400-note
  `transform_midi` while the user was in the session). Prefer re-importing a
  generated file over editing hundreds of notes in place.

## Voice recordings to a playable arrangement

For "make music from this humming/beatboxing", use `transcribe_voice_sketch`.
Do not substitute a hand-written melody or a generic MIDI script for analyzing
the recording. File analysis/export does not require REAPER; importing and
playing the result requires a live bridge.

1. **Locate and protect the source.** Use an absolute path on the machine running
   the MCP server. Download an attachment there first; a cloud attachment or an
   orb path is not automatically accessible to a local server. Keep the original
   file unchanged. Select the musical range with `startTime`/`endTime` to exclude
   speech, count-ins and long silence, at most 120 seconds per call.
2. **Analyze before importing.** Start with `limit: 0` and no `outputPath` for
   summaries, warnings, tempo and key. Use `mode: auto` for mixed humming and
   beatboxing, `melody` for humming alone, `drums` for beatboxing alone. The core
   sidecar is sufficient; no pitch model or Demucs install is needed. If the
   tool is missing, check the server build/connection rather than inventing an
   alternative implementation. Missing core setup:
   `reaper-mcp setup-sidecar --without-aesthetics`.
3. **Resolve musical uncertainty.** Ordinary timing drift becomes one rounded
   tempo. Automatic changes need two adjacent four-second windows and at least
   20% difference by default; exact half/double-time changes remain ambiguous.
   If the pulse is uncertain, use the user's BPM or offer short auditions of
   plausible pulses, then rerun with `bpm` to fix the chosen tempo. Never reuse
   a previous recording's BPM as a default. Meter is assumed 4/4 and the first
   onset is beat zero, not a detected downbeat. Report weak key confidence or a
   fallback key; do not force the melody into it. `key` overrides accompaniment
   only. For missed low/short syllables, try a lower `pitchMin` or `minNoteMs`
   down to 40, explaining the increased false-note risk. If recognition remains
   poor, ask for a cleaner take or separate humming and beatboxing takes.
4. **Export the requested draft.** Use `arrange: true` for generated drums, bass,
   chords and repeated detected melody, default 16 bars. Use `arrange: false`
   for detected melody/percussion only. `mode` limits extraction, not the
   generated backing parts. Backbeats, fills, chords and song
   sections are proposals, not recovered performances. Choose a new absolute
   `.mid` `outputPath` under an existing folder. Export includes every note
   regardless of response pagination. With separate takes, extract each in its
   own mode with a shared BPM/grid and combine once; do not stack two complete
   generated backing bands. Align takes using a known cue or ask for their
   offset; each take's first onset becomes its own beat zero.
5. **Set tempo before MIDI import.** Inspect `get_tempo_map` and existing items.
   In an empty project starting at zero, apply `arrangement.tempos` for the full
   generated score, or `tempo.segments` for transcription-only output. Use
   `set_project_tempo` for the first BPM and `add_tempo_marker` with
   `timeSigNumerator: 4`, `timeSigDenominator: 4`, `linear: false` at zero to
   establish 4/4; use `linear: false` for later changes too. Convert segment
   beats to project seconds by integrating the preceding BPM segments, not by
   using the initial BPM throughout. Source `time`/`originSeconds` are original file times, not marker
   positions for the exported score. Preserve an existing project's tempo map
   by default; resolve a mismatch with the user before changing it. Then
   `import_midi_file { path, newTracks: true, trackIndex, position }` creates one
   named track per part. Re-list immediately before choosing `trackIndex`.
   The importer applies neither the file tempo map nor GM program changes.
6. **Make it audible.** Hand instrument/FX setup to `/mixer`: choose installed
   drum, bass, chord and lead instruments and check their knowledge records.
   The exported drum part is GM on MIDI channel 10; verify the kit's channel
   handling and map, then remap notes when necessary. Do not transpose all drum
   notes as a melodic part. Check melody/bass ranges and keyswitches too. A
   successful MIDI import is not proof of audible playback.
7. **Verify a short section first.** Read back the imported notes, tempo map and
   track placement, then play a representative groove and melody for the user.
   Check audible output through `/mixer` and ask whether the pulse, melody and
   drum roles match the idea. Fix octaves, false notes and drum mapping before
   polishing or extending. Keep variants in fixed lanes and compare them at a
   shared project tempo; use separate projects or rendered WAVs for different
   tempo maps. Report what was detected, what was generated and what is unsure.

## Stem splitting: choose the right operation

- **Mixed voice sketch:** start with `transcribe_voice_sketch` directly. Pitch
  and percussion are analyzed independently, including overlapping events.
  Do not run Demucs first by default. Its accuracy on humming plus beatboxing
  is unverified; if explicitly tried, keep a direct-transcription baseline and
  audition both before discarding anything.
- **Recorded band or song:** use `separate_stems` for audio source separation.
  `htdemucs` gives drums, bass, other and vocals; `htdemucs_6s` also gives guitar
  and piano. Neither splits kick/snare/hat. Requires the opt-in
  `reaper-mcp setup-sidecar --with-separation`; the six-source model downloads
  weights on first use. Explain missing dependencies/downloads before setup.
  Choose an explicit range, at most 600 seconds, and a fresh `outDir`. A track
  input is rendered post-FX; use its original file only when that is the wanted
  source. Leave the source untouched and listen for bleed and artifacts before
  relying on a separated stem.
- **Generated instrument WAVs:** `transcribe_voice_sketch` with `outputPath`
  plus `soundfontPath` renders a mix and instrument stems. These are
  resynthesized instruments, not isolated original voice audio. This optional
  route needs local FluidSynth and the user's GM `.sf2`, with at most 240
  seconds including release tail. Prefer MIDI plus installed instruments when
  those dependencies are absent. A `preview.error` can accompany a successful
  MIDI export; keep that file and do not retry the same existing output path.
- **Individual generated drum parts:** the tool exports one drum MIDI part and
  one `drums.wav`, not separate kit-piece WAVs. If requested, split the generated
  GM drum notes by pitch into kick, snare, hat and other MIDI parts before
  instrument-specific remapping. Keep a shared origin and tempo, preserve
  velocities, and mute the unsplit copy when playing the split parts. Separate
  audio outputs need a verified kit-output setup or separate renders; delegate
  that routing/render setup to `/mixer`. Never label these as isolated beatbox
  audio.

For Demucs insertion, `insertTracks: true` creates a **muted folder**. A track's
stems start at `startTime`; a file's start at `filePosition + startTime`, where
`filePosition` is the project position of the source file's second zero. Inspect
returned `inserted`/`warning` and re-list tracks before retrying; files can exist
even if insertion failed. For generated WAVs, use `insert_audio_file` to place
every instrument stem at the same chosen project position. Play either the
source/mix or the stem set, not both. Check parent mute and solo states when a
stem seems silent; preserve the source and make A/B switching explicit.

## A/B-testing MIDI or arrangement variants (fixed lanes)

Use this to compare alternatives that change notes or arrangement: a drum
groove, a bass line, a different chorus. A snapshot cannot switch them (rule 2),
and a muted duplicate is easy to leave muted (so never use one; one section
replaced is a take, see "Keeping the original").

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

## Aligning and stretching vocals

Tightening doubles, harmonies or backing vocals to a lead, and judging a stretch,
use `knowledge/workflows/vocal-alignment.md`; load it first. In short:

1. Edit **copies** on temporary tracks (the user's items and solo state stay
   untouched) and delete them when the user is done.
2. `align_audio_to_guide` with `dryRun` first, then apply; it reads the items'
   source files, so take FX such as Melodyne are not heard.
3. Check the result with `verify_edit` (`timeScale` = the playback rate,
   `expect: "changed"` for a stretch), then **tell the user which edits to
   listen to**. A plain speed change is reported as info (pitch follows speed);
   a pitch-kept slow-down below 0.9x gets stretch artifacts that only the
   dropout check and the user's ear catch. A pass is evidence, not a verdict.
4. Put each copied item straight at its final position; batch-moving items on a
   track re-sorts their indexes.

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
