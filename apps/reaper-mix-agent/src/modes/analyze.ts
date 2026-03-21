import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'analyze';
export const MODE_DESCRIPTION =
  'Analyze the mix and identify problems — the "roast my mix" mode';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Compare against genre-appropriate targets for LUFS, stereo width, and frequency balance.`
    : '\nNo genre specified. Apply general mixing standards.';

  const analyzerPlugin = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'analyzer',
  );
  const analyzerNote = analyzerPlugin
    ? `\nUse **${analyzerPlugin.installedName}** for detailed spectrum analysis where available.`
    : '';

  return `## Workflow Mode: Mix Analysis ("Roast My Mix")
${genreNote}${analyzerNote}

Your task is to systematically analyze the session and produce a brutally honest, actionable report.
Do NOT make changes during analysis — observe and report only. After the report, ask the user
which problems they want to fix first.

### Analysis checklist

#### 1. Gain staging check
- Read meters for all tracks during playback of the chorus section
- Flag any track with average below -24 dBFS or above -10 dBFS
- Flag any track peaking at or above -3 dBFS
- Check the mix bus — flag if peaking above -6 dBFS

\`\`\`
tool: list_tracks
tool: play
tool: read_track_meters (for each track)
\`\`\`

#### 2. Frequency balance check (spectrum analysis)
- Read the spectrum of the mix bus (or master bus)
- Check for energy buildup in these problem zones:
  - Sub-bass (20–60 Hz): excessive = muddy, bass-heavy
  - Low-mid mud (200–400 Hz): excessive = honky, cloudy
  - Harsh zone (2–5 kHz): excessive = fatiguing, harsh
  - High-frequency sibilance (6–10 kHz): excessive = sibilant, piercing
- Check for missing energy:
  - Air (10–20 kHz): if absent = dull, lifeless top end
  - Presence (1–4 kHz): if absent = vocal doesn't cut through

\`\`\`
tool: read_track_spectrum
params:
  trackIndex: [mix bus / master index]
\`\`\`

#### 3. Dynamics check
- Play the chorus and read meters — what is the crest factor (peak - RMS)?
  - Less than 6 dB: over-compressed, no dynamics, fatiguing
  - More than 20 dB: under-compressed, inconsistent, unprofessional

#### 4. Low-end check
- Read spectrum of the bass/kick track
- Check if bass energy is centered (mono) — stereo bass causes phase cancellation on mono playback

#### 5. Common problems to flag
Flag any of the following if detected:

| Problem | How to detect |
|---------|--------------|
| No gain staging | Tracks averaging outside -21 to -15 dBFS |
| Mix bus clipping | Mix bus peaking at or near 0 dBFS |
| Low-mid mud | Spectrum shows 200–400 Hz hump > 3 dB above average |
| Over-compression | Crest factor < 6 dB on mix bus |
| Missing high end | Spectrum drops sharply above 8 kHz |
| Excessive sub | Sub-bass (20–60 Hz) louder than kick fundamental |
| No FX on tracks | Tracks have 0 FX when mix would benefit from EQ/comp |

### Report format

Structure your report as:

**Mix Analysis Report**

**Session Overview**: [track count, approximate genre, overall impression]

**Critical Issues** (fix these first):
- [Issue]: [What the meters/spectrum showed] → [Recommended fix]

**Notable Issues** (fix after criticals):
- [Issue]: [Evidence] → [Fix]

**Things working well**:
- [Positive observation]

**Recommended next step**: Run the [gain-stage | vocal-chain | mix | master] workflow.
`;
}
