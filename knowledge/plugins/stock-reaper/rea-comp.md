---
name: ReaComp
fx_match: ["ReaComp", "VST: ReaComp", "ReaComp (Cockos)"]
category: compressor
style: transparent
vendor: Cockos
preference: 35
---

# ReaComp

## What it does

ReaComp is REAPER's built-in compressor. It is clean and transparent with no harmonic coloration. Supports standard compressor parameters plus sidechain input, lookahead (up to 1000ms), soft-knee, and RMS/Peak detection. Best used as a utility compressor when no third-party compressors are available. It lacks the character of FET, optical, or VCA designs, but is accurate and predictable.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Threshold | -60 to 0 dB | Level above which compression begins |
| Ratio | 1:1 to inf:1 | Compression amount — 4:1 is moderate, 10:1+ is limiting |
| Attack | 0.1–1000 ms | Time to reach full compression after signal exceeds threshold |
| Release | 1–5000 ms | Time for gain reduction to recover after signal drops below threshold |
| Knee | 0–24 dB | Hard knee (0) vs soft knee (higher values) — soft knee is more transparent |
| Pre-comp (lookahead) | 0–1000 ms | Lookahead time — adds latency but allows reaction before transient hits |
| RMS Size | 0–1000 ms | 0 = peak detection; higher = RMS averaging |
| Dry Mix | 0–100% | Parallel compression blend (wet signal remains at 100%) |
| Wet | -inf to 0 dB | Output level of compressed signal |
| Auto makeup | checkbox | Automatically apply makeup gain based on ratio and threshold |

## Recommended settings

### Vocals — general purpose (transparent)

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -18 to -24 dB | Catch the louder phrases |
| Ratio | 3:1 to 4:1 | Moderate control |
| Attack | 10–15 ms | Let transient consonants through |
| Release | 50–100 ms | Fast enough not to pump |
| Knee | 6 dB | Soft knee for transparency |
| RMS Size | 30–50 ms | Smooths out peak response |
| GR target | 3–6 dB | Adequate control without squashing |

### Drum bus glue

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -18 to -24 dB | Hit moderately |
| Ratio | 4:1 | Moderate glue |
| Attack | 10–30 ms | Preserve transient attack |
| Release | 50–100 ms | Slightly pumpy can work on drums |
| Knee | 3 dB | Slight soft knee |
| GR target | 2–4 dB | Light glue |

### Parallel drums ("New York compression")

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -30 to -40 dB | Hit very hard |
| Ratio | 20:1 to 100:1 | Near limiting |
| Attack | 0.1–1 ms | Kill all transients |
| Release | 50–200 ms | Some breathing |
| Dry Mix | 40–60% | Blend with uncompressed signal |
| GR target | 10–20 dB | Heavy squash, blended back in |

### Bass guitar

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -18 to -24 dB | Control dynamic range |
| Ratio | 4:1 | Consistent output |
| Attack | 5–20 ms | Allow pick attack to come through |
| Release | 50–150 ms | Musical release |
| Knee | 3–6 dB | Smooth |
| GR target | 2–4 dB | Tighten without killing feel |

### Master bus glue (light)

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -6 to -12 dB | Catch only peaks |
| Ratio | 2:1 | Very light |
| Attack | 10–30 ms | Preserve transients |
| Release | 100–300 ms | Auto-feel |
| Knee | 6–12 dB | Maximum transparency |
| GR target | 1–2 dB | Glue only |

## Presets worth knowing

No notable factory presets. Build from settings above.

## When to prefer this

- When no third-party compressor is available — ReaComp is always present
- When pure transparency and accuracy are needed over character
- When you need lookahead compression (sibilance control, brick-wall peaks)
- When doing parallel compression (Dry Mix knob is very convenient)

Prefer FabFilter Pro-C 2 (preference: 85) when available for its modeling modes (FET, Optical, VCA, etc.), better visualization, and program-dependent release. For vocal FET character, the JS: 1175 Compressor is preferred over ReaComp despite lower overall quality.
