---
name: FabFilter Pro-Q 3
fx_match: ["Pro-Q3", "Pro-Q 3", "VST3: Pro-Q3 (FabFilter)", "VST: Pro-Q3 (FabFilter)", "FabFilter Pro-Q 3"]
category: eq
style: transparent
vendor: FabFilter
preference: 90
replaces: ["rea-eq"]
---

# FabFilter Pro-Q 3

## What it does

Pro-Q 3 is the industry-standard parametric EQ for mixing and mastering. It offers up to 24 bands with natural-phase, linear-phase, and zero-latency modes. Each band can operate in mid/side or left/right mode independently. Dynamic EQ mode turns any band into a frequency-reactive compressor or expander — this is its killer feature for taming sibilance, resonances, and proximity effect without static cuts. Excellent spectrum analyzer with collision detection (match EQ against a reference). Clean, transparent character; adds no harmonic coloration. CPU-efficient given its capabilities.

## Key parameters by name

Parameters are indexed per band. Band 1 parameters:

| Parameter | Range | Description |
|-----------|-------|-------------|
| Band N Frequency | 10–48000 Hz | Center/cutoff frequency |
| Band N Gain | -30 to +30 dB | Boost or cut — 0 for filter types |
| Band N Q | 0.025–40 | Bandwidth — higher = narrower |
| Band N Shape | Bell/LShelf/HShelf/LCut/HCut/Tilt/BandPass/Notch/Flat | Filter shape |
| Band N Slope | 6/12/18/24/30/36/48/72/96 dB/oct | Only for cut filters |
| Band N Stereo | Stereo/Left/Right/Mid/Side | Which part of stereo field to process |
| Band N Dynamic | 0 or 1 | Enable dynamic EQ mode |
| Band N Threshold | -80 to 0 dB | Dynamic mode threshold |
| Band N Range | -30 to +30 dB | Max dynamic movement |
| Band N Attack | 1–1000 ms | Dynamic mode attack |
| Band N Release | 5–5000 ms | Dynamic mode release |
| Output Gain | -36 to +36 dB | Master output trim |
| Phase Mode | 0/1/2 | 0=Natural Phase, 1=Linear Phase, 2=Zero Latency |

## Recommended settings

### Surgical resonance removal (dynamic EQ mode)

Use when a frequency is problematic only at certain loudness levels.

| Parameter | Value | Why |
|-----------|-------|-----|
| Band N Shape | Bell | Targeted |
| Band N Frequency | Problem frequency (e.g. 3200 Hz harsh peak) | Identify with spectrum analyzer |
| Band N Gain | -3 to -6 dB | Maximum cut when triggered |
| Band N Dynamic | on | Only cuts when signal is loud |
| Band N Threshold | Set just above resonance level | |
| Band N Attack | 5–10 ms | Fast enough to catch peaks |
| Band N Release | 50–100 ms | Musical release |

### De-essing via dynamic EQ (alternative to dedicated de-esser)

| Parameter | Value | Why |
|-----------|-------|-----|
| Band N Frequency | 6000–9000 Hz | Sibilance zone — find the worst peak |
| Band N Shape | Bell or High Shelf | Bell for surgical, shelf for broad |
| Band N Gain | -4 to -8 dB | Maximum cut |
| Band N Dynamic | on | Only triggers on harsh S sounds |
| Band N Threshold | Just above normal vocal level | |
| Band N Attack | 1–5 ms | Very fast for sibilance |
| Band N Release | 30–60 ms | Fast enough for individual sibilants |

### Mid/side mastering EQ

| Parameter | Value | Why |
|-----------|-------|-----|
| Band 1 Stereo | Mid | HPF on Mid only |
| Band 1 Shape | High Cut | |
| Band 1 Frequency | 80–100 Hz | Mono bass, no rumble in M/S |
| Band 2 Stereo | Side | Boost air in sides for width |
| Band 2 Shape | High Shelf | |
| Band 2 Frequency | 10000 Hz | Air boost |
| Band 2 Gain | +1 to +2 dB | Subtle — side boost widens mix |
| Band 3 Stereo | Side | Reduce low-mid width (tighten) |
| Band 3 Shape | Bell | |
| Band 3 Frequency | 200–400 Hz | Tighten low-mid stereo |
| Band 3 Gain | -1 to -2 dB | |

### Vocal track standard processing

| Parameter | Value | Why |
|-----------|-------|-----|
| Band 1 Shape | High Cut | HPF |
| Band 1 Frequency | 80–100 Hz | Remove rumble |
| Band 1 Slope | 24 dB/oct | Clean cut |
| Band 2 Shape | Bell | Reduce proximity effect / boxiness |
| Band 2 Frequency | 250–400 Hz | |
| Band 2 Gain | -1 to -3 dB | |
| Band 3 Shape | Bell (dynamic) | Sibilance control |
| Band 3 Frequency | 7000–9000 Hz | |
| Band 3 Gain | -3 to -5 dB | |
| Band 3 Dynamic | on | |
| Band 4 Shape | High Shelf | Air/presence |
| Band 4 Frequency | 10000–12000 Hz | |
| Band 4 Gain | +1 to +2.5 dB | |

## Presets worth knowing

- **Default** — Flat, no processing. Good starting point.
- Look for genre-specific vocal, mix bus, and mastering presets in the FabFilter preset library (if installed).

## When to prefer this

- Always prefer over ReaEQ when installed — superior visualization, dynamic EQ, and mid/side capabilities
- For de-essing without a separate de-esser plugin (dynamic EQ mode on 6–9 kHz)
- For mastering with linear phase mode (avoids phase distortion at low frequencies)
- For matching EQ to a reference track (use the spectrum analyzer's reference display)
- For complex resonance removal where the problem only appears at certain levels

This is the go-to EQ in all situations when available. Only fall back to ReaEQ if Pro-Q 3 is not installed.
