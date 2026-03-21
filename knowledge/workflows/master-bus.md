---
name: Master Bus
id: master-bus
description: Build the final mix bus processing chain for delivery
---

# Master Bus

## When to Use

When the mix is ready for final processing before export. The master bus chain adds the final glue compression, tonal shaping, and limiting that brings the mix to competitive loudness and prepares it for streaming delivery.

Use this workflow when:

- The mix is complete and all tracks are balanced
- The user says "master this mix" or "prepare for delivery"
- The mix needs to meet a specific LUFS target (Spotify -14, YouTube -14, Apple Music -16, club -8 to -6)
- The mix bus has headroom (peaking at -6 to -3 dBFS before this chain)

Important distinction: This is mix bus mastering (mixing the master), not mastering from a stereo file. Full mastering from a 2-track bounce requires different tools and more headroom. This workflow is appropriate for delivering a final mix from a REAPER session.

## Prerequisites

- Mix is balanced (all elements sitting correctly)
- Gain staging is complete (mix bus peaks at -6 to -3 dBFS before this chain)
- Genre is known (LUFS target depends on genre)
- No existing processing on the master bus (or existing chain is documented and will be replaced)

## Step-by-Step

### Step 1: Save snapshot

```
tool: snapshot_save
params:
  name: "pre-master-bus"
  description: "Mix ready for master bus chain"
```

### Step 2: Check current mix bus headroom

```
tool: read_track_meters
params:
  trackIndex: [master bus / mix bus index — usually last track or master]
```

Play the loudest section (usually chorus). Record the peak level.

If the mix bus is peaking above -3 dBFS: reduce all tracks or the master bus fader before proceeding. You need headroom for the master bus chain to work without clipping.
If the mix bus is peaking above -3 dBFS: reduce all tracks or the master bus fader before proceeding. You need headroom for the master bus chain to work without clipping.

If the mix bus is below -12 dBFS average: gain staging may be off — consider re-running the gain-staging workflow first.

Ideal pre-master-bus level: -8 to -6 dBFS peaks, -18 to -14 dBFS average RMS.

### Step 3: Add glue compressor

Select: Pro-C 2 Classic mode preferred, ReaComp as fallback.

```
tool: add_fx
params:
  trackIndex: [master bus index]
  fxName: "Pro-C2"
```

Settings (transparent glue — very subtle):

| Parameter     | Value             | Why                               |
| ------------- | ----------------- | --------------------------------- |
| Style         | Classic (VCA)     | Warm, cohesive glue               |
| Ratio         | 2:1               | Gentle                            |
| Attack        | 10–30 ms          | Preserve transients               |
| Release       | Auto              | Program-dependent — musical       |
| Threshold     | Set for 1–2 dB GR | Very light touch                  |
| Knee          | 6–12 dB           | Maximum transparency              |
| Sidechain HPF | 80 Hz             | Prevent bass from over-triggering |

Play the loudest section. Adjust threshold until GR meter shows 1–2 dB maximum reduction. This should be nearly inaudible but make the mix feel more cohesive when bypassed and engaged.

### Step 4: Add EQ (optional — corrective only)

Only add if the mix has identifiable frequency imbalances that couldn't be fixed at the track level.

```
tool: add_fx
params:
  trackIndex: [master bus index]
  fxName: "Pro-Q3"  # or ReaEQ — use linear phase mode for mastering
```

Common master bus EQ moves (use sparingly, max ±2 dB):

| Move                                           | When to Use                            |
| ---------------------------------------------- | -------------------------------------- |
| Low shelf cut at 60 Hz, -1 to -2 dB            | Mix is bass-heavy, lacking clarity     |
| Bell cut at 250–400 Hz, -1 to -2 dB            | Mix sounds muddy or congested          |
| Bell cut at 2–4 kHz, -0.5 to -1 dB             | Mix sounds harsh on extended listening |
| High shelf boost at 10–12 kHz, +0.5 to +1.5 dB | Mix sounds dull or lacks air           |

Use Pro-Q 3 in Linear Phase mode on the master bus to avoid phase distortion at low frequencies.

### Step 5: Add limiter for loudness target

Select: Pro-L 2 preferred, ReaLimit as fallback.

```
tool: add_fx
params:
  trackIndex: [master bus index]
  fxName: "Pro-L2"
```

Determine LUFS target from genre:

