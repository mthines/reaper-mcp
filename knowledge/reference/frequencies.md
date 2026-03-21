# EQ Frequency Reference

A cheat sheet for the agent: what lives where, what to cut, what to boost, and why. All values are starting points — trust measurements over tables.

## Frequency Band Definitions

| Band | Range | Sensory Description | Common Issues |
|------|-------|-------------------|---------------|
| Ultra-sub | 20–40 Hz | Felt in chest; inaudible on most speakers | Rumble, mic handling noise — usually remove |
| Sub | 40–60 Hz | Bass and kick fundamental; club system territory | Too much = boomy; too little = thin |
| Bass | 60–120 Hz | Warmth, punch, weight | Mud if over-accumulated |
| Upper bass | 120–250 Hz | Body of bass instruments; low-end of most other instruments | The "mud zone begins here" |
| Low-mids | 250–500 Hz | MUD ZONE — where amateur mixes go wrong | Cut aggressively on non-bass instruments |
| Mids | 500 Hz–1 kHz | Honk, nasality, the "telephone frequency" | Source of unpleasant boxiness |
| Upper-mids | 1–2 kHz | Presence, forward bite | Nasal buildup on male vocals, guitars |
| Presence | 2–5 kHz | The MOST SENSITIVE zone to human hearing | Harshness lives here — treat with care |
| Upper presence | 5–8 kHz | Sibilance, consonant clarity, definition | Over-boosting causes fatigue |
| Brilliance | 8–12 kHz | Crispness, snap, transient sparkle | Can sound harsh if overdone |
| Air | 12–20 kHz | Shimmer, openness, studio sound | Subtle — ±1–2 dB is audible here |

## High-Pass Filter Reference (Where to HPF each instrument)

| Instrument | Recommended HPF | Slope | Notes |
|------------|----------------|-------|-------|
| Bass guitar | 40–60 Hz | 12–24 dB/oct | Preserve sub-60 Hz warmth |
| Kick drum | 30–50 Hz | 12 dB/oct | Let sub punch through |
| Snare drum | 100–150 Hz | 12–24 dB/oct | |
| Hi-hat | 300–600 Hz | 24 dB/oct | No low-end needed |
| Overhead mics | 200–400 Hz | 12–24 dB/oct | |
| Room mics | 80–200 Hz | 12 dB/oct | Depends on room character |
| Toms | 60–100 Hz | 12 dB/oct | Preserve tom weight |
| Lead vocals | 80–100 Hz | 24 dB/oct | Below chest voice fundamental |
| Backing vocals | 100–150 Hz | 24 dB/oct | Tighter than lead |
| Electric guitar (rhythm) | 80–120 Hz | 24 dB/oct | Higher in metal (100–150 Hz) |
| Electric guitar (lead) | 80–100 Hz | 18–24 dB/oct | |
| Acoustic guitar | 80–120 Hz | 24 dB/oct | |
| Piano | 40–60 Hz | 12 dB/oct | Preserve bass register |
| Organ | 40–80 Hz | 12 dB/oct | |
| Strings (full section) | 40–60 Hz | 12 dB/oct | |
| Synth pads | 80–150 Hz | 18–24 dB/oct | Depends on register |
| Synth lead | 100–200 Hz | 24 dB/oct | |
| 808 bass | 25–40 Hz | 12 dB/oct | Ultra-sub only |
| Reverb return | 100–200 Hz | 24 dB/oct | Prevent verb from muddying bass |
| Delay return | 100–200 Hz | 24 dB/oct | |

## Problem Frequencies by Symptom

| Symptom | Frequency Zone | Action |
|---------|---------------|--------|
| Muddy, undefined | 250–500 Hz | Cut 2–4 dB on ALL competing instruments |
| Boomy bass | 80–120 Hz | Cut on bass/kick; not everything else |
| Boxy, phone-speaker sound | 400–800 Hz | Cut on the culprit instrument |
| Nasal, honky | 800–1200 Hz | Cut on guitars, horns, vocals |
| Harsh on extended listening | 2000–4000 Hz | Gentle cut on master or culprit |
| Sibilant S sounds | 6000–10000 Hz | De-ess; dynamic EQ cut |
| Lack of definition/clarity | 2000–5000 Hz | Gentle boost on lead element |
| Lacks air, sounds closed | 10000–16000 Hz | Gentle high shelf boost |
| Thin, lacks body | 100–250 Hz | Boost on instruments that should have weight |
| Rumble, noise floor | Below 80 Hz | HPF everything except bass instruments |
| No kick punch | 60–80 Hz | Boost on kick EQ |
| Kick disappears in mix | 3000–5000 Hz | Boost beater click on kick |
| Bass disappears on small speakers | 150–300 Hz | Boost harmonics on bass; add saturation |
| Too bright, fatiguing | 8000–12000 Hz | Gentle cut or shelf |
| Lacks excitement | 5000–8000 Hz | Slight boost (presence zone) |

