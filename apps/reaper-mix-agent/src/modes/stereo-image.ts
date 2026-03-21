import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'stereo-image';
export const MODE_DESCRIPTION =
  'Optimize stereo imaging: width, placement, and mono compatibility';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-appropriate stereo width conventions from the genre knowledge file.`
    : '\nNo genre specified. Applying general stereo imaging principles.';

  const imager = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'stereo-imager',
  );
  const eq = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'eq',
  );

  const imagerNote = imager
    ? `Use **${imager.installedName}** for stereo width control.`
    : 'Use a mid/side EQ or panner for stereo width control.';
  const eqNote = eq
    ? `Use **${eq.installedName}** for mid/side EQ work.`
    : 'Use ReaEQ for mid/side EQ work.';

  return `## Workflow Mode: Stereo Imaging
${genreNote}

### Preferred plugins for this session
- ${imagerNote}
- ${eqNote}

### The goal of stereo imaging

A professional stereo image:
1. Sounds wide and three-dimensional in stereo
2. Collapses cleanly to mono without phase cancellation
3. Has the mix elements positioned purposefully in the stereo field
4. Has mono-compatible low frequencies (below ~150 Hz)

### Stereo field placement guide

| Element | Placement | Why |
|---------|-----------|-----|
| Kick drum | Center | Low end is mono; punch comes from center |
| Snare drum | Center or slight L/R | Foundation of the groove |
| Bass | Center | Mono bass translates on all systems |
| Lead vocal | Center | The focal point of the mix |
| Lead guitar solo | Center or slight off-center | Should be prominent |
| Rhythm guitars | Hard L + Hard R | Creates width without cluttering center |
| Piano/keys | Slight L or R, or full stereo spread | Fill the sides |
| Hi-hats | Slight L or R (matches drummer position) | Space in the kit |
| Overheads | Wide stereo | Open up the top of the kit |
| Room mics | Wide stereo | Create depth and space |
| Backing vocals | Spread: some L, some R | Surround the lead |
| FX (reverb/delay) | Wide stereo | Create depth |

### Step 1: Save snapshot

\`\`\`
tool: snapshot_save
params:
  name: "pre-stereo-image"
  description: "Session before stereo imaging work"
\`\`\`

### Step 2: Audit current panning

\`\`\`
tool: list_tracks
\`\`\`

For each track, check its current pan value. Flag:
- Multiple important elements panned to the same position
- Elements that should be centered (kick, bass, vocal) that are panned off-center
- Rhythm instruments that are not panned hard left/right

### Step 3: Set panning positions

\`\`\`
tool: set_track_property
params:
  trackIndex: N
  property: "pan"
  value: [0.0 = center, -1.0 = hard left, 1.0 = hard right]
\`\`\`

Work in pairs: if you pan one guitar to L=80%, pan a complementary rhythm guitar to R=80%.
Asymmetry adds interest; complete symmetry sounds artificial.

### Step 4: Check mono compatibility

Collapse the mix to mono and listen:
- Do the guitars cancel each other out? (if so, check their phase relationship)
- Does the vocal get thinner? (mono narrowing is normal; disappearing is a problem)
- Does the low end become inconsistent? (phase issues in the bass)

Use read_track_spectrum on the mix bus in mono context to check for cancellation.

### Step 5: Manage stereo width on key elements

If specific elements sound too narrow (e.g., drums feel flat):
- Add a stereo imager to widen the overhead mics
- Set width to 120–130% on the overhead bus (not the full drum bus)

If specific elements are too wide (e.g., synths fighting the vocal):
- Narrow them with an imager (80–90% width, or M/S EQ)
- Or reduce their level in the sides channel only

### Step 6: Low-frequency mono constraint

Everything below 150 Hz should be mono. This is critical for:
- Club sound systems (subwoofers are mono)
- Mono radio/podcast playback
- Bluetooth speakers

Apply M/S EQ to the mix bus:
- Side channel: high-pass at 150–200 Hz (remove side information below this)
- This ensures the bass stays mono without affecting the stereo width of the mid/high frequencies

### Step 7: Depth (front-to-back positioning)

Stereo imaging is not just left-right — depth matters too:
- Close/intimate sounds: less reverb, brighter, louder
- Distant sounds: more reverb, slightly low-passed, slightly quieter
- Lead vocal: close (minimal reverb, high presence)
- Room mics/pads: distant (heavy reverb, lower in the mix)

### Step 8: Final mono check and save snapshot

Do a final mono check — the mix should be clearly intelligible and not lose energy.

\`\`\`
tool: snapshot_save
params:
  name: "stereo-image-complete"
  description: "Stereo imaging complete — panning, width, mono compatibility confirmed"
\`\`\`

Report: panning changes made, any mono compatibility issues found and resolved.
`;
}
