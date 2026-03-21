---
name: Gain Staging
id: gain-staging
description: Set all track levels to -18 dBFS average before processing begins
---

# Gain Staging

## When to Use

At the START of every mix session, before any FX are inserted. Proper gain staging ensures:
- All dynamics processors (compressors, limiters) operate in their optimal range
- No internal overloads within the FX chain
- Consistent headroom through the signal path
- The mix bus has 6–10 dB of headroom before any limiting

Run this workflow when:
- Starting a new mix from raw tracks
- After the session has grown (new tracks added, volumes changed)
- When the mix bus is regularly clipping or hitting 0 dBFS
- When compressors are not reacting as expected (threshold may be wrong due to staging)

## Prerequisites

- REAPER session is open with all tracks
- Audio is playing or has been played (meters have registered levels)
- No FX chains yet (or FX bypassed for the staging pass)
- Transport is set to a representative section of the song (dense chorus, not just intro silence)

## Step-by-Step

### Step 1: Save a snapshot before starting

Use `snapshot_save` to capture the current state before any changes.

```
tool: snapshot_save
params:
  name: "pre-gain-staging"
  description: "State before gain staging workflow"
```

### Step 2: Get all tracks

```
tool: list_tracks
```

Identify: track count, track names, folder structure (look for bus/folder tracks).

Skip tracks that are:
- Mix bus / master bus
- Reverb/delay return buses
- Folder tracks (their volume is set separately)

### Step 3: Play a representative section

```
tool: play
```

Play the densest, most representative section of the song (usually the chorus). Let it play for at least 10 seconds to build up meter readings.

### Step 4: Read meters for all tracks

```
tool: read_track_meters
params:
  trackIndex: [each track index]
```

Record: peak level (dBFS), RMS level (dBFS) for each track.

Target levels:
- **Average/RMS**: -18 dBFS (±3 dB acceptable)
- **Peak**: -12 dBFS (not exceeding -6 dBFS)

If a track reads:
- Average of -30 dBFS → needs gain increase
- Average of -8 dBFS → needs gain reduction
- Peak of -3 dBFS → dangerously hot, reduce gain

### Step 5: Calculate gain adjustments

For each track:
```
gain_adjustment_dB = -18 - current_average_dBFS
```

Example: Track averages -24 dBFS → needs +6 dB
Example: Track averages -10 dBFS → needs -8 dB

Round to nearest 0.5 dB for practical purposes.

### Step 6: Apply gain adjustments via track fader

```
tool: set_track_property
params:
  trackIndex: [n]
  property: "volume"
  value: [gain_adjustment_dB]
```

Note: `set_track_property` with `volume` takes dB values. The fader is the correct place to set gain stage — not per-plugin input gain — so that the signal is correct before any processing.

Apply to each track in order.

### Step 7: Verify mix bus headroom

After adjusting all tracks, read the mix bus meter:

```
tool: read_track_meters
params:
  trackIndex: [mix bus index — usually the last or master track]
```

Target: Mix bus should peak at -6 to -3 dBFS. If it's hitting 0 dBFS, pull all track faders down proportionally (or reduce master fader by the excess dB).

### Step 8: Check instrument relationships

Re-play the chorus section. Listen for:
- Does the kick still hit harder than the snare? (relative levels should still feel musical)
- Do vocals still sit over the instruments? (if not, the relative balance was off before; adjust individual tracks)

If relative balance is wrong, apply additional individual adjustments AFTER the gain staging is complete. Gain staging sets the floor; the mix is built on top of it.

### Step 9: Save post-staging snapshot

```
tool: snapshot_save
params:
  name: "post-gain-staging"
  description: "Gain staged — all tracks at -18 dBFS average"
```

## FX Chain Order (for the gain staging process itself)

This workflow requires no FX. It uses only fader adjustments. After completion, insert FX in this order:

1. Input gain trim (if using a gain plugin rather than the fader)
2. EQ
3. Compression
4. Saturation / excitement
5. Output trim

Each stage should receive signal at approximately -18 dBFS average for optimal plugin behavior.

## Verification

After completing gain staging:

1. Play the mix — average meter on mix bus should read approximately -18 to -12 dBFS RMS
2. Peak on mix bus should not exceed -6 dBFS in the chorus
3. Individual tracks should all be within ±6 dB of each other before mixing decisions (unless intentionally quiet elements like room mics)
4. No individual track should be peaking above -6 dBFS before faders

## Common Pitfalls

- **Using clip gain vs fader**: Gain staging is done with the fader or a dedicated trim plugin, not clip gain (which bakes the level into the audio). Faders allow re-visiting.
- **Staging with FX active**: Compressors and limiters on a track will affect the meter reading. Bypass all FX or stage to the raw audio level.
- **Ignoring bus tracks**: A drum bus that's receiving 8 inputs at -18 dBFS each will be summing to a much higher level. The bus fader controls the drum bus output level — check and adjust it.
- **Single-moment readings**: Read meters over a representative 10+ second passage, not a single snapshot that may catch silence or a single loud peak.
- **Not checking after gain staging**: Always play the mix after staging to confirm balance feels correct. The numbers are targets, not rules — use ears to verify.
