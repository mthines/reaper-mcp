import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'master';
export const MODE_DESCRIPTION =
  'Master the mix bus to a target loudness standard';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-appropriate LUFS targets and dynamic range from the genre knowledge file.`
    : '\nNo genre specified. Targeting streaming platform standard: -14 LUFS integrated, -1 dBTP.';

  const limiter = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'limiter',
  );
  const eq = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'eq',
  );
  const comp = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'compressor',
  );

  const limiterNote = limiter
    ? `Use **${limiter.installedName}** for limiting.`
    : 'Use ReaLimit (stock) for limiting.';
  const eqNote = eq
    ? `Use **${eq.installedName}** for mastering EQ.`
    : 'Use ReaEQ (stock) for mastering EQ.';
  const compNote = comp
    ? `Use **${comp.installedName}** for mastering compression.`
    : 'Use ReaComp (stock) for mastering compression.';

  return `## Workflow Mode: Mastering
${genreNote}

### Preferred tools for this session
- ${eqNote}
- ${compNote}
- ${limiterNote}

### Important: Mastering is subtle

Mastering is the FINAL stage. The mix should already be finished.
Adjustments are measured in fractions of a dB, not large moves.
If large corrections are needed, go back and fix the mix first.

### LUFS targets by platform

| Platform | Integrated LUFS | True Peak |
|----------|----------------|-----------|
| Spotify | -14 LUFS | -1 dBTP |
| Apple Music | -16 LUFS | -1 dBTP |
| YouTube | -14 LUFS | -1 dBTP |
| Tidal | -14 LUFS | -1 dBTP |
| CD / Download | -9 to -14 LUFS | -0.3 dBTP |
| Broadcast (EBU R128) | -23 LUFS | -1 dBTP |

### Step 1: Save a snapshot before mastering

\`\`\`
tool: snapshot_save
params:
  name: "pre-master"
  description: "Mix before mastering chain applied"
\`\`\`

### Step 2: Assess the mix bus

Read the mix bus spectrum and meters. Check:
- Is there a consistent frequency balance? (no obvious humps or dips)
- What is the current peak level? (should be -3 to -6 dBFS before mastering chain)
- Is there enough headroom for mastering? (if already above -3 dBFS, reduce the mix fader)

\`\`\`
tool: read_track_meters (mix bus)
tool: read_track_spectrum (mix bus)
\`\`\`

### Step 3: Mastering EQ

Apply very gentle corrections only. These are typical mastering moves:

| Adjustment | Value | Purpose |
|-----------|-------|---------|
| High-pass filter | 20–30 Hz, steep | Remove sub-sonic rumble |
| Low-shelf cut | -0.5 to -1 dB at 80 Hz | Tighten low end slightly |
| Low-mid dip | -0.5 to -1 dB at 250–350 Hz | Reduce boxiness |
| High-shelf boost | +0.5 to +1 dB at 10–12 kHz | Subtle air boost |

Rule: if you are EQing more than ±2 dB at mastering, there's a mix problem to fix instead.

### Step 4: Mastering compression (optional)

Only apply mastering compression if the mix needs glue. Settings:
- Ratio: 1.5:1 to 2:1
- Attack: 30–80 ms (slow — preserve transients)
- Release: auto or 200–500 ms
- GR: 1–2 dB maximum
- If more GR is needed, the mix needs work

### Step 5: Limiting

Set the limiter to the target ceiling:
- True peak ceiling: -1.0 dBTP (streaming) or -0.3 dBTP (download/CD)
- Adjust the input gain until the integrated LUFS reads the target

\`\`\`
tool: add_fx → apply limiter
tool: set_fx_parameter → Ceiling = -1.0 dBTP
\`\`\`

Then adjust the limiter's input (or the fader feeding it) until:
- Integrated LUFS ≈ target (measure over the full track)
- True peak never exceeds ceiling
- Gain reduction on the limiter: under 3 dB (if more, the mix is too dynamic or too loud)

### Step 6: Verify on multiple references

Play the mastered mix and compare against a reference track at the same loudness.
Check:
- Does the low end translate? (listen on headphones + speakers)
- Is the stereo image coherent? (check in mono — switch to mono to verify)
- Does the vocal still sit correctly? (mastering can affect the vocal-music balance)

### Step 7: Save mastered snapshot

\`\`\`
tool: snapshot_save
params:
  name: "master-v1"
  description: "Mastered — targeting [LUFS target] for [platform]"
\`\`\`

Report: achieved LUFS reading, true peak, any compromises made.
`;
}
