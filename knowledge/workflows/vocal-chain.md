---
name: Vocal Chain
id: vocal-chain
description: Build a complete processing chain for lead vocals
---

# Vocal Chain

## When to Use

When a lead vocal track needs a complete processing chain built from scratch or audited for problems. This workflow builds a professional vocal chain in the correct plugin order with genre-appropriate settings.

Use this workflow when:
- A new vocal track has been added with no processing
- The vocal is present but not cutting through the mix
- The vocal sounds harsh, muddy, or uncontrolled
- The user says "fix the vocals" or "make the vocals sound professional"

## Prerequisites

- Lead vocal track identified (track name should contain "voc", "lead", or similar)
- Gain staging already complete (-18 dBFS average on vocal track)
- Genre is known (settings vary significantly by genre)
- Track has audio playing — meters must be readable

## Step-by-Step

### Step 1: Save a snapshot

```
tool: snapshot_save
params:
  name: "pre-vocal-chain"
  description: "Before building vocal processing chain"
```

### Step 2: Identify the vocal track

```
tool: list_tracks
```

Find the lead vocal track by name. Get its `trackIndex`.

### Step 3: Read the current vocal spectrum

```
tool: read_track_spectrum
params:
  trackIndex: [vocal track index]
```

Look for:
- Low-frequency buildup below 100 Hz (rumble, handling noise)
- Presence of 200–400 Hz (boxiness / proximity effect)
- Peak in 2–5 kHz (harshness zone — check if it's causing problems)
- Sibilance energy above 6 kHz (will need de-essing)
- Overall spectral tilt (too bright, too dark?)

### Step 4: Add EQ (first in chain)

Select EQ based on plugin resolver: prefer Pro-Q 3, fall back to ReaEQ.

```
tool: add_fx
params:
  trackIndex: [vocal track index]
  fxName: "Pro-Q3" # or "ReaEQ" if not available
```

Set EQ parameters:

```
tool: set_fx_parameter
params:
  trackIndex: [vocal track index]
  fxIndex: 0  # EQ is first FX
  paramName: "Band 1 Shape"
  value: [High Cut = 4]  # HPF

tool: set_fx_parameter
params:
  trackIndex: [vocal track index]
  fxIndex: 0
  paramName: "Band 1 Frequency"
  value: [80 to 100 Hz — normalized to 0.0–1.0 range]
```

Standard vocal EQ moves:
- Band 1: HPF at 80–100 Hz (slope: 24 dB/oct)
- Band 2: Bell cut at 300–400 Hz, -2 to -3 dB, Q=1.0 (proximity/boxiness)
- Band 3: Dynamic EQ or Bell cut at 7–9 kHz for sibilance (set dynamically if Pro-Q 3)
- Band 4: High shelf boost at 10–12 kHz, +1 to +2 dB (air)

### Step 5: Add first compressor (FET-style, for control and character)

Select compressor: prefer Pro-C 2 in FET mode, fall back to JS 1175, fall back to ReaComp.

```
tool: add_fx
params:
  trackIndex: [vocal track index]
  fxName: "Pro-C2"
```

Set parameters for FET style (generic genre settings; adjust for genre from genre file):
- Style: FET
- Ratio: 4:1
- Attack: 10–15 ms
- Release: 50–80 ms
- Threshold: Set for 4–6 dB GR while playing chorus
- Knee: 2–4 dB

```
tool: read_track_meters
params:
  trackIndex: [vocal track index]
```

Play chorus and adjust Threshold until GR meter shows 4–6 dB.

### Step 6: Add second compressor (Opto-style, for smoothing)

```
tool: add_fx
params:
  trackIndex: [vocal track index]
  fxName: "Pro-C2"  # second instance
```

Set parameters for Opto style:
- Style: Opto
- Ratio: 3:1–4:1
- Attack: 30–50 ms
- Release: Auto
- Threshold: Set for 2–3 dB GR
- Knee: 8–10 dB (very soft)

### Step 7: Add de-esser (if sibilance is a problem)

If spectrum analysis in Step 3 showed prominent 6–9 kHz energy, or if sibilance is audible:

Option A: Use Pro-Q 3 dynamic EQ band (set up in Step 4 above, Band 3 dynamic cut at 7–9 kHz).

Option B: Dedicated de-esser plugin if available:
```
tool: add_fx
params:
  trackIndex: [vocal track index]
  fxName: "ReaXcomp"  # or any de-esser plugin
```

Target: 6500–9000 Hz, threshold set so it only triggers on harsh S sounds.

### Step 8: Set up reverb send/return

Reverb should be on a dedicated return bus (send/return architecture), not as an insert.

If no reverb bus exists:
- Ask user to create one or use `add_track` if available
- Alternatively, add reverb as an insert with Dry signal at -inf dB (pure send simulation)

Reverb settings (genre-specific; these are neutral defaults):
- Pre-delay: 20–30 ms (separates vocal from reverb onset)
- RT60 / Size: 1.5–2.0s (medium hall or chamber)
- High-frequency damping: Moderate (reverb should be darker than the dry vocal)
- Mix: 100% wet on the return bus

Adjust send level from vocal to reverb bus:
- Dry/intimate genres: -20 to -24 dB send (reverb barely audible)
- Wet/ambient genres: -12 to -15 dB send (reverb is part of the sound)

### Step 9: Set up delay send (optional but recommended)

```
tool: add_fx
params:
  trackIndex: [reverb return / delay return track]
  fxName: "ReaDelay"
```

Settings:
- Tempo-sync: 1/4 note (classic) or 1/8 note (modern)
- Feedback: 20–40%
- LPF: 6000 Hz (dark repeats, don't compete with dry)
- HPF: 200 Hz (keep delay from muddying bass)
- Send level from vocal: -12 to -20 dB

### Step 10: Final level check

Play the mix with the vocal chain active.

```
tool: read_track_meters
params:
  trackIndex: [vocal track index]
```

After the compressors, the vocal output should:
- Average: -18 to -15 dBFS (slightly hotter than raw input to account for GR recovery)
- Peak: Not exceeding -6 dBFS

Adjust output gain on the second compressor if needed.

### Step 11: Save post-vocal snapshot

```
tool: snapshot_save
params:
  name: "post-vocal-chain"
  description: "Vocal chain complete: EQ + FET comp + Opto comp + reverb/delay sends"
```

## FX Chain Order

The correct insert order for vocal processing:

1. **Pitch correction** (if needed — not covered by this workflow; manual setup)
2. **EQ** — Corrective EQ first (HPF, problem frequencies)
3. **FET compressor** — First compression stage; character and control
4. **Opto compressor** — Second stage; smoothing and transparency
5. **De-esser** — After compression (compression can make sibilance worse)
6. **Saturation** (optional — adds warmth, presence)
7. **EQ (optional second EQ)** — Additive EQ after dynamics if needed
8. **Output trim** — Level matching after chain

Sends go to: Reverb bus, Delay bus (post-fader sends by default in REAPER).

## Verification

After building the chain, verify:

1. Vocal sits above the mix in the 1–4 kHz presence range without harshness
2. No audible compression pumping or breathing on sustained notes
3. Sibilant S sounds are controlled but not lispy
4. Reverb adds space without washing the vocal into the mix
5. Vocal cuts through when listening at low monitoring levels

## Common Pitfalls

- **Reversing compressor order**: FET first (character), then Opto (smoothing). Not the other way.
- **De-esser before compression**: Compression amplifies sibilance; de-ess after the compressors.
- **Reverb as insert**: Always use send/return for reverb. Insert reverb doubles the dry signal internally and causes comb filtering.
- **Too much attack time on FET comp**: If the attack is slow (>30 ms), the compressor catches the middle of the word, not the consonant. Vocals need 10–15 ms attack.
- **Not checking sibilance after compression**: A vocal that sounds fine raw may have harsh S sounds after 6+ dB of compression. Always check sibilance with the chain active.
- **Long reverb pre-delay causing rhythmic issues**: If the reverb onset is delayed 50+ ms, it can sound like an echo rather than space. 20–30 ms is the sweet spot.
