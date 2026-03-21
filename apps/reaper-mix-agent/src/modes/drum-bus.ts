import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'drum-bus';
export const MODE_DESCRIPTION =
  'Process the drum bus to add punch, cohesion, and energy';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-specific drum bus processing from the genre knowledge file.`
    : '\nNo genre specified. Applying general rock/pop drum bus conventions.';

  const comp = context.availablePlugins.find(
    (p) =>
      p.knowledge.frontmatter['category'] === 'compressor' &&
      (p.knowledge.frontmatter['style'] === 'character' ||
        p.knowledge.frontmatter['style'] === 'vintage'),
  ) ??
    context.availablePlugins.find(
      (p) => p.knowledge.frontmatter['category'] === 'compressor',
    );

  const eq = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'eq',
  );

  const compNote = comp
    ? `Use **${comp.installedName}** for drum bus compression (a character compressor is preferred for glue).`
    : 'Use ReaComp (stock) for drum bus compression.';
  const eqNote = eq
    ? `Use **${eq.installedName}** for drum bus EQ.`
    : 'Use ReaEQ (stock) for drum bus EQ.';

  return `## Workflow Mode: Drum Bus
${genreNote}

### Preferred plugins for this session
- ${compNote}
- ${eqNote}

### Goal
The drum bus should make the kit feel like one cohesive instrument.
Individual drums are processed on their own tracks; the bus adds glue, punch, and energy.

### Step 1: Save a snapshot

\`\`\`
tool: snapshot_save
params:
  name: "pre-drum-bus"
  description: "Drum bus state before processing"
\`\`\`

### Step 2: Identify the drum bus

\`\`\`
tool: list_tracks
\`\`\`

Look for a folder track or bus track labeled "Drums", "Kit", "Drum Bus", or "DRUMS".
Get the bus trackIndex.

If no drum bus exists: the drums may need to be routed to a new bus track first.
Ask the user if they want a drum bus created.

### Step 3: Read drum bus levels and spectrum

\`\`\`
tool: read_track_meters (drum bus)
tool: read_track_spectrum (drum bus)
\`\`\`

Check:
- Is the drum bus level around -12 to -8 dBFS peak? (healthy level for processing)
- Is there mud in the 200–400 Hz range? (common with multiple overhead mics)
- Is the kick punch frequency (60–80 Hz) prominent?

### Step 4: EQ the drum bus

\`\`\`
tool: add_fx → EQ plugin on drum bus
\`\`\`

| Adjustment | Value | Purpose |
|-----------|-------|---------|
| High-pass filter | 30–40 Hz | Remove sub-sonic rumble that's not kick |
| Low-mid cut | -1.5 to -3 dB at 250–400 Hz | Reduce boxiness from multiple mic bleed |
| Low boost | +1 to +2 dB at 60–80 Hz | Add kick punch (if needed) |
| High-shelf boost | +1 to +2 dB at 8–10 kHz | Add snap and air to the overheads |

### Step 5: Parallel compression (New York compression)

Parallel compression preserves the transient snap while adding density.
This is done via a send to a heavily compressed version:

Option A (with routing):
- Send the drum bus to a parallel compression track at unity
- On the parallel track: ratio 10:1, fast attack (1–5 ms), medium release (80–120 ms), 10–15 dB GR
- Blend the parallel track in at about -10 to -6 dB relative to the dry drum bus

Option B (direct on bus):
Apply compression to the drum bus with:

| Parameter | Value |
|-----------|-------|
| Ratio | 4:1 to 6:1 |
| Attack | 10–30 ms (slow enough to let the kick and snare attack through) |
| Release | 80–120 ms |
| GR target | 3–6 dB |
| Knee | Soft knee |

### Step 6: Bus saturation (optional, adds warmth)

Light saturation (tape or tube-style) adds harmonic density and makes the kit feel more alive.
Suggest only if the kit sounds "digital" or lacks warmth.
Set drive/input so it is barely adding harmonic distortion — this should not be audible as distortion.

### Step 7: Verify in the mix

Play the full mix. Ask:
- Does the kit feel like one instrument or a collection of separate sounds?
- Does the kick punch through without being boomy?
- Does the snare crack without being harsh?
- Does the drum bus sit level with the bass? (kick and bass should lock together)

### Step 8: Save snapshot

\`\`\`
tool: snapshot_save
params:
  name: "drum-bus-complete"
  description: "Drum bus: EQ, compression, [optional: parallel/saturation]"
\`\`\`
`;
}