- Spotify / YouTube streaming: -14 LUFS integrated, -1.0 dBTP
- Apple Music: -16 LUFS integrated, -1.0 dBTP
- Club / EDM: -8 to -6 LUFS integrated, -0.3 dBTP
- Hip-hop: -10 to -7 LUFS integrated, -0.3 dBTP
- Film/TV/broadcast: -23 LUFS (EBU R128)

Settings for streaming (-14 LUFS):

| Parameter    | Value                   | Why                             |
| ------------ | ----------------------- | ------------------------------- |
| Style        | Transparent or Allround | Clean limiting                  |
| Output Level | -1.0 dBFS               | -1 dBTP ceiling                 |
| ISP          | on                      | True peak detection             |
| Transients   | 40–60%                  | Preserve some punch             |
| Lookahead    | 1–4 ms                  |                                 |
| LUFS Target  | -14 LUFS                | Set via the built-in LUFS meter |

Play the full song and check the integrated LUFS reading. The integrated LUFS is calculated over the full song, not a short section.

Adjust Input Gain on Pro-L 2 to hit the target:

- If integrated reads -17 LUFS and target is -14: add +3 dB Input Gain
- If integrated reads -11 LUFS and target is -14: reduce Input Gain by 3 dB

Watch the GR meter on the limiter:

- Average 0.5–2 dB GR: Good — the mix is being lightly limited
- Average 4+ dB GR: The mix is too loud before the limiter; reduce compressor stage or fix upstream

### Step 6: Check mono compatibility

```
tool: read_track_spectrum
params:
  trackIndex: [master bus index]
```

Play the mix while mentally imagining it summed to mono. If there are frequency-specific dips (comb filtering), it indicates phase issues from stereo reverbs or wide processing. Flag to user if significant problems are found.

The Correlation Meter JSFX (if installed) will show this directly: values near +1.0 = good mono compatibility; values near 0 or negative = phase issues.

### Step 7: Verify delivery specs

| Check           | Target                                       |
| --------------- | -------------------------------------------- |
| Integrated LUFS | Genre target (see Step 5)                    |
| True peak       | -1.0 or -0.3 dBTP (genre dependent)          |
| Crest factor    | 8+ dB for mixed music; 12+ dB for orchestral |
| Low end mono    | No audible phase problems below 100 Hz       |
| Stereo width    | Correlation > 0.7 on full mix                |

### Step 8: Save final snapshot

```
tool: snapshot_save
params:
  name: "master-complete"
  description: "Master bus chain complete — ready for export"
```

## FX Chain Order (on the master bus)

1. **Glue compressor** (VCA, very light — 1–2 dB GR)
2. **EQ** (optional — linear phase, corrective only, ±2 dB max)
3. **Saturation** (optional — extremely subtle, adds harmonic density)
4. **Limiter** (brickwall, LUFS targeting, true peak detection)

Optionally before the compressor:

- **Multiband compressor** (only if specific frequency bands need control that single-band comp can't handle)
- **Stereo imager** (only if mono compatibility is poor — careful)

## Verification

1. Play the full mix A/B against a pre-master-bus snapshot — the master chain should make the mix sound fuller and more cohesive, not just louder
2. Check the limiter's GR: should be gentle, not constant heavy limiting
3. Export a 30-second clip and check on headphones, phone speaker, and car audio
4. Verify LUFS integrated reading matches the target platform
5. Check that transients are still felt (kick punch, snare snap) despite limiting

## Common Pitfalls

- **Master bus too loud before the chain**: If peaks are above -3 dBFS before the limiter, the limiter is doing too much work. Fix the mix upstream.
- **Heavy glue compression + heavy limiting**: Double processing. If the compressor is doing 4+ dB GR and the limiter is doing 4+ dB GR, the mix is being over-squashed. Choose one.
- **Linear phase EQ artifacts**: Linear phase EQ adds pre-ringing at low frequencies with heavy processing. Keep EQ moves subtle on the master bus.
- **Chasing loud**: Increasing the limiter's Input Gain to match a loud reference track can destroy the dynamics and make the mix sound flat. Trust the LUFS target.
- **Exporting without checking LUFS**: Integrated LUFS requires measuring the entire song. A 30-second check is not sufficient for integrated measurement. Play the full song with the LUFS meter running.
- **Not saving a pre-master snapshot**: Always save a snapshot before adding master bus processing. The user may want to A/B compare.
