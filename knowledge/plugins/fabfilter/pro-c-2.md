---
name: FabFilter Pro-C 2
fx_match: ["Pro-C2", "Pro-C 2", "VST3: Pro-C2 (FabFilter)", "VST: Pro-C2 (FabFilter)", "FabFilter Pro-C 2"]
category: compressor
style: transparent
vendor: FabFilter
preference: 85
replaces: ["rea-comp"]
---

# FabFilter Pro-C 2

## What it does

FabFilter Pro-C 2 is a professional compressor with six compression styles that model different hardware character: Clean (transparent), Classic (vintage VCA), Opto (optical/program-dependent), FET (fast, aggressive, 1176-style), Variable-Mu (tube, warm, slow), and Bus (VCA bus glue). Each mode changes the character, knee behavior, and program dependency. It has excellent visualization (gain reduction over time, input/output spectrum), sidechain EQ, lookahead, and auto gain. The go-to compressor for mixing and mastering when available.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Threshold | -60 to 0 dB | Level at which compression begins |
| Ratio | 1:1 to Inf:1 | Compression strength |
| Attack | 0.01–2000 ms | Time to reach full compression |
| Release | 1–5000 ms / Auto | Recovery time — Auto = program-dependent |
| Knee | 0.1–40 dB | Soft vs hard knee — higher = smoother onset |
| Hold | 0–500 ms | Minimum gate-open time |
| Makeup | -30 to +30 dB | Output makeup gain |
| Mix | 0–100% | Parallel compression blend |
| Style | Clean/Classic/Opto/FET/Variable-Mu/Bus | Character model |
| Auto Gain | checkbox | Automatically compensate for threshold/ratio |
| Lookahead | 0–20 ms | Future-looking to catch transients |
| Stereo Link | 0–100% | L/R coupling |
| Sidechain HPF | 10–1000 Hz | Filter on sidechain (prevent bass triggering compression) |
| Sidechain EQ | on/off | Enable sidechain equalization |

## Recommended settings

### Vocals — FET style (punchy, present)

The "1176 in a box" setting. Works for rock, pop, r&b vocals needing character and presence.

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | FET | Fast, aggressive FET character |
| Threshold | Set for 4–6 dB GR | |
| Ratio | 4:1 | Moderate — let dynamics through |
| Attack | 10–15 ms | Let the consonant attack through first |
| Release | 50–80 ms | Fast — snappy vocal compression |
| Knee | 2–4 dB | Slightly soft for transparency at onset |
| Makeup | Match perceived level | |

### Vocals — Opto style (smooth, transparent)

Second vocal compressor in a serial chain after the FET hit. Or primary compressor for smoother genres.

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Opto | Program-dependent, smooth |
| Threshold | Set for 2–4 dB GR | Light touch as second stage |
| Ratio | 3:1 to 4:1 | |
| Attack | 20–40 ms | Slow — follow phrase dynamics |
| Release | Auto | Program-dependent release (key feature of Opto) |
| Knee | 6–10 dB | Soft knee, very transparent |
| Mix | 100% | Full wet |

### Drum bus — Bus style (VCA glue)

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Bus | VCA glue character |
| Threshold | Set for 3–6 dB GR | Hit moderately |
| Ratio | 4:1 | |
| Attack | 10–30 ms | Preserve kick/snare transients |
| Release | Auto or 80–150 ms | |
| Knee | 4–6 dB | |
| Sidechain HPF | 80 Hz | Prevent kick low-end from causing pumping |

### Master bus — Classic style (subtle glue)

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Classic | Vintage VCA — subtly warm |
| Threshold | Set for 1–3 dB GR | Very light |
| Ratio | 2:1 | Gentle |
| Attack | 10–30 ms | |
| Release | Auto | Program-dependent |
| Knee | 6–12 dB | Smooth |
| Mix | 100% | |

### Parallel drums — FET style (crush and blend)

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | FET | Aggressive FET squash |
| Threshold | Set for 15–20 dB GR | Crush the signal |
| Ratio | 20:1 | Near limiting |
| Attack | 0.01–1 ms | Kill all transients |
| Release | 50–100 ms | Some pump |
| Mix | 40–60% | Blend with dry |

## Presets worth knowing

Pro-C 2 ships with a factory preset library. Notable ones:
- **Vocal Medium** — FET style, 4:1, moderate — good starting point
- **Bus Glue** — Bus style, 2:1 — master bus starting point
- **Drum Bus** — Bus style, 4:1 — drum bus with HPF on sidechain

## When to prefer this

- Always prefer over ReaComp or JS 1175 when installed
- When you need program-dependent Opto behavior for smooth vocal leveling
- When you need true VCA bus compression with sidechain HPF
- When you need parallel compression with the Mix knob
- FET mode for everything that needs character and aggression
- Variable-Mu for the warmest, most vintage-sounding compression (pads, full mixes)

This is the go-to compressor in all situations when available.
