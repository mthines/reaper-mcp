---
name: JS 1175 Compressor
fx_match: ["JS: Dynamics/1175_compressor", "1175_compressor", "1175 compressor"]
category: compressor
style: vintage
vendor: Cockos (JSFX)
preference: 50
replaces: []
---

# JS 1175 Compressor

## What it does

The JS 1175 is a free FET compressor emulation included with REAPER's JSFX library. It models the behavior of the classic Universal Audio 1176 compressor — a FET (field-effect transistor) design known for fast attack times, aggressive character, and a distinctive "pushed" quality that adds grit and presence. Unlike ReaComp (which is neutral), the 1175 adds saturation-like harmonic coloration and responds dynamically in a musical way. The "all buttons in" mode (All ratio) creates a heavily compressed, harmonically rich sound favored on rock vocals, drums, and bass.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Input | 0–100 | Input gain (gain reduction increases with higher input) — no dB scale |
| Output | 0–100 | Output gain (makeup gain) |
| Attack | 1–7 (inverted) | 1 = slowest attack, 7 = fastest (20 µs) — NOTE: scale is inverted |
| Release | 1–7 (inverted) | 1 = slowest release, 7 = fastest — inverted like original hardware |
| Ratio | 4 / 8 / 12 / 20 / All | 4:1, 8:1, 12:1, 20:1, or All-buttons-in (≈ 12:1 with heavy harmonic content) |

Important: Attack and Release parameters on the 1175 are inverted — higher numbers mean faster times, matching the original 1176 hardware where the pots worked backwards.

## Recommended settings

### Lead vocals — FET character (4:1, moderate)

Adds presence and "glue" without killing dynamics. Classic rock/pop vocal sound.

| Parameter | Value | Why |
|-----------|-------|-----|
| Ratio | 4 | Moderate FET compression |
| Attack | 5–6 | Fast enough to catch consonants without fully killing them |
| Release | 3–4 | Musical release that follows phrase rhythm |
| Input | Set for 6–8 dB GR | Drive it into the FET character |
| Output | Match perceived loudness | Makeup gain |

### Lead vocals — heavy FET (All buttons in)

The "1176 in all-in" mode. Heavy, characterful, slightly distorted. Works on rock and alternative vocals where aggression is desired.

| Parameter | Value | Why |
|-----------|-------|-----|
| Ratio | All | All-buttons mode |
| Attack | 4–5 | Let a little transient through |
| Release | 3–4 | |
| Input | Set for 8–12 dB GR | Push hard |
| Output | Pull back to match level | The all-in mode is loud |

### Snare drum — attack/presence

| Parameter | Value | Why |
|-----------|-------|-----|
| Ratio | 8 or 12 | Aggressive snare compression |
| Attack | 3–4 | Slightly slower — let the crack through |
| Release | 5–6 | Fast release, snappy |
| Input | 6–10 dB GR | |

### Bass guitar DI

| Parameter | Value | Why |
|-----------|-------|-----|
| Ratio | 4 or 8 | Tighten the dynamic range |
| Attack | 4–5 | Preserve pick attack |
| Release | 3–4 | Fast enough for fast passages |
| Input | 4–8 dB GR | |

### Room mics / overhead parallel compression

| Parameter | Value | Why |
|-----------|-------|-----|
| Ratio | 20 or All | Crush the peaks |
| Attack | 6–7 | Very fast — kill transients |
| Release | 2–3 | Slower release for pumping effect |
| Input | 10–20 dB GR | Blend 30–50% in parallel |

## Presets worth knowing

No factory presets. Settings are all by ear using the GR meter.

## When to prefer this

- When you need FET compressor character on vocals and no Pro-C 2 is available
- On snare and drum room mics when aggression is wanted
- When adding harmonic excitation to bass without a dedicated saturator
- The "All" ratio mode is uniquely this style of compressor — use it when the mix needs character
- Prefer over ReaComp whenever character > transparency

When FabFilter Pro-C 2 (preference: 85) is available with its FET mode, prefer that for its better parameter control and metering. But the JS 1175 outperforms ReaComp for FET-style use cases.
