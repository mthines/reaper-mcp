---
title: Genre Recipes — Metalcore, Prog Metal, Pop, Soul, Funk
impact: HIGH
tags:
  - tone
  - genre
  - metalcore
  - prog-metal
  - funk
  - bass
---

# Genre Recipes

Concrete starting points per genre, with the **real chains** found in the user's preset library as references.
Pair with [`chain-design.md`](./chain-design.md) for the why, and [`model-catalog.md`](./model-catalog.md) for exact model IDs/params.
Settings are starting points — dial to the guitar, pickups, and mix.

## Contents

- [How to read a reference chain](#how-to-read-a-reference-chain)
- [Metalcore / progressive metal (guitar)](#metalcore--progressive-metal-guitar)
- [Metal bass](#metal-bass)
- [Pop / soul / funk (guitar)](#pop--soul--funk-guitar)
- [Pop / soul / funk bass](#pop--soul--funk-bass)
- [Reference chains from the library](#reference-chains-from-the-library)

## How to read a reference chain

`block(off)` = present but bypassed (often a snapshot-swappable alternative).
Amp knobs are `0.0–1.0`; freq/dB params are real units. See [`../rules/parameter-encoding.md`](../rules/parameter-encoding.md).

## Metalcore / progressive metal (guitar)

**Chain:** `Gate (in front) → Tubescreamer boost → Amp → Cab/IR → post EQ → [lead: delay/reverb]`

- **Tightening boost:** `HD2_DistScream808` with `Gain ~0.0`, `Level ~0.55`, `Tone` to taste. Clean boost that focuses low end into the amp — not extra gain. (Source: metalcore tone guides.)
- **Amp:** `HD2_AmpPVPanama` (5150/6505 — tight aggressive mids, huge gain) or `HD2_AmpRevvGenRed` (modern djent, use `Aggression`). For extended-range/djent, keep `Drive` moderate (0.5–0.65) — most "gain" is the tight amp + boost, not maxed Drive.
- **Noise gate:** `HD2_GateHardGate` early; for hard palm-mute silence run the input gate **and** a Gate block. `OpenThreshold`/`CloseThreshold` in dB — set just above noise floor.
- **Cab/IR:** `HD2_CabMicIr_4x12CaliV30` (Mesa V30) or a third-party IR. **`LowCut 80`** to clear down-tuned mud, **`HighCut ~4000–8000`** to tame fizz. Dual cab/IR thickens.
- **Post EQ to fight fizz:** `HD2_EQParametric` — narrow cut around 4 kHz (set `MidFreq ≈ 4000`, `MidGain ≈ -7`, tighter `MidQ`); high-pass ~80 Hz. (Source: metalcore EQ guides.)
- **Leads:** add `HD2_DelaySimpleDelay` + a plate/hall reverb, kept **off** on rhythm snapshots and **on** for leads.

## Metal bass

**Chain:** `Comp → parallel [clean low band] + [distorted grit band] → blend → amp → cab/IR → EQ`

- **Grit:** `HD2_DistObsidian7000` (Darkglass B7K) — use **`Blend`** to balance clean punch vs distortion; `Drive` for grind, `Grunt`/`HiMid` to cut through. (Reference: the `Bass 5` preset does `3-Band Comp → Obsidian 7000 → Agua Sledge → IR → Parametric EQ`.)
- Real B7K-style trick: split into a **clean low band** (low-pass ~250–400 Hz, heavily compressed) and a **distorted band** (high-pass, through the grit), then `join` and blend. Compress to hold clarity at high gain. (Source: metal-bass production guides.)
- **Amp:** `HD2_AmpAguaSledge`; **Cab:** `HD2_Cab8x10SVBeast` (SVT 8x10) or a bass IR.
- **Gate BEFORE the distortion.** A distorted bass amplifies the DI's noise floor (finger noise, hiss, hum) in the gaps between notes → bright fizz that reads as "too bright in the quiet parts." Put a `HD2_GateNoiseGate` (or `HD2_GateHardGate`) **early, ahead of the B7K**, threshold just above the DI noise floor (~−50 dB, tune by ear). This fixes between-note brightness far better than EQ. The input block's built-in gate is usually set too low (~−75 dB) to help.
- **Bass IR top end.** Real bass cabs roll off ~4–5 kHz — leave a bass IR `HighCut` wide open (20 kHz) and the distortion fizz screams. Cut to **~4.5–6 kHz**.
- **Emulating a Dingwall (long-scale) from a short-scale bass:** the gap is **low-end tightness + note definition (~1 kHz)**, NOT treble. Tighten the lows (comp + a boom cut ~220–300 Hz), add focused ~1 kHz clarity, and let the B7K (= Darkglass, what Dingwall players run) provide the modern grind. Boosting 1–5 kHz on the DI just sounds harsh, not "Dingwall." Preserve the lowest note's fundamental — e.g. low A = ~27.5 Hz, so HPF no higher than ~26 Hz.

## Pop / soul / funk (guitar)

**Chain:** `Comp → (Wah/Envelope) → clean amp → cab → light mod → spring/plate reverb`

- **Clean foundation:** `HD2_AmpUSDoubleVib` (Fender Twin), `HD2_AmpUSPrincess` (Princeton), or `HD2_AmpJazzRivet120` (JC-120) for glassy/chimey cleans. Keep `Drive` low (edge-of-breakup at most) — overdrive muddies funk's percussive snap.
- **Compression is central to funk:** `HD2_CompressorDeluxeComp` or `HD2_CompressorRedSqueeze`. Start ~8:1 ratio / ~5 dB reduction; faster release lets ghost notes through, attack shapes the pluck. (Source: funk tone guides.)
- **Quack:** envelope filter / auto-wah reacts to picking dynamics. `HD2_WahColorful` (with an expression pedal) or a synth/filter block.
- **Light sparkle drive:** a transparent boost like `HD2_DistMinotaur` (Klon) or `HD2_DistTeemah` (Timmy) at low gain for soul/edge-of-breakup — see the Cory Wong preset.
- **Mod/space:** subtle `HD2_Chorus`; `HD2_ReverbTile`/`HD2_ReverbPlate`/spring, low `Mix`.

## Pop / soul / funk bass

- Warm, round, **lightly driven** (Ampeg Portaflex-style) keeps Motown/slap articulate with subtle thickness; compression smooths dynamics. Fingerstyle = rounder; slap = scoop mids slightly and add a touch of compression + brightness.

## Reference chains from the library

These are the user's actual dialed presets — use them as templates to clone and adapt (clone-then-edit is the safest authoring path; see [`../rules/file-safety.md`](../rules/file-safety.md)).

| Preset | Genre | Chain (in `@position` order) |
| --- | --- | --- |
| `SynSin 5150` | metal (Synyster Gates) | Pitch → DeluxeComp → ScriptPhase(off) → HardGate(off) → HarmTremolo(off) → Klon(off) → TS808(off) → **PVPanama (5150)** → ParamEQ(off) → 1x12 Epicenter + 4x12 CaliV30 → Tilt EQ → LA Comp → DualPitch → DualDelay → DynPlate verb |
| `BULB 1.0` | djent (Bulb/Periphery) | DeluxeComp → SimplePitch(off) → **HorizonDrive** → HardGate → **RevvGenRed** → Dual IR → Vol |
| `Bass 5` | metal bass | 3-Band Comp(off) → **Obsidian 7000** → **Agua Sledge** → IR → Parametric EQ |
| `Cory Wong vulf` | funk | NoiseGate → **RedSqueeze comp** → Klon → HeirApparent drive → **US Double Vib (Twin)** → Vibe(off) → Tile reverb |
| `LUIS MIGUEL POP` | pop | Wah(off) → Vol → DeluxeComp → Synth(off) → Pitch(off) → drives(off) → Chorus → 3-Band EQ → **US Princess** → 3-Band EQ → Hall/Plate reverbs → PingPong delays(off) |
| `Every_HandMade` | clean/lead | Klon → **Archetype Clean** / Archetype Lead(off) → 4x12 CaliV30 → delays → Plateaux verb → ParamEQ → LA Comp |
| `Dragons Breath` | high-gain (parallel) | parallel EQ/comp → **Line6 Epic amp** → Room verb → Graphic EQ → dual 4x12 XXL V30 → preamp/comp split → 8x10 SV Beast → gates |
| `PW Preset` | versatile rig | Wah(off) → drives(off) → Chorus(off) → JazzRivet(off)/**Placater Dirty** → 4x12 XXL V30 → comp(off) → flanger(off) → Vintage Digital delay → Plate verb |

Note how lead/alt blocks sit **bypassed** in the base chain and get switched on per-snapshot — that is the standard Helix workflow (see [`../rules/snapshot-mechanics.md`](../rules/snapshot-mechanics.md)).
