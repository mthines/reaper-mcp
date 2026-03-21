import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'mix';
export const MODE_DESCRIPTION =
  'Full mix workflow: gain stage, EQ, compression, space, and balance';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre conventions for EQ curves, compression ratios, stereo width, and LUFS targets from the genre knowledge file.`
    : '\nNo genre specified. Apply neutral, broadcast-safe mixing conventions.';

  const eq = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'eq',
  );
  const comp = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'compressor',
  );
  const reverb = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'reverb',
  );
  const delay = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'delay',
  );

  const pluginNote = [
    eq ? `- **EQ**: Use **${eq.installedName}**` : '- **EQ**: Use ReaEQ (stock)',
    comp
      ? `- **Compressor**: Use **${comp.installedName}**`
      : '- **Compressor**: Use ReaComp (stock)',
    reverb
      ? `- **Reverb**: Use **${reverb.installedName}**`
      : '- **Reverb**: Use ReaVerb (stock)',
    delay
      ? `- **Delay**: Use **${delay.installedName}**`
      : '- **Delay**: Use ReaDelay (stock)',
  ].join('\n');

  return `## Workflow Mode: Full Mix
${genreNote}

### Preferred plugins for this session
${pluginNote}

### Phase 1: Foundation (do this first)
Run the **gain-stage** workflow before any mixing decisions.
All tracks must average -18 dBFS before EQ or compression.

### Phase 2: Clean up individual tracks

For each track (drums first, then bass, then guitars/keys, then vocals last):

#### 2a. High-pass filter
Every track except kick and bass needs a high-pass filter to remove low-frequency content
that doesn't belong on that instrument:
- Vocals: HPF at 80–100 Hz
- Guitars: HPF at 80–120 Hz
- Keys/synths (non-bass): HPF at 120–200 Hz
- Room mics: HPF at 200–300 Hz

\`\`\`
tool: add_fx → apply EQ plugin
tool: set_fx_parameter → Band 1 Type = High Pass, Band 1 Frequency = [value]
\`\`\`

#### 2b. Problem frequency surgery
Read the spectrum of each instrument track and look for:
- Resonances (narrow spikes) → cut with a narrow bell (Q = 4–8)
- Buildup zones (200–400 Hz mud) → gentle broad cut (-2 to -4 dB)

\`\`\`
tool: read_track_spectrum
params:
  trackIndex: N
\`\`\`

#### 2c. Compression for control
Apply compression to tracks with dynamic inconsistency:

| Track type | Ratio | Attack | Release | GR target |
|-----------|-------|--------|---------|-----------|
| Vocals | 3:1–4:1 | 10–20 ms | auto | 3–6 dB |
| Snare | 4:1–6:1 | 5–10 ms | 80–120 ms | 4–8 dB |
| Bass | 4:1–6:1 | 20–40 ms | auto | 4–8 dB |
| Overhead | 2:1–3:1 | 50–100 ms | auto | 2–4 dB |
| Mix bus | 2:1 | 30–50 ms | auto | 1–3 dB |

### Phase 3: Build the mix balance

1. Start with the kick and snare — set them to the level where they feel powerful
2. Bring in bass — balance with kick until they lock together
3. Add drums (overheads, room) — add air and space
4. Add rhythm instruments (guitars, keys) — they fill space, sit slightly back
5. Add lead vocals last — they define the final level relationship of everything else

Key rules:
- Vocals should sit 2–4 dB above the guitars in the mix
- The kick and snare should punch through without being too loud
- The low end (kick + bass) should account for roughly 40% of perceived energy

### Phase 4: Add space and dimension

- Add a short room reverb (15–30 ms pre-delay) to glue the kit together
- Add a longer plate reverb (30–50 ms pre-delay) for vocals
- Add a slapback delay (80–150 ms, no feedback) for presence on vocals
- Use sends — NOT inserts — for shared reverb and delay

### Phase 5: Mix bus processing

Apply the following in order to the mix bus:
1. EQ: gentle high-shelf boost (+1 to +2 dB at 12 kHz) for air
2. EQ: gentle low-mid cut (-1 to -2 dB at 250–350 Hz) for clarity
3. Compressor: 2:1, slow attack (30–50 ms), auto release, 1–3 dB GR — for glue
4. Limiter: ceiling at -0.3 dBTP to prevent digital overs

### Phase 6: Final snapshot

\`\`\`
tool: snapshot_save
params:
  name: "mix-v1"
  description: "Full mix — [description of the state]"
\`\`\`

Report to the user: what was changed, what sounds improved, what still needs attention.
`;
}
