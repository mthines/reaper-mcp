---
name: JST Heat
fx_match: ["JST Heat", "VST3: JST Heat (Joey Sturgis Tones)", "VST: JST Heat (Joey Sturgis Tones)"]
category: saturator
style: character
vendor: Joey Sturgis Tones
preference: 80
replaces: []
---

# JST Heat

## What it does

JST Heat is an analog-modeled **3-band multiband saturation / distortion** plugin. A master **Heat** knob drives all bands equally, while each of the three bands (split by two crossovers, X1 and X2) can take **additional per-band drive**, its own **level** (tonestack), and its own saturation **character**. The multiband design is the whole point: you can add grit/aggression to the mids and highs while leaving the low band clean, so it thickens and glues a source without flubbing the sub. Includes pre/post **Tone** shaping, focus **Low/High Cut** filters, a **Thump** low-end enhancer, oversampling, and **Auto** gain compensation for honest level-matched A/B. Character ranges from gentle ("Just A Touch") to destructive ("Drum Power").

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Mode | enum (e.g. Just A Touch … Drum Power) | Master saturation character/voicing |
| Heat | 0–100 | Master drive — saturates all 3 bands equally |
| Band 1/2/3 Gain | +0 to +100 | Per-band added saturation ("per-band Heat"). Band 1 = low, 2 = mid, 3 = high |
| Band 1/2/3 Level | ± dB (0 = unity) | Per-band output level — use as a tonestack |
| X1 / X2 | ~20–20000 Hz | Crossover freqs: low\|mid (X1) and mid\|high (X2) |
| Band 1/2/3 Power / Solo / Mute | on/off | Per-band enable / solo / mute |
| Band 1/2/3 Custom Mode | enum (e.g. Clean Tube) | Per-band character when master Mode = Custom |
| Tone | dark ↔ bright (0 = center) | Tilt shaping; Tone Pre/Post Distortion toggle sets where it sits |
| Low Cut / High Cut | 20–20000 Hz | Focus the effect / sim a cab (High Cut) |
| Thump | on/off | Adds low-end presence |
| Steep | on/off | Steeper filter slopes |
| Auto | on/off | Auto gain compensation (keep ON for fair A/B) |
| Oversampling | 1x/2x/4x… | Anti-aliasing quality |
| Mix | 0–100% | Dry/wet blend (parallel saturation) |
| In / Out | ± dB | Input / output trim |

## Recommended settings

### Metal drum bus — slight aggression / glue (multiband)

The best-practice move: split the bands and drive the mids, spare the lows so the kick sub stays tight.

| Parameter | Value | Why |
|-----------|-------|-----|
| Mode | Just A Touch | Gentle character for bus glue |
| X1 (low\|mid) | ~350 Hz | Keeps kick/sub body in the low band |
| X2 (mid\|high) | ~3000 Hz | Splits attack/bite from cymbal sheen |
| Heat (master) | 10–15 | Slight overall — glues without squashing transients |
| Band 1 Gain (low) | 0 | Leave the sub clean — no flub |
| Band 2 Gain (mid) | 25–35 | Aggressive bite / snare & kick attack |
| Band 3 Gain (high) | ~10 | A little crisp on cymbals/snare top |
| Low Cut | ~50–60 Hz | Keep the deepest sub out of the saturation entirely |
| Mix | 80–100% | Pull back for more parallel/dry transient if needed |
| Auto | On | Honest, level-matched A/B |

Don't overdo it — too much drum-bus saturation clouds transients and makes the kit sound compressed/squashed.

### Room mics — power & ambience

| Parameter | Value | Why |
|-----------|-------|-----|
| Mode | Drum Power | "Level destroyer with a vintage vibe" — exaggerates ambience |
| Heat | higher (to taste) | Room mics can take much more than the bus |
| Mix | blend in parallel | Sit the crushed room under the close mics |

## Presets worth knowing

- **Just A Touch** (mode) — gentlest voicing; good default for bus glue.
- **Drum Power** (mode) — aggressive, vintage; built for drum room mics.
- No need for factory presets — build from the recommended settings above.

## When to prefer this

- When you want **frequency-targeted** saturation — drive mids/highs for aggression while keeping the low end clean. A broadband clipper/saturator (e.g. Free Clip) can't spare the sub the way Heat's multiband split can.
- Drum bus glue/aggression in metal, and crushing room mics for power.
- Any time you'd reach for multiband distortion to add harmonics without muddying lows.

## Learned notes

<!-- Contextualized observations captured while working with this plugin.
     The mixing skills append here automatically per memory-protocol.md. -->

- **reaper-mcp param indices** (VST3, 41 params total): 0 Mode · 1 Heat · 2/3/4 Band 1/2/3 Gain · 5/6/7 Band 1/2/3 Level · 8 X1 · 9 X2 · 10–12 Band Solo · 13–15 Band Mute · 16–18 Band Power · 19 Tone · 20 Low Cut · 21 High Cut · 22 Mix · 23 In · 24 Out · 25 Thump · 26 Steep · 27 Auto · 28 Oversampling · 29 Tone Pre/Post · 30 Output Pre-Mix · 31 Power · 32 Link · 33 Auto Lock · 34/35/36 Band 1/2/3 Custom Mode · 37/38 Bypass · 39 Wet · 40 Delta.
- **Normalized (0–1) scaling, verified by probing:**
  - Heat & per-band Gain: `val = amount / 100` (0.25 → "25.0"; 0.5 → "+50.0").
  - Crossovers X1/X2: roughly **linear** `val = (f − 20) / 20000` → f ≈ 20 + val·20000. Verified 0.0165 → 349.7 Hz, 0.149 → 2997 Hz. (For ~350/3000 Hz use 0.0165 / 0.149.)
  - Level / In / Out: 0.5 = unity (0 dB).
  - Mode "Just A Touch" = 0.2609; per-band Custom Mode "Clean Tube" = 0.4667 (enums — probe for others incl. "Drum Power").
  - Oversampling 0.333 = 2x.
- Auto-gain (idx 27) defaults On — leave it for level-matched A/B.
- Was added to a metal **drum bus** (folder summing Kontakt multi-out + kick/snare/tom/cymbal mics), placed after the bus EQ and before the loudness meter.
