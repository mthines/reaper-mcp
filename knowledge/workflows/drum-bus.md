---
name: Drum Bus
id: drum-bus
description: Build a drum bus processing chain for glue and impact
---

# Drum Bus

## When to Use

When a session has multiple drum tracks (kick, snare, toms, overheads, rooms) that need to be unified into a coherent, punchy drum sound. The drum bus is the glue between individual drum elements.

Use this workflow when:
- Drums feel loose and un-glued despite individual track processing
- The user says "the drums don't punch" or "drums sound separate"
- Starting a new session with a live drum kit recording
- Building a parallel compression setup for maximum impact

## Prerequisites

- Individual drum tracks exist (kick, snare, at minimum)
- A drum bus (folder track / submix) exists or can be identified
- Gain staging complete on individual drum tracks
- Play a section with full drum performance (not just a single hit)

## Step-by-Step

### Step 1: Save snapshot

```
tool: snapshot_save
params:
  name: "pre-drum-bus"
  description: "Before drum bus processing"
```

### Step 2: Identify drum tracks

```
tool: list_tracks
```

Identify:
- Individual drum tracks: kick, snare, hi-hat, toms, overheads, room mics
- Drum bus/folder track (receives signal from all drum tracks)
- Parallel drum bus (if it exists — if not, create one in Step 4)

Note the `trackIndex` for the drum bus.

### Step 3: Verify drum bus routing

```
tool: get_track_routing
params:
  trackIndex: [drum bus index]
```

Confirm that kick, snare, and other drum tracks are sending to the drum bus. If routing is incorrect, flag to the user — cannot fix routing via the current MCP toolset.

### Step 4: Add compressor to drum bus (VCA glue compressor)

Select: Pro-C 2 Bus mode preferred, ReaComp as fallback.

```
tool: add_fx
params:
  trackIndex: [drum bus index]
  fxName: "Pro-C2"
```

Settings (VCA glue — tighten, don't squash):

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Bus | VCA bus compression character |
| Ratio | 4:1 | Moderate |
| Attack | 10–20 ms | Preserve kick and snare transient attack |
| Release | Auto or 80–150 ms | Musical, follows drum rhythm |
| Threshold | Set for 3–5 dB GR | Light glue |
| Knee | 4–6 dB | Soft knee for transparent onset |
| Sidechain HPF | 80–100 Hz | Prevent kick fundamental from triggering comp too hard |

```
tool: set_fx_parameter
# Set Sidechain HPF to 80 Hz (prevents low-frequency triggered pumping)
```

Play the chorus/main groove section while adjusting threshold until GR meter shows 3–5 dB GR. The drums should feel "tighter" without losing punch.

### Step 5: Add EQ after compressor on drum bus

Subtle EQ after the compressor can shape the drum bus tone.

```
tool: add_fx
params:
  trackIndex: [drum bus index]
  fxName: "Pro-Q3"  # or ReaEQ
```

Standard drum bus EQ (gentle):
- No HPF needed (bus inherits from individual tracks)
- Optional: Bell boost at 60–80 Hz (+1 to +2 dB) if kick punch needs reinforcement
- Optional: Bell cut at 200–350 Hz (-1 to -2 dB) if drum bus sounds boxy
- Optional: Bell boost at 8–10 kHz (+1 to +1.5 dB) for cymbal air and openness

Keep EQ moves subtle — ±2 dB maximum on a bus.

### Step 6: Set up parallel compression bus

The signature "rock/metal drum impact" sound requires parallel compression:

If a parallel drum bus doesn't exist, alert the user that one should be created (routing setup required). If it does exist:

```
tool: add_fx
params:
  trackIndex: [parallel drum bus index]
  fxName: "Pro-C2"  # or ReaComp
```

Settings (heavy crush, then blend back):

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | FET | Aggressive character |
| Ratio | 20:1 | Near-limiting |
| Attack | 0.1–2 ms | Kill all transients |
| Release | 50–150 ms | Some pump for energy |
| Threshold | Set for 15–20 dB GR | Crush the drums |
| Mix (if available) | 100% | Wet only — blend with dry on fader |

```
tool: set_fx_parameter
# Set ratio to 20:1 via normalized value
```

Adjust parallel bus fader to blend: start at -12 dB and increase until drums have more punch and weight without sounding over-compressed. Typical final blend: -6 to -9 dB fader on parallel bus relative to main drum bus.

### Step 7: Individual track cleanup (if not already done)

Check these essential individual tracks:

**Kick drum:**
```
tool: read_track_spectrum
params:
  trackIndex: [kick track index]
```
Look for: punch at 60–80 Hz, remove boxiness at 300–400 Hz, ensure click/attack at 3–5 kHz.

**Snare:**
```
tool: read_track_spectrum
params:
  trackIndex: [snare track index]
```
Look for: crack at 200 Hz, remove excessive ring (narrow cut where ring resonates), presence at 5–8 kHz.

### Step 8: Check mono compatibility of drum bus

Overhead mics and room mics create stereo information. Ensure the drum bus is mono-compatible:

Play the mix with overheads — then listen to how it sounds in mono. If cymbals disappear, the overhead panning or phase relationship is causing comb filtering. This is an advanced issue to flag to the user rather than fix automatically.

### Step 9: Set drum bus level relative to mix

```
tool: read_track_meters
params:
  trackIndex: [drum bus index]
```

Drum bus output target: -10 to -8 dBFS peak before going to mix bus. This leaves room for the rest of the mix. If the drum bus is louder than this, reduce the drum bus fader.

### Step 10: Save snapshot

```
tool: snapshot_save
params:
  name: "post-drum-bus"
  description: "Drum bus: VCA glue comp + EQ + parallel compression blend"
```

## FX Chain Order (on the drum bus)

1. **Bus compressor** (VCA/Bus style) — glue and control
2. **EQ** — subtle tonal shaping after compression
3. **Saturation** (optional) — subtle harmonic content, especially for sample-based drums
4. **Limiter** (optional safety) — prevent drum bus from clipping; set at -0.5 dBFS ceiling

Parallel compression is on a separate bus, not an insert.

## Verification

After completing the drum bus workflow:

1. Play the full mix — drums should feel tight, cohesive, and punchy
2. Check that the compressor's GR is working (3–5 dB reduction, not 0 or 15+)
3. Kick transient should still click through clearly despite compression
4. Snare crack should be present
5. No "pumping" that sounds unintentional (test by adjusting sidechain HPF if pumping is audible)
6. Parallel compression blend: remove parallel bus and confirm the difference — it should add weight without changing the character

## Common Pitfalls

- **Too-fast attack on drum bus**: Attack below 5 ms kills the kick and snare transients — the most common drum bus mistake. Start at 10–20 ms and adjust.
- **No sidechain HPF**: Without filtering the sidechain, the kick's sub frequencies trigger the compressor too hard, causing audible pumping. Always set HPF to 80–100 Hz on drum bus sidechain.
- **Parallel compression too loud**: The parallel bus should add weight, not presence. If the parallel bus is louder than the main bus, the uncompressed transients are lost. Blend conservatively.
- **Bus compression on already over-compressed individual tracks**: If kick and snare are already clamped hard at the track level, bus compression has nothing musical to do. Check individual track compression first.
- **Not using the drum bus gain structure**: The drum bus fader should control how loud the drums sit in the mix. Don't mix drums by adjusting individual track faders after the bus is set up.
