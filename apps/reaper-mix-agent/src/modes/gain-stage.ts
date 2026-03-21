import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'gain-stage';
export const MODE_DESCRIPTION =
  'Analyze and set proper gain staging for all tracks';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-appropriate headroom targets from the genre knowledge.`
    : '';

  return `## Workflow Mode: Gain Staging

Your task is to set all track levels to approximately -18 dBFS average before any FX processing.
${genreNote}

### Why this matters
Proper gain staging ensures dynamics processors operate in their optimal range,
prevents internal overloads, and gives the mix bus 6–10 dB of headroom.

### Steps to execute

1. **Save a safety snapshot first**
   \`\`\`
   tool: snapshot_save
   params:
     name: "pre-gain-staging"
     description: "State before gain staging workflow"
   \`\`\`

2. **List all tracks** — identify bus/folder tracks to handle separately.
   \`\`\`
   tool: list_tracks
   \`\`\`
   Skip: master bus, reverb/delay returns, folder tracks.

3. **Start playback of a representative section** (chorus if possible — densest part).
   \`\`\`
   tool: play
   \`\`\`

4. **Read meters for every source track**
   \`\`\`
   tool: read_track_meters
   params:
     trackIndex: N
   \`\`\`
   Record peak and RMS (dBFS) for each track.

5. **Calculate gain adjustments**
   Formula: \`gain_dB = -18 - current_average_dBFS\`
   Round to nearest 0.5 dB.
   - Track averaging -24 dBFS → needs +6 dB
   - Track averaging -10 dBFS → needs -8 dB

6. **Apply adjustments via the track fader** (NOT clip gain or plugin input gain)
   \`\`\`
   tool: set_track_property
   params:
     trackIndex: N
     property: "volume"
     value: GAIN_DB
   \`\`\`

7. **Check the mix bus** — should peak at -6 to -3 dBFS in the chorus.
   If hitting 0 dBFS, reduce all faders proportionally.

8. **Save post-staging snapshot**
   \`\`\`
   tool: snapshot_save
   params:
     name: "post-gain-staging"
     description: "Gain staged — all tracks at -18 dBFS average"
   \`\`\`

9. **Report to the user** — list each track, its before/after level, and the adjustment applied.

### Targets
- **RMS**: -18 dBFS (±3 dB acceptable)
- **Peak**: -12 dBFS max per track; mix bus peak: -6 to -3 dBFS

### Common pitfalls to avoid
- Do not use clip gain — use the track fader
- Do not gain stage with FX active on the track (bypass compressors during measurement)
- Do not read a single moment — play the densest section for 10+ seconds
- Bus tracks sum multiple sources — check them separately after adjusting source tracks
`;
}
