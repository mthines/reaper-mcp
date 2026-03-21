---
name: ReaEQ
fx_match: ["ReaEQ", "VST: ReaEQ", "ReaEQ (Cockos)"]
category: eq
style: transparent
vendor: Cockos
preference: 40
---

# ReaEQ

## What it does

ReaEQ is REAPER's built-in parametric equalizer with up to 64 bands. It is phase-linear capable (zero-latency linear phase mode available), sounds clean and transparent, and has no coloration of its own. It is the universal fallback when no third-party EQ is installed. Supports multiple filter types per band including Bell, Low Shelf, High Shelf, Low Pass, High Pass, Band Pass, and Notch. Does not have per-band saturation or dynamic EQ capabilities.

## Key parameters by name

ReaEQ parameters are addressed by band index and parameter type. With the MCP `set_fx_parameter` tool, parameters are normalized 0.0–1.0. The following describes the conceptual ranges:

| Parameter | Range | Description |
|-----------|-------|-------------|
| Band N Enabled | 0 or 1 | Enable/disable the band |
| Band N Frequency | 20–20000 Hz | Center or cutoff frequency |
| Band N Gain | -36 to +36 dB | Boost or cut amount (Bell, Shelf) |
| Band N Bandwidth | 0.1–4.0 octaves | Width of Bell band |
| Band N Type | 0–7 | 0=Low Shelf, 1=High Shelf, 2=Band, 3=Low Pass, 4=High Pass, 5=All Pass, 6=Band Pass, 7=Notch |

Note: ReaEQ shows raw parameter indices in REAPER's FX window. Band 1 occupies the first 4 parameters, Band 2 the next 4, etc.

## Recommended settings

### High-pass filter on vocals

Remove sub-rumble and handling noise below the vocal fundamental.

| Parameter | Value | Why |
|-----------|-------|-----|
| Band 1 Type | High Pass (4) | Steep roll-off below cutoff |
| Band 1 Frequency | 80–100 Hz | Below lowest chest-voice fundamentals |
| Band 1 Bandwidth | 0.5 octave | Creates gentle 12 dB/oct slope |

### High-pass filter on acoustic guitar / electric guitar

| Parameter | Value | Why |
|-----------|-------|-----|
| Band 1 Type | High Pass | Remove body resonance and handling |
| Band 1 Frequency | 80–120 Hz | Below lowest guitar fundamental (82 Hz open low E) |

### Mud reduction on full mix (250–400 Hz)

| Parameter | Value | Why |
|-----------|-------|-----|
| Band N Type | Bell | Surgical cut, not shelf |
| Band N Frequency | 250–400 Hz | Low-mid mud zone |
| Band N Gain | -2 to -4 dB | Gentle — broad cuts are subtle |
| Band N Bandwidth | 1.5–2.0 octaves | Wide reduction clears the whole mud zone |

### Presence boost on vocals (3–5 kHz)

| Parameter | Value | Why |
|-----------|-------|-----|
| Band N Type | Bell | Targeted boost |
| Band N Frequency | 3000–4000 Hz | Presence peak, cuts through a mix |
| Band N Gain | +1.5 to +3 dB | Careful — this zone causes harshness |
| Band N Bandwidth | 1.0 octave | Moderate — too narrow sounds phasey |

### Air boost (10–16 kHz shelf)

| Parameter | Value | Why |
|-----------|-------|-----|
| Band N Type | High Shelf | Smooth broadband boost |
| Band N Frequency | 10000–12000 Hz | Start of air band |
| Band N Gain | +1 to +3 dB | Add sparkle without harshness |

### Kick drum low-end punch

| Parameter | Value | Why |
|-----------|-------|-----|
| Band 1 Type | High Pass | Remove sub rumble |
| Band 1 Frequency | 30–40 Hz | Below kick fundamental |
| Band 2 Type | Bell | Boost the punch |
| Band 2 Frequency | 60–80 Hz | Kick punch zone |
| Band 2 Gain | +2 to +4 dB | Reinforce fundamental |
| Band 3 Type | Bell | Reduce click box if needed |
| Band 3 Frequency | 300–500 Hz | Cardboard/boxy zone |
| Band 3 Gain | -2 to -4 dB | Tighten the tone |
| Band 4 Type | Bell | Add click/attack |
| Band 4 Frequency | 3000–5000 Hz | Beater click zone |
| Band 4 Gain | +2 to +4 dB | Help kick cut through |

## Presets worth knowing

No notable factory presets. Build from the recommended settings above.

## When to prefer this

- When no third-party EQ is installed — ReaEQ is always available
- When you need phase-linear processing (enable linear phase mode) for mastering
- When you need more than 8 bands — ReaEQ supports up to 64
- When transparency is the priority and coloration is unwanted
- When CPU budget is tight — ReaEQ is extremely lightweight

Prefer FabFilter Pro-Q 3 (preference: 90) when available for its per-band dynamic EQ, better visualization, and mid/side processing.
