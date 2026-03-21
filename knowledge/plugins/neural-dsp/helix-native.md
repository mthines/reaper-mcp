---
name: Line 6 Helix Native
fx_match: ["Helix Native", "VST3: Helix Native (Line 6)", "VST: Helix Native (Line 6)", "Line 6 Helix Native"]
category: amp-sim
style: character
vendor: Line 6
preference: 82
---

# Line 6 Helix Native

## What it does

Helix Native is Line 6's flagship guitar and bass amp modeling plugin, the software version of the Helix hardware floor unit. It models over 70 amplifiers, 37 speaker cabinets, 16 microphones, and 100+ effects including drives, modulation, delays, reverbs, and pitch effects. It processes guitar and bass tracks with complete signal chains — drive pedals, preamp, power amp, cabinet, microphone placement, and post-processing effects. It is used on DI-recorded guitar and bass tracks to create a production-ready tone without a physical amp. Cannot be used as a traditional insert EQ/compressor; it is an end-to-end guitar tone processor.

## Key parameters by name

Helix Native has a complex internal signal chain. Parameters are accessed per block in the chain:

| Parameter | Range | Description |
|-----------|-------|-------------|
| Amp Drive | 0–10 | Preamp gain — how hard the amp is being pushed |
| Amp Bass | 0–10 | Low frequency content |
| Amp Mid | 0–10 | Midrange — crucial for tone character |
| Amp Treble | 0–10 | High frequency brightness |
| Amp Presence | 0–10 | Upper midrange and definition |
| Amp Master | 0–10 | Power amp saturation level |
| Cab Model | list | Speaker cabinet model — changes tone dramatically |
| Mic Type | list | Microphone model (SM57 for bright, R121 for warm, etc.) |
| Mic Distance | 0.5–12 inches | Distance from speaker affects proximity effect and frequency response |
| Mic Position | Center to Edge | On-axis = brighter, off-axis = darker, warmer |
| Output Level | -60 to +6 dB | Block output trim |

## Recommended settings

### Clean electric guitar tone (Fender-style)

| Parameter | Value | Why |
|-----------|-------|-----|
| Amp Model | Fender-style (e.g., Litigator, Archetype Cle@n) | Clean headroom |
| Amp Drive | 2–3 | Just at the edge of breakup, or below |
| Amp Bass | 4–5 | Moderate — avoid muddiness |
| Amp Mid | 5–6 | Present and musical |
| Amp Treble | 5–6 | Bright but not harsh |
| Amp Presence | 4–6 | |
| Cab Model | 2x12 or 4x12 Fender-style | |
| Mic Type | SM57 | Industry standard guitar mic |
| Mic Position | Slightly off-center | |

### Crunch / classic rock guitar

| Parameter | Value | Why |
|-----------|-------|-----|
| Amp Model | Marshall-style (e.g., Placater, Revv) | Mid-focused crunch |
| Amp Drive | 5–7 | Saturated but not full gain |
| Amp Bass | 4 | Tight — avoid boomy rock tones |
| Amp Mid | 6–7 | Marshall "vowel" mid character |
| Amp Treble | 5–6 | Bright enough to cut |
| Amp Presence | 5–7 | Clarity and definition |
| Cab Model | 4x12 Marshall-style | |
| Mic Type | SM57 on/off axis blend | |

### High gain metal guitar

| Parameter | Value | Why |
|-----------|-------|-----|
| Amp Model | Mesa/Rectifier-style or Friedman | Full gain, tight |
| Amp Drive | 7–9 | High gain |
| Amp Bass | 3–4 | Tight — high gain bass is easy to overdo |
| Amp Mid | 4–5 | Scooped sound or boosted for modern metal |
| Amp Treble | 5–6 | |
| Amp Presence | 6–8 | Crucial for high gain clarity |
| Cab Model | 4x12 with tight speakers | |
| Post-EQ | HPF at 100 Hz, cut 200–300 Hz | Use ReaEQ or Pro-Q after Helix to further tighten |

### Bass amp simulation

| Parameter | Value | Why |
|-----------|-------|-----|
| Amp Model | Ampeg SVT-style (e.g., Amptweaker, Agua) | Classic bass amp |
| Amp Drive | 3–5 | Mild overdrive for warmth |
| Amp Bass | 6–7 | More bass than guitar settings |
| Amp Mid | 5 | Mid-present |
| Amp Treble | 4–5 | |
| Cab Model | 8x10 or 4x10 bass cabinet | |
| Post HPF | 30–40 Hz | Remove sub rumble after cab sim |

## Presets worth knowing

Helix Native ships with a large factory preset library organized by genre/style:
- Look in the **Snapshots** section for pre-configured full-chain tones
- **Factory Clean** presets — starting points for clean tones across amp styles
- **Factory Dist** presets — various gain levels and amp characters

The agent can load presets via `set_fx_preset` if the user has named presets saved.

## When to prefer this

- When guitar or bass was recorded direct (DI) with no amp — Helix Native is the amp
- When re-amping is needed (changing the tone of a tracked guitar part)
- When the guitarist is using a Helix floor unit live — use Native to match the sound in the box
- For bass simulation on synth-bass or DI bass tracks

Do not use Helix Native for effects-only processing on a non-guitar track — it is designed specifically for guitar/bass signal chains. For guitar tracks already recorded through a real amp, consider whether the tone needs re-processing before adding Helix Native.
