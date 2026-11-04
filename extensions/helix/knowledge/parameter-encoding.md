---
title: Parameter Encoding — Normalized vs Real Units
impact: HIGH
tags:
  - helix
  - parameters
  - encoding
  - correctness
---

# Parameter Encoding

The single most error-prone part of editing a Helix preset.
**Parameter values use a mixed encoding** — some are normalized `0.0–1.0`, others are stored in real units (Hz, dB, semitones, degrees, indices).
Writing a real-unit value into a normalized slot (or vice versa) produces a silently wrong tone, not an error.

This was verified by inspecting real `.hlx` files: amp knobs read `0.55`, while a cab `LowCut` reads `60` and a gate `threshold` reads `-68`.

## The rule

**Never assume a scale. Read the existing value in the same parameter and stay in its unit.**
The most reliable way to know a parameter's unit is to inspect the same parameter in a real preset (the user's library, or a freshly exported Helix Native preset).

## Lookup table

| Parameter family | Encoding | Examples (real values) |
| --- | --- | --- |
| Amp tone/gain knobs | normalized `0.0–1.0` | `Drive 0`, `Mid 0.55`, `Treble 0.35`, `Master 0.46` |
| Simple drive knobs | normalized `0.0–1.0` | TS808 `Gain 0.55`, Klon `Tone`, `Level` |
| Mix / Level (on FX) | usually `0.0–1.0` | `Mix 0.38` — **but** cab/EQ `Level` is often dB (`0` = unity) |
| Cab/IR `LowCut`/`HighCut` | **Hz** | `LowCut 60`, `HighCut 20000` |
| Cab `Angle` | **degrees** | `Angle 45` |
| Cab `Distance`, `Position`, `Mic` | **real units / indices** | `Distance 11`, `Position 0`, `Mic 4` |
| EQ `*Freq`, `*Cut` | **Hz** | `MidFreq 4000`, `LowCut 80` |
| EQ `*Gain` | **dB** | `MidGain -7` |
| EQ `*Q` | number | `MidQ` |
| Comp `Threshold` | **dB** | `Threshold -39` |
| Comp `Ratio` | ratio number | `Ratio 4` |
| Gate `*Threshold` (block + input) | **dB** | input `threshold -68`, `OpenThreshold` |
| Gate/input `decay` | normalized `0.0–1.0` | `decay 0.0099` |
| Pitch `Interval` | **semitones** | `Interval1 -12` (down an octave) |
| Pitch `Cents` | **cents** | `Cents1` |
| Delay `Time` | ms or `Scale` + `TempoSync1` | `TempoSync1: true` → `SyncSelect1` note value drives time |
| Controller `@min`/`@max` | **same unit as the target param** | `Threshold` range `-60`…`0` (dB); `Level` range `5`…`15.5` |

## Floats are stored at full double precision

Real presets store `0.55` as `0.550000011920929`.
You do **not** need to reproduce that precision — Helix accepts clean values like `0.55`.
But when comparing/round-tripping, expect long decimals from Helix's own exports.

## Boolean and enum params

- Bypass: `@enabled` is a JSON boolean (`true`/`false`).
- `TempoSync1`, `noiseGate`, `B Polarity`, etc. are booleans.
- `Mic`, `Mode`, `Type`, `Wave`, `SyncSelect1` are integer **enum indices** — their meaning is model-specific. Copy from a real preset rather than guessing the index.

## Correct vs incorrect

```jsonc
// CORRECT — cut fizz at 4 kHz by 7 dB on a parametric EQ
"MidFreq": 4000, "MidGain": -7, "MidQ": 1.5

// WRONG — these are not 0–1; this sets ~4 kHz to a near-zero gain reading
"MidFreq": 0.5, "MidGain": 0.3
```

```jsonc
// CORRECT — amp drive is normalized
"Drive": 0.62, "Mid": 0.55

// WRONG — amp knobs are not 0–10 or dB
"Drive": 6.2, "Mid": 5
```

## When unsure

1. Find the same model in a real preset and read the parameter's value.
2. If the value is between 0 and 1 and the knob has no obvious unit (gain, tone, depth, mix), treat it as normalized.
3. If the value is a large number, negative, or the param name contains `Freq`/`Cut`/`Threshold`/`Hz`/`Interval`, treat it as a real unit.
4. If still unsure, tell the user the value is uncertain rather than writing a guess.
