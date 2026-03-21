---
name: Low-End Management
id: low-end
description: Fix and optimize the bass and sub frequencies in a mix
---

# Low-End Management

## When to Use

When the mix has low-frequency problems: too much bass, too little punch, muddy low-mids, kick and bass fighting each other, or bass that doesn't translate to small speakers. This is one of the most common mixing problems, especially for home studio mixes on desktop speakers with poor low-frequency response.

Use this workflow when:
- User says "the bass is muddy" or "too much low end"
- User says "I can't hear the bass on earbuds/small speakers"
- Kick drum is losing against bass guitar or vice versa
- Mix sounds fine in the studio but thin or boomy elsewhere
- User says "there's rumbling bass" or "the low end is out of control"

## Prerequisites

- Gain staging complete
- All bass-producing tracks identified (kick, bass guitar, 808, synth bass, low keys)
- Transport playing through a representative section (not intro silence)
- Mix is audible (not just metered in silence)

## Step-by-Step

### Step 1: Save snapshot

```
tool: snapshot_save
params:
  name: "pre-low-end"
  description: "Before low-end management"
```

### Step 2: Identify all low-frequency tracks

```
tool: list_tracks
```

Identify every track contributing below 200 Hz:
- Kick drum
- Bass guitar / synth bass / 808
- Piano (left hand)
- Organ bass
- Pads with sub content
- Room mics (indirect bass)

These tracks are the "low-end family" and need to be managed together, not individually in isolation.

### Step 3: Spectrum analysis on each bass track

For each bass-producing track:

```
tool: read_track_spectrum
params:
  trackIndex: [track index]
```

Record the approximate peak frequencies and energy distribution. Look for:
- Where is the fundamental energy concentrated?
- Is there energy below 30 Hz (ultra-sub — usually unwanted rumble)?
- Where is the 200–400 Hz "mud zone" energy?

### Step 4: Apply aggressive HPF to non-bass instruments

The most effective low-end cleanup is removing bass from instruments that don't need it.

For each non-bass track (guitar, piano high range, vocals, synths, cymbals):

```
tool: add_fx
params:
  trackIndex: [track index]
  fxName: "Pro-Q3"  # or ReaEQ
```

Apply HPF at appropriate frequency (from reference/frequencies.md):

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Lead vocals | 80–100 Hz | |
| Backing vocals | 100–120 Hz | |
| Electric guitar (rhythm) | 80–120 Hz | Higher for metal |
| Electric guitar (lead) | 80–100 Hz | |
| Acoustic guitar | 80–120 Hz | |
| Piano (if not bass role) | 80 Hz | |
| Pads/synths | 80–150 Hz | Depends on register |
| Snare | 100–150 Hz | |
| Overheads | 200–400 Hz | Often 300+ Hz for tight overhead sound |
| Room mics | 80–200 Hz | Depends on room character |
| Any FX return | 100–200 Hz | Prevent verb/delay muddying bass |

```
tool: set_fx_parameter
# Set Band 1 Type to HPF
# Set Band 1 Frequency to target value (normalized)
# Set Band 1 Slope to 24 dB/oct
```

This step alone often resolves 80% of low-end problems.

### Step 5: Define the kick-bass relationship

Kick and bass guitar must occupy different frequency zones or use sidechain compression to share the space dynamically. There are two approaches:

**Approach A: Frequency splitting (static)**

Assign each instrument to a specific zone:
- Kick owns: 50–80 Hz (the punch/thump)
- Bass guitar owns: 80–150 Hz (the warmth and note)

On kick drum EQ:
```
tool: set_fx_parameter
# Boost 60–70 Hz (+2 to +3 dB Bell)
# Cut bass guitar's zone 100–150 Hz (-2 dB Bell)
```

On bass guitar EQ:
```
tool: set_fx_parameter
# Boost 100–120 Hz (+2 dB Bell)
# Dip at 60–80 Hz (-2 dB Bell) where kick lives
```

**Approach B: Sidechain compression (dynamic)**

Kick triggers compression on the bass guitar — every time the kick hits, the bass ducks slightly, creating a rhythmic pump that's characteristic of many modern genres.

```
tool: add_fx
params:
  trackIndex: [bass guitar index]
  fxName: "Pro-C2"
```

- Enable sidechain input from kick track
- Ratio: 4:1–6:1
- Attack: 1–5 ms (very fast, duck immediately)
- Release: 50–150 ms (release before next kick)
- Threshold: Set for 3–8 dB GR per kick hit

### Step 6: Mono sum below 100 Hz (critical for translation)

