---
title: Signal-Chain Design — Order, Gain Staging, Cab/Mic
impact: HIGH
tags:
  - tone
  - signal-chain
  - mixing
  - cab
  - gain-staging
---

# Signal-Chain Design

General, genre-agnostic best practices for ordering blocks and dialing tones.
Genre-specific starting points live in [`genre-recipes.md`](./genre-recipes.md).
Sources are cited inline; tone is craft, so treat these as strong defaults, not laws.

## Contents

- [Canonical chain order](#canonical-chain-order)
- [Why this order](#why-this-order)
- [Pre vs post / effects loop / 4-cable on Helix](#pre-vs-post--effects-loop--4-cable-on-helix)
- [Gain staging](#gain-staging)
- [Cab and mic dialing](#cab-and-mic-dialing)
- [Stereo, parallel, and double-tracking](#stereo-parallel-and-double-tracking)
- [DSP budget per device](#dsp-budget-per-device)

## Canonical chain order

```
Tuner → Wah/Filter → Compressor → Drive/Dist/Fuzz → (Amp → Cab/IR) → EQ → Modulation → Delay → Reverb
```

Noise gate sits **early** (after input, before/around drive); high-gain rigs often run a second gate post-drive.
This mirrors a real, dialed preset — the Cory Wong funk preset chains `Gate → Compressor → Klon → drive → Fender amp → Phaser → Reverb`.
(Sources: BOSS pedal-order guide, Strymon signal-chain guide.)

## Why this order

- **Tuner first** — needs the cleanest unprocessed signal for accurate pitch tracking.
- **Compressor early** — evens dynamics so the drive/amp is hit at a consistent level → tighter, more even distortion.
- **Wah/filter before drive** — shape frequency content before adding gain.
- **Drive before time/mod effects** — distortion amplifies the noise of anything before it. Running delay *into* distortion smears each repeat into mush; chorus before distortion sounds washy. Put modulation/delay/reverb *after* the amp.
- **Delay then reverb last** — time effects want the fully-formed tone; reverb last so the "room" contains the complete signal.
- **EQ placement is a deliberate choice** — pre-amp EQ sculpts what the amp/drive react to (tightening lows into a high-gain amp); post-amp/post-cab EQ shapes the final voice (cutting fizz, carving mud). Both are valid; many presets use both.

## Pre vs post / effects loop / 4-cable on Helix

- Time-based and modulation effects generally sound cleanest **after the preamp** (in an amp's effects loop). Drives, wah, comp go **in front**.
- Helix models this natively: just place blocks before or after the Amp block. No physical loop needed when using the modeled amp+cab.
- When integrating a **real amp** (4-Cable Method), Helix `Send`/`Return` blocks split the chain around the real preamp; Helix has four FX loops. (Source: Line 6 Four Cable Method blog.)

## Gain staging

- Set the **amp first** with cab in place, drives off. Get the core tone before stacking.
- A drive **in front of** a high-gain amp is usually a **tightening boost**, not more gain: set drive `Gain` low, `Level` high. The TS808 (`HD2_DistScream808`) is the classic — `Gain 0`, `Level` high focuses low end. (Source: metalcore tone guides.)
- Watch block `Level` params (in dB on many blocks) to keep unity gain across the chain; a loud EQ or comp `Level` can clip downstream.
- The input has a built-in noise gate (`inputA.noiseGate`) — use it for light hum before reaching for a Gate block.

## Cab and mic dialing

Mic'd-cab params (`HD2_CabMicIr_*`) and their tonal effect:

| Param | Range / unit | Effect |
| --- | --- | --- |
| `Mic` | int index | Mic model. Dynamics (57/421) = aggressive/standard; ribbons = darker/smoother; condensers = detailed/bright. |
| `Position` | center → edge | Toward cone center = brighter/harsher; toward edge = warmer/darker. |
| `Distance` | inches | Closer = more proximity bass + immediacy; farther = more room/air. |
| `Angle` | 0–45° | 0° on-axis = brightest; 45° off-axis = tames fizz. |
| `LowCut` | Hz | High-pass. Clears low-end mud — heavier tones cut higher (80–130 Hz). |
| `HighCut` | Hz | Low-pass. Tames fizz/harshness. High-gain often cuts ~4–8 kHz. |
| `Level` | dB | Block output trim. |

Practical starting cab: dynamic mic, position near cap edge, distance ~2.5", angle 0°, `LowCut 100`, `HighCut 4000` for high-gain; open it up (`HighCut` higher, `LowCut` lower) for clean tones. (Source: community cab-setting threads.)

IR alternative: an `HD2_ImpulseResponse1024` block loads a third-party IR by `Index` (mapped via `irUuidTable`). IRs need the target machine to have the IR imported — see [`preset-format.md`](./preset-format.md#ir-uuid-table).

## Stereo, parallel, and double-tracking

- **Dual cabs / dual IR** (`...Dual`) blend two cabs with `A/B Pan` and a `Delay` for phase/width — a common way to thicken a single tracked tone.
- **Parallel paths** (`split` → blocks on `@path 0`/`1` → `join`) let you blend, e.g., a clean low band and a distorted band (the metal-bass trick) or a dry+wet reverb split.
- Real double-tracking (two performances panned hard L/R) happens in the DAW, not the preset; a stereo preset widens a single take but is not a substitute.

## DSP budget per device

Block count is limited by DSP, not the format:

- **Helix Floor / LT / Rack / Native** — two full DSP paths, ~16+ blocks total (model-dependent). Most generous.
- **HX Stomp / HX Stomp XL** — much smaller budget (Stomp ~8 blocks, XL more). Keep chains lean; drop redundant EQ/mod blocks.
- **HX Effects** — effects only, no amp/cab modeling DSP for full amps.

When targeting HX Stomp, prefer one amp+cab (or IR), one drive, one comp/gate, and one or two time/mod blocks. Warn the user if a generated chain likely exceeds the target's budget.

### DSP is per-PATH, not just per-device — and overflow reports as "Invalid model"

The total budget is split across **two DSP processors**: `dsp0` (Path 1) and `dsp1` (Path 2).
A single path cannot hold an entire rig.
An **amp + dual IR is very DSP-heavy**: that pair plus a comp, drive, and gate already fills `dsp0`.
Treat **~5–6 blocks as the practical ceiling for any path that contains an amp + dual cab/IR**.

**Verified symptom:** when a path exceeds its DSP budget, Helix Native does not say "out of DSP" — it refuses to load the whole preset with a misleading error:

```
HelixCore: Invalid model. [code -1000302]
```

The model ID is valid; the path is full.
**Diagnostic rule:** if *replacing* a block (e.g. an amp swap) loads but *adding* a block throws "Invalid model," it is DSP overflow, not a bad ID — move blocks to the other path, do not hunt for a model typo.
Bisect by generating one preset per added block (each = known-good base + one new block) and loading each.

### The standard split: tone on Path 1, post-FX on Path 2

Do not cram everything onto `dsp0`.
The convention — and the fix when `dsp0` overflows — is:

- **Path 1 (`dsp0`)** — core tone: `comp → drive → gate → amp → cab/IR`.
- **Path 2 (`dsp1`)** — post-FX: `pitch, delay, reverb, modulation, EQ, post-comp`.

In every inspected library preset, delay / reverb / pitch blocks live on `dsp1`, never `dsp0`.
Place time / pitch / modulation effects on Path 2 by default.
See [`preset-format.md`](./preset-format.md#serial-routing-path-1--path-2) for the exact `@output` / `@input` wiring that chains Path 1 into Path 2, and note that snapshot `blocks` and `controllers` must then carry **both** `dsp0` and `dsp1` keys.
