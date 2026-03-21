import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'low-end';
export const MODE_DESCRIPTION =
  'Manage the low end: clean up bass, lock kick and bass together, ensure mono compatibility';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-appropriate bass EQ frequencies and sub-bass decisions from the genre knowledge file.`
    : '\nNo genre specified. Applying general low-end management principles.';

  const eq = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'eq',
  );
  const comp = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'compressor',
  );

  const eqNote = eq ? `Use **${eq.installedName}** for EQ.` : 'Use ReaEQ for EQ.';
  const compNote = comp
    ? `Use **${comp.installedName}** for compression.`
    : 'Use ReaComp for compression.';

  return `## Workflow Mode: Low-End Management
${genreNote}

### Preferred plugins for this session
- ${eqNote}
- ${compNote}

### The goal of low-end management

A professional low end:
1. Has only ONE source of sub-bass energy (either kick OR bass, not both fighting)
2. Is mono below ~150 Hz (stereo bass causes phase cancellation on mono systems)
3. Has the kick and bass rhythmically locked — they breathe together
4. Doesn't overwhelm the mid and high frequencies

### Step 1: Save snapshot

\`\`\`
tool: snapshot_save
params:
  name: "pre-low-end"
  description: "Session state before low-end management"
\`\`\`

### Step 2: Analyze the low end

Play a bass-heavy section of the song and read spectrum + meters for:
- The kick drum track
- The bass guitar/synth bass track
- The mix bus

\`\`\`
tool: read_track_spectrum (kick)
tool: read_track_spectrum (bass)
tool: read_track_spectrum (mix bus)
\`\`\`

Identify:
- Where does the kick's fundamental sit? (typically 60–100 Hz)
- Where does the bass's fundamental sit? (depends on genre: 40–100 Hz)
- Are both fighting in the same frequency range? (problem)
- Is there energy below 30 Hz? (rumble — remove it)

### Step 3: Decide who owns the sub

**Rule**: Only one instrument should carry energy below 80 Hz.

**Option A: Kick owns the sub** (rock, metal, EDM)
- Cut the bass below 80–100 Hz
- Let the kick have full sub energy
- The bass body (fundamental) lives at 100–250 Hz

**Option B: Bass owns the sub** (hip-hop, R&B, reggae)
- Cut the kick below 60–80 Hz (let it have punch at 60–100 Hz, but not sub)
- The bass has full sub below 80 Hz
- Side-chain compress the bass to duck slightly when the kick hits

Apply your decision:
\`\`\`
tool: add_fx → EQ on kick or bass
tool: set_fx_parameter → High Pass filter at the crossover frequency
\`\`\`

### Step 4: EQ the bass track

| Adjustment | Value | Purpose |
|-----------|-------|---------|
| High-pass filter | 30–40 Hz | Remove sub-sonic rumble |
| Fundamental boost/cut | ±2–4 dB at 60–120 Hz | Adjust body based on genre decision |
| Mud reduction | -2 to -3 dB at 200–300 Hz | Remove boxy low-mid buildup |
| Attack presence | +1 to +2 dB at 700–1000 Hz | Help bass notes articulate |
| High-pass on lows | Steep cut below genre crossover | Per Step 3 decision |

### Step 5: Compress the bass for consistency

Bass notes vary widely in level between strings and playing dynamics.
Compression makes the bass sit consistently in the mix:

| Parameter | Value |
|-----------|-------|
| Ratio | 4:1 to 6:1 |
| Attack | 20–40 ms (let the note attack through) |
| Release | 100–200 ms |
| GR target | 4–8 dB on loud notes |

### Step 6: Sidechain compression (kick → bass)

To make kick and bass breathe together rhythmically:
- Set up the bass compressor with the kick as the sidechain source
- When the kick hits, the bass compressor ducks by 2–4 dB
- Release should be fast enough that the bass returns before the next kick hit

This creates the classic "groove lock" between kick and bass in professional mixes.

### Step 7: Mono compatibility check

The human hearing system loses stereo information below ~150 Hz.
Bass that is stereo (or out of phase) causes cancellation on mono playback.

Check: Read the mix bus spectrum in mono (or use a correlation meter if available).
Apply: A low-pass sidechain or M/S processing to ensure the bass below 150 Hz is centered.

Practical approach: apply a stereo-to-mono constraint below 150 Hz using mid/side EQ
if your EQ plugin supports it. Or simply ensure the bass track itself is a mono track.

### Step 8: Save snapshot

\`\`\`
tool: snapshot_save
params:
  name: "low-end-complete"
  description: "Low end managed: kick/bass separation, compression, mono compatibility"
\`\`\`

Report: which instrument owns the sub, crossover frequency chosen, compression settings applied.
`;
}