Bass below 100 Hz must be in mono for proper playback on:
- Club sound systems (sub is mono)
- Car audio (single sub)
- Earbuds (stereo below 80 Hz causes imaging problems)
- Bluetooth speakers

Method A: Use a mid/side EQ to isolate the side channel and high-pass it at 100 Hz (removing bass from the sides):

```
tool: add_fx
params:
  trackIndex: [master bus or bass track]
  fxName: "Pro-Q3"
```

In Pro-Q 3:
- Add a band, set to Side channel only
- Set band type to Low Cut (HPF)
- Frequency: 100 Hz
- Slope: 24 dB/oct

This removes bass from the side information while leaving mid bass intact — effectively mono-summing below 100 Hz.

Method B: Ensure bass tracks (kick, bass guitar) are themselves mono. Check that they are not panned or spread. A bass guitar should be center (0% pan).

### Step 7: Cut the mud zone (250–500 Hz)

The "mud zone" (250–500 Hz) is where most low-end muddiness lives. Multiple instruments stacking in this zone creates congestion.

For each instrument with significant energy in this zone (check spectrum from Step 3):

```
tool: set_fx_parameter
# On each instrument's EQ:
# Add Bell band at 300–400 Hz
# Gain: -2 to -4 dB
# Q: 0.8–1.2 (wide cut)
```

The cumulative effect of cutting each instrument -2 to -3 dB in this zone clears the mud without making any single instrument sound thin.

### Step 8: Control sub rumble below 30 Hz

Any energy below 30 Hz is inaudible on most speakers but wastes headroom and causes distortion in amplifiers.

On the master bus (or on bass-heavy individual tracks):

```
tool: add_fx
params:
  trackIndex: [master bus or bass guitar]
  fxName: "Pro-Q3"
```

Apply HPF at 25–30 Hz with 12–24 dB/oct slope. This removes inaudible sub rumble without affecting the musical bass content.

### Step 9: Bass translation check

Play the mix and check how it translates on different systems. The agent can report spectrum readings to simulate this:

```
tool: read_track_spectrum
params:
  trackIndex: [master bus]
```

Check if bass energy (60–250 Hz) is balanced against midrange (500 Hz–2 kHz):
- Bass-heavy: 60–250 Hz reads significantly higher than mids
- Too thin: 60–250 Hz reads much lower than mids
- Balanced: Within 6–10 dB of each other

For small-speaker translation, ensure the 150–300 Hz range has content — this is where bass is "heard" on phone speakers.

### Step 10: Save snapshot

```
tool: snapshot_save
params:
  name: "post-low-end"
  description: "Low-end management complete: HPF applied, kick-bass relationship defined, mono sum below 100 Hz"
```

## FX Chain Order (relevant to low-end management)

Per bass instrument track:
1. **HPF** (on all non-bass instruments — removes unnecessary low-end)
2. **EQ** (frequency splitting — define kick vs bass zones)
3. **Compressor** with sidechain (kick triggers bass ducking — optional but common)
4. **Saturation** (for bass guitar — adds harmonics for small-speaker translation)

On master bus:
1. **HPF at 25–30 Hz** (remove inaudible rumble)
2. **Mid/Side HPF on side channel at 100 Hz** (enforce mono bass)

## Verification

After completing low-end management:

1. Mix bus spectrum should show smooth bass response, not a single boomy peak
2. Kick should be clearly distinguishable from bass guitar rhythm at all dynamics
3. Bass should still be audible when listening on phone speakers or earbuds (check 150–300 Hz)
4. No audible rumble in quiet sections (floor noise, mic hum)
5. Bass translation: if you can feel the kick and hear the bass note on small speakers, the low end is translating

## Common Pitfalls

- **Only fixing one instrument**: Low-end mud is cumulative. Cutting 2 dB from the bass guitar alone does nothing if 8 other tracks are adding to the mud. The HPF sweep across all non-bass instruments is the most powerful step.
- **HPF too high on bass instruments**: Cutting the bass guitar above 60 Hz will make it disappear. The bass guitar IS the bass — preserve its fundamental.
- **Stereo bass below 100 Hz**: Wide bass causes playback problems on mono systems. Always verify bass is mono below 100 Hz.
- **Boosting bass vs cutting mud**: It is tempting to boost the bass to make it louder. Instead, cut the mud (250–500 Hz on competing instruments) — the bass will appear to come forward without actually being louder.
- **Not checking kick-bass relationship separately**: Listen to kick and bass guitar alone together. They should lock and complement each other, not fight. If they fight, the frequency zones are overlapping.
- **Missing sub-30 Hz content**: Low-end rumble below 30 Hz is inaudible but eats headroom. Always apply a gentle HPF on the master bus.
