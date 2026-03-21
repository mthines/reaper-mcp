import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'vocal-chain';
export const MODE_DESCRIPTION =
  'Build a complete processing chain for a lead vocal track';

export function getModeInstructions(context: AgentContext): string {
  const genreNote = context.genre
    ? `\nThe session genre is **${context.genre}**. Apply genre-appropriate vocal compression ratios and EQ character from the genre knowledge file.`
    : '\nNo genre specified. Applying general vocal chain best practices.';

  const eq = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'eq',
  );
  const comp = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'compressor',
  );
  const deEsser = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'de-esser',
  );
  const reverb = context.availablePlugins.find(
    (p) => p.knowledge.frontmatter['category'] === 'reverb',
  );

  const chainNote = [
    eq ? `- **EQ**: ${eq.installedName}` : '- **EQ**: ReaEQ',
    comp ? `- **Compressor**: ${comp.installedName}` : '- **Compressor**: ReaComp',
    deEsser ? `- **De-esser**: ${deEsser.installedName}` : '- **De-esser**: JS: de-esser',
    reverb ? `- **Reverb**: ${reverb.installedName} (on send)` : '- **Reverb**: ReaVerb (on send)',
  ].join('\n');

  return `## Workflow Mode: Vocal Chain
${genreNote}

### Plugins to use for this session
${chainNote}

### Prerequisites
- Gain staging is complete (-18 dBFS average on the vocal track)
- Genre is known (affects compression ratio and EQ character)
- The vocal track has been identified (look for "voc", "lead", "ld" in the track name)

### Step 1: Save a snapshot

\`\`\`
tool: snapshot_save
params:
  name: "pre-vocal-chain"
  description: "Vocal track state before processing chain applied"
\`\`\`

### Step 2: Identify the vocal track

\`\`\`
tool: list_tracks
\`\`\`

Look for a track named "Lead Vocal", "Vox", "Lead Vox", "LD VOX", or similar.
Get its trackIndex.

### Step 3: Read the vocal spectrum

\`\`\`
tool: read_track_spectrum
params:
  trackIndex: [vocal track index]
\`\`\`

Check for:
- Excessive low-end energy below 80 Hz (handling noise, proximity effect)
- Buildup in the 200–400 Hz range (muddiness, "blanket over the mic")
- Harsh peaks around 2–5 kHz (phone-y quality)
- Sibilance spikes at 6–9 kHz

### Step 4: Build the FX chain in order

**Insert order matters.** Build the chain in this exact sequence:

#### 4a. High-pass filter (EQ first)

\`\`\`
tool: add_fx → apply EQ plugin
params:
  trackIndex: [vocal]
  fxName: "[eq plugin name]"
\`\`\`

Set:
- Band 1: High Pass filter, 80–100 Hz, 18–24 dB/oct slope
- This removes proximity rumble and handling noise below the vocal range

#### 4b. De-esser

\`\`\`
tool: add_fx
params:
  fxName: "[de-esser plugin name]"
\`\`\`

Set threshold to catch sibilance (letters S, T, SH) without affecting the overall brightness.
Target: 3–6 dB reduction on sibilant words only.

#### 4c. Compressor

\`\`\`
tool: add_fx
params:
  fxName: "[compressor plugin name]"
\`\`\`

Typical vocal compression settings:
| Parameter | Value |
|-----------|-------|
| Ratio | 3:1 to 4:1 |
| Attack | 10–20 ms (fast enough to catch peaks, slow enough to preserve consonants) |
| Release | Auto or 80–150 ms |
| Threshold | Set for 4–8 dB GR on loud phrases |
| Makeup gain | Enough to restore average level |

#### 4d. EQ (second pass — tonal shaping)

If using two EQ instances (recommended for clean surgical vs tonal work):

\`\`\`
tool: add_fx → second EQ instance
\`\`\`

Common tonal EQ adjustments on vocals:
| Adjustment | Value | Purpose |
|-----------|-------|---------|
| Low-mid cut | -1 to -3 dB, 250–350 Hz | Remove boxy "bedroom" sound |
| Presence boost | +1.5 to +2.5 dB, 3–4 kHz | Help vocal cut through the mix |
| Air boost | +1 to +2 dB, 10–12 kHz shelf | Add breath and clarity |

#### 4e. Send to reverb (do NOT insert reverb directly on the vocal track)

Set up a reverb send:
- A plate reverb with 0.8–1.5 second reverb time
- Pre-delay of 20–40 ms (so the reverb doesn't smear the attack)
- Low-pass filter the reverb at 8–10 kHz (reverb should not be brighter than the dry signal)

### Step 5: Verify in context

Play back the chorus with the vocal in the mix:
- Does the vocal cut through? (if not: boost 3–4 kHz another dB)
- Is there sibilance? (if yes: increase de-esser threshold sensitivity)
- Is the vocal sitting on top? (it should be the loudest element in the chorus)
- Does it feel natural? (if over-processed: reduce compression ratio to 2:1)

### Step 6: Save snapshot

\`\`\`
tool: snapshot_save
params:
  name: "vocal-chain-complete"
  description: "Lead vocal processed — EQ, de-esser, compression, reverb send"
\`\`\`

Report: list of FX added, key settings, any problems noticed.
`;
}
