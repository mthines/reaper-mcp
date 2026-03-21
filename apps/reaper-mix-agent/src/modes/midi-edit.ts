import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'midi-edit';
export const MODE_DESCRIPTION =
  'Create and edit MIDI patterns, program drums, build chord progressions, and arrange media items';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-appropriate rhythms, velocities, and patterns from the genre knowledge file.`
    : '\nNo genre specified. Apply general MIDI programming best practices.';

  return `## Workflow Mode: MIDI & Media Editing
${genreNote}

### Overview

This mode covers MIDI note editing, CC automation, media item arrangement, and audio manipulation. Use the MIDI reference knowledge (\`knowledge/reference/midi.md\`) for note numbers, drum maps, chord intervals, and beat position math.

### Step 1: Understand the session

\`\`\`
tool: get_project_info → tempo, time signature
tool: list_tracks → find MIDI and audio tracks
\`\`\`

**Critical**: Note the **tempo** and **time signature** — you need these for all beat/time conversions.

Conversion: \`seconds = beats × (60 / tempo)\`

### Step 2: Save a snapshot

\`\`\`
tool: snapshot_save
params:
  name: "pre-midi-edit"
  description: "State before MIDI/media editing"
\`\`\`

### Step 3: Survey existing items

\`\`\`
tool: list_midi_items → for MIDI tracks
tool: list_media_items → for all tracks (MIDI + audio)
\`\`\`

Understand what already exists before adding or editing.

---

## MIDI Editing Tasks

### Creating a new MIDI pattern

1. **Calculate item boundaries in seconds**:
   - Example: 4 bars of 4/4 at 120 BPM = 4 × 4 × (60/120) = 8 seconds
   - Start position = where in the project (in seconds)

2. **Create the MIDI item**:
\`\`\`
tool: create_midi_item
params:
  trackIndex: [target track]
  startPosition: [start in seconds]
  endPosition: [end in seconds]
\`\`\`

3. **Insert notes** (always prefer batch):
\`\`\`
tool: insert_midi_notes
params:
  trackIndex: [target track]
  itemIndex: [new item index]
  notes: '[{"pitch":60,"velocity":80,"startPosition":0,"duration":1}, ...]'
\`\`\`

Positions and durations are in **beats from item start** (not seconds).

### Programming drums

Use **channel 9** for General MIDI drums. Key mappings:
- Kick: 36, Snare: 38, Hi-Hat (closed): 42, Hi-Hat (open): 46
- Low Tom: 45, Mid Tom: 47, High Tom: 50
- Crash: 49, Ride: 51

**Velocity tips for realistic drums**:
- Hi-hats: alternate between 60–80 (quiet) and 80–100 (accented)
- Ghost snares: velocity 25–40
- Kick: consistent 90–110
- Snare backbeat: 100–120
- Crash on downbeat: 110–127

### Building chord progressions

1. Determine root notes from the progression (e.g., I–V–vi–IV in C = C, G, Am, F)
2. Look up chord intervals:
   - Major: root + 4 + 7 semitones
   - Minor: root + 3 + 7 semitones
3. Place each chord at the correct beat position
4. Use batch insert for efficiency

**Voicing tips**:
- Keep bass notes (root) in octave 3 (48–59)
- Keep chord tones in octave 4 (60–71)
- For open voicings, spread across 2 octaves
- Avoid all notes above C6 (84) for pads — too thin

### Editing existing MIDI notes

1. **Read current notes**: \`get_midi_notes\`
2. **Edit by index**: \`edit_midi_note\` — only specify fields you want to change
3. **Transpose**: edit pitch on each note (+/- semitones)
4. **Re-read after deleting** — note indices shift after deletion

---

## Media Item Tasks

### Arrangement editing

- **Split at bar boundary**: calculate position in seconds, use \`split_media_item\`
- **Move section**: use \`move_media_item\` with newPosition (seconds) and optionally newTrackIndex
- **Trim edges**: use \`trim_media_item\` — positive values trim inward, negative extend
- **Delete section**: \`delete_media_item\`

### Audio manipulation

- **Change playback speed**: \`set_media_item_properties\` with playRate (1.0 = normal)
- **Adjust volume**: \`set_media_item_properties\` with volume (dB, 0 = unity)
- **Add fades**: \`set_media_item_properties\` with fadeInLength / fadeOutLength (seconds)
- **Time-stretch**: add stretch markers at key positions

---

## CC Automation

Common CC use cases:
- **Expression swells**: CC 11, ramp 0→127 over several beats
- **Filter sweeps**: CC 74, gradual increase/decrease
- **Sustain pedal**: CC 64, value 127 (on) at start, 0 (off) before next chord

\`\`\`
tool: insert_midi_cc
params:
  trackIndex: [track]
  itemIndex: [item]
  ccNumber: 11
  value: 127
  position: 0.0
  channel: 0
\`\`\`

---

### Step 4: Verify changes

\`\`\`
tool: get_midi_notes → confirm note content
tool: get_media_item_properties → confirm item properties
tool: play → listen back
\`\`\`

### Step 5: Save and report

\`\`\`
tool: snapshot_save
params:
  name: "post-midi-edit"
  description: "State after MIDI/media editing"
\`\`\`

Report: what was created/edited, key musical decisions, suggestions for next steps (e.g., "add FX processing" → hand off to \`@mix-engineer\`).
`;
}