## Instrument Fundamental Frequencies

Knowing the fundamental prevents accidentally HPF-ing the note itself.

| Instrument | Lowest Note | Frequency (Hz) |
|------------|-------------|---------------|
| Bass guitar (standard) | E1 | 41 Hz |
| Bass guitar (drop D) | D1 | 37 Hz |
| Electric guitar | E2 | 82 Hz |
| Acoustic guitar | E2 | 82 Hz |
| Piano | A0 | 27 Hz |
| Male voice (bass) | ~80 Hz | — |
| Male voice (baritone/tenor) | ~100–150 Hz | — |
| Female voice (soprano) | ~200 Hz | — |
| Kick drum (typical) | 60–100 Hz | varies by tuning |
| Snare drum | 200–300 Hz | fundamental varies |
| Bass clarinet | B1 | 58 Hz |
| Cello | C2 | 65 Hz |
| Double bass | E1 | 41 Hz |
| Tuba | B1 | 58 Hz |

## EQ Moves by Instrument (Quick Reference)

### Kick drum

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 30–40 Hz | 24 dB/oct | Remove ultra-sub rumble |
| Boost sub punch | 60–80 Hz | +2 to +4 dB Bell | The kick "thump" |
| Cut boxiness | 300–500 Hz | -2 to -4 dB Bell | Reduce cardboard sound |
| Boost beater click | 3000–5000 Hz | +2 to +4 dB Bell | Punch through mix |

### Snare drum

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 100–150 Hz | 12–24 dB/oct | Remove unnecessary low-end |
| Boost crack | 200–250 Hz | +2 to +3 dB Bell | The "crack" frequency |
| Cut ring (if needed) | 400–600 Hz | -2 to -4 dB narrow Bell | Resonant ring |
| Boost presence | 5000–8000 Hz | +1 to +3 dB Bell | Snap and presence |

### Bass guitar

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 40–60 Hz | 12 dB/oct | Preserve fundamental |
| Boost fundamental | 80–120 Hz | +1 to +3 dB Bell | Warmth and body |
| Cut mud | 250–400 Hz | -2 to -3 dB Bell | Clarity |
| Boost attack | 700–900 Hz | +1 to +2 dB Bell | Pick/pluck definition |
| Boost small-speaker translation | 150–300 Hz | +1 to +2 dB Bell | Heard on earbuds |

### Electric guitar (rhythm, high gain)

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 80–150 Hz | 24 dB/oct | Prevent bass-zone mud |
| Cut mud | 250–500 Hz | -4 to -8 dB Bell | The metal scoop |
| Boost presence | 2000–4000 Hz | +1 to +2 dB Bell | Cut through mix |
| Cut harshness | 3000–5000 Hz | -1 to -2 dB Bell (dynamic) | Control if harsh |

### Acoustic guitar

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 80–120 Hz | 24 dB/oct | Rumble and body resonance |
| Cut mud | 200–400 Hz | -2 to -3 dB Bell | Body mud |
| Boost body | 120–200 Hz | +1 to +2 dB Bell | Warmth if too thin |
| Boost string detail | 5000–8000 Hz | +1 to +2 dB Bell | Pick attack and string noise |

### Lead vocals (female)

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 80–100 Hz | 24 dB/oct | Mic rumble |
| Cut chest resonance | 200–400 Hz | -1 to -3 dB Bell | Proximity effect |
| Boost presence | 2000–4000 Hz | +1 to +2 dB Bell | Vocal clarity |
| Dynamic cut sibilance | 7000–9000 Hz | -3 to -5 dB (dynamic) | Harsh S sounds |
| Boost air | 10000–15000 Hz | +1 to +3 dB Shelf | Breathy, airy quality |

### Lead vocals (male)

| Move | Frequency | Amount | Why |
|------|-----------|--------|-----|
| HPF | 80–100 Hz | 24 dB/oct | Rumble |
| Cut mud | 250–400 Hz | -2 to -4 dB Bell | Boxy proximity |
| Cut honk | 500–800 Hz | -1 to -2 dB Bell | Nasal character |
| Boost presence | 2000–4000 Hz | +1 to +2 dB Bell | Clarity and cut |
| Dynamic cut sibilance | 6000–8000 Hz | -3 to -5 dB (dynamic) | Sibilance control |
| Boost air | 12000–16000 Hz | +1 to +2 dB Shelf | |
