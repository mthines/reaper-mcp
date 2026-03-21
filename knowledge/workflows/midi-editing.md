---
name: MIDI & Media Editing
id: midi-editing
description: Create MIDI patterns, program drums, build chord progressions, arrange media items, and manipulate audio regions
---

# MIDI & Media Editing

## When to Use

When the user needs to create, edit, or arrange MIDI content or manipulate audio/media items in the project timeline. This workflow covers both MIDI programming and audio arrangement tasks.

Use this workflow when:
- Creating MIDI patterns from scratch (drums, bass, chords, melodies)
- Editing existing MIDI notes (transpose, retime, change velocity)
- Programming drum patterns for a specific genre
- Building chord progressions
- Arranging sections (move, copy, split, trim, delete)
- Manipulating audio items (time-stretch, fade, adjust playback rate)
- Adding MIDI CC automation (expression, modulation, sustain)

## Prerequisites

- Know the project **tempo** and **time signature** — required for beat/time conversion
- Identify the target track(s) — MIDI instruments, audio tracks
- Understand the musical context — key, scale, genre, feel

## Key Concepts

### MIDI Notes
- **Pitch**: 0–127, where 60 = C4 (Middle C)
- **Velocity**: 1–127 (determines loudness/intensity)
- **Position**: in beats from item start (1.0 = one quarter note)
- **Duration**: in beats (0.5 = eighth note, 0.25 = sixteenth)
- **Channel**: 0–15 (channel 9 = drums in General MIDI)

### Media Items
- **Position**: in seconds (absolute project time)
- **Length**: in seconds
- **Volume**: in dB (0 = unity gain)
- **Play rate**: 0.1–10 (1.0 = normal speed)

### Conversion
```
seconds = beats × (60 / tempo)
beats = seconds × (tempo / 60)
bar_length_seconds = beats_per_bar × (60 / tempo)
```

## Step-by-Step

### 1. Save a snapshot
Always save state before editing.

### 2. Survey the session
- `get_project_info` — tempo, time sig
- `list_tracks` — find target tracks
- `list_midi_items` / `list_media_items` — understand existing content

### 3. Create or edit content

**For new MIDI patterns:**
1. Calculate item boundaries: `start_seconds = start_beat × (60 / tempo)`
2. `create_midi_item` with start/end positions in seconds
3. `insert_midi_notes` with a JSON array of notes (batch for efficiency)

**For editing existing MIDI:**
1. `get_midi_notes` to read current content
2. `edit_midi_note` for individual changes (partial updates supported)
3. `delete_midi_note` to remove notes (re-read after, indices shift)

**For media item arrangement:**
1. `split_media_item` at bar boundaries (calculate seconds from beats)
2. `move_media_item` to new positions or tracks
3. `trim_media_item` to adjust item edges
4. `set_media_item_properties` for volume, fades, playback rate

### 4. Verify
- `get_midi_notes` — confirm note content after edits
- `get_media_item_properties` — confirm item state
- `play` — listen back to verify musical result

### 5. Save and report
Save a post-edit snapshot. Report what was created/changed and any musical decisions made.

## Verification Checklist

- [ ] Tempo and time signature are correct
- [ ] Notes fall on the intended beat grid
- [ ] Velocities have natural variation (not all the same)
- [ ] Drum channel is 9 for GM instruments
- [ ] Media items don't overlap unintentionally
- [ ] Fades are applied at edit points to prevent clicks
- [ ] Snapshot saved before and after

## Pitfalls

- **Don't mix up beats and seconds** — MIDI note positions are in beats; media item positions are in seconds
- **Re-read after deleting** — note/CC indices shift after deletion
- **Batch insert is much faster** — use `insert_midi_notes` instead of individual inserts
- **Always check tempo first** — beat-to-seconds conversion depends on it
- **Velocity variation matters** — constant velocity sounds robotic; vary by ±10–15 for realism
- **Channel 9 for drums** — forgetting this will send notes to the wrong instrument
