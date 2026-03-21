---
name: Metal
id: metal
parent: rock
lufs_target: [-11, -8]
true_peak: -1.0
---

# Metal

Metal mixes are aggressive, powerful, and guitar-dominant. Where rock is mid-forward, metal is defined by tight low-end (kick and palm-muted guitars), scooped or presence-heavy guitar midrange, precise and fast drum transients, and a wall-of-sound density achieved through double-tracked guitars. Vocals range from clean (power metal) to screamed/growled (death metal, black metal) and require very different treatment. The mix must be crushingly heavy while remaining clear and articulate — the defining engineering challenge of metal production.

## Characteristics

- **Energy level**: Extremely high; relentless energy
- **Frequency balance**: V-shaped — strong sub/bass, scooped mids (especially on guitars), bright highs
- **Transients**: Very precise; double kick clarity is a defining technical challenge
- **Reverb/space**: Dry and tight; short room verbs; snare may get plate; minimal tails
- **Stereo width**: Guitars hard panned; center reserved for kick, bass, snare, vocals
- **Reference artists**: Metallica, Meshuggah, Periphery, Pantera, Opeth, Lamb of God

## Characteristics vs Rock (parent genre)

Metal extends and intensifies rock conventions:

- Guitar gain is much higher — amp settings differ completely
- Double kick requires dedicated clarity processing absent in rock
- Bass is often tuned lower (drop tunings, 5- or 6-string) — HPF settings change
- Snare and toms are tighter with less sustain/room
- Mix headroom is tighter due to density
- Wall-of-sound from 4+ guitar layers (2 rhythm per side minimum)

## EQ Approach

### Global HPF settings

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Kick | 40–50 Hz | Tight sub; clear attack |
| Bass guitar | 40–60 Hz | Low tunings common; preserve fundamental |
| Snare | 100–150 Hz | Tight crack, no low-end |
| Toms | 60–120 Hz | Depends on tuning and size |
| Cymbals/overheads | 300–500 Hz | Tight — no low-end on overheads |
| Rhythm guitars | 100–150 Hz | The key difference from rock: tighter HPF |
| Lead guitars | 80–120 Hz | |
| Clean vocals | 80–100 Hz | |
| Screamed vocals | 100–150 Hz | More aggressive HPF; growl has mid focus |

### Frequency shaping targets

| Frequency Zone | Treatment | Why |
|----------------|-----------|-----|
| Sub 20–60 Hz | Kick and bass only; aggressive HPF on guitars | Tightness; guitars in sub zone causes mud |
| Bass 60–250 Hz | Kick punch at 60–80 Hz; bass warmth 80–150 Hz; guitars tight at 100–150 Hz | Clarity between elements |
| Low-mids 250–500 Hz | Heavy reduction on guitars (-4 to -8 dB at 300–500 Hz) | The V-scoop — this is how metal guitars get their character |
| Mids 500 Hz–2 kHz | Presence or scoop depending on subgenre; bass guitar fills mids behind guitars | Modern metal: scooped; classic heavy metal: more mid-forward |
| Upper-mids 2–5 kHz | Guitar attack and pick click; kick beater; careful not to be harsh | Definition and articulation |
| Presence 5–8 kHz | Guitar brightness; snare crack | Cut through the density |
| Air 8–20 kHz | Cymbals and vocal air; controlled | Openness without brittleness |

High-gain guitar EQ: The characteristic metal guitar tone is achieved with a significant mid-scoop. Typical approach: HPF at 100–150 Hz, cut 250–500 Hz (-4 to -8 dB), boost or leave 2–5 kHz (+0 to +3 dB), gentle roll-off above 8 kHz. The mid-scoop should be tasteful — too much creates a "baked potato" tone (all sizzle, no body).

Kick/guitar relationship: Tight rhythm guitars and kick must coexist without muddying. Keep kick below 100 Hz defined; HPF guitars aggressively at 100–150 Hz. They should lock together in the rhythm, not compete in the same frequency space.

## Compression

| Instrument | Style | Ratio | Attack | Release | GR Target | Notes |
|------------|-------|-------|--------|---------|-----------|-------|
| Kick | FET/Transient | 4:1–8:1 | 1–3 ms | 30–80 ms | 4–8 dB | Fast; double kick needs clarity |
| Snare | FET | 6:1–10:1 | 2–5 ms | 30–60 ms | 4–8 dB | Snap and crack |
| Overheads | Opto | 2:1–3:1 | 20–40 ms | 100–200 ms | 2–4 dB | |
| Drum bus | VCA | 4:1–6:1 | 5–15 ms | 50–100 ms | 4–8 dB | Heavier than rock |
| Bass guitar | VCA | 4:1–6:1 | 5–10 ms | 50–100 ms | 4–6 dB | Very consistent output |
| Rhythm guitars | VCA | 3:1–4:1 | 10–20 ms | 50–150 ms | 2–4 dB | Even picking dynamics |
| Lead vocals (clean) | FET then Opto | 4:1 + 4:1 | 8–12 ms | 50 ms auto | 5–8 + 2–4 dB | Like rock/pop vocal |
| Screamed vocals | VCA | 4:1–6:1 | 3–5 ms | 30–50 ms | 4–8 dB | Aggressive compression for consistency |
| Mix bus | VCA | 2:1–4:1 | 10–20 ms | auto | 2–4 dB | |

Parallel drums: Even more heavily used than in rock. 50%+ blend of crushed parallel drum signal is common in modern metal.

## Stereo Width

- **Sub bass (below 80–100 Hz)**: Mono
- **Kick**: Center
- **Snare**: Center
- **Overheads**: Wide (±80–100%)
- **Rhythm guitars**: Hard panned ±90–100% — two tracks each side for wall-of-sound
- **Lead guitar**: Slightly center or duplicate hard panned depending on production
- **Bass**: Center
- **Lead vocals**: Center
- **Screamed vocals**: Center (sometimes layered with slight width)
- **BG/harmony vocals**: Panned pairs (±30–70%)

4-guitar wall technique: Record/program 4 rhythm guitar tracks:
- Guitar L1: -100% left
- Guitar L2: -70% left (slightly different take or small delay)
- Guitar R1: +100% right
- Guitar R2: +70% right

This creates a massive stereo wall without anything appearing in the center (leaving space for kick, bass, snare, vocals).

## Common FX Chains

### High-gain rhythm guitar

1. Amp sim or physical amp — high gain, tight bass response
2. Gate (ReaGate) — Threshold -55 dB, fast attack 0.5 ms, hold 100 ms — kill hum between notes
3. EQ — HPF 100–150 Hz, heavy cut 300–500 Hz (-6 to -8 dB), slight boost 2–4 kHz
4. Light compression — 3:1, 15 ms attack, 100 ms release, 2–3 dB GR — even picking
5. Hard pan L or R

### Screamed/death metal vocals

1. HPF 100–150 Hz — remove handling/breath below
2. Multiband dynamics or EQ — control low-mid buildup (200–500 Hz) during intense passages
3. VCA compressor — 5:1, 3–5 ms attack, 30–50 ms release, 5–8 dB GR
4. EQ (presence) — +1 to +2 dB at 2–4 kHz for clarity and articulation
5. Short room or plate reverb — minimal, 0.5–0.8s — adds dimension without washiness

### Double bass kick

1. Trigger or sample replacement for consistency
2. Gate — very tight to separate rapid kick hits
3. EQ — punch at 60 Hz, remove box at 300–400 Hz, click at 3–5 kHz
4. FET compressor — fast attack 1–2 ms, 60 ms release, 6–8 dB GR
5. Parallel compression blend for impact

## What to Avoid

- Guitar mud in the low-mids (250–500 Hz) — this is the #1 metal mixing problem
- Kick drum without clear beater attack (disappears in a dense metal mix)
- Over-reverbing any element — metal should be dry and present
- Thin bass guitar (bass needs to support the guitar foundation, not disappear)
- Under-compressed or inconsistent rhythm guitars (tight picking must be even)
- Missing double kick clarity (each hit must be distinguishable at fast tempos — often needs trigger replacement)
- Harsh, uncontrolled 2–4 kHz on guitars stacked 4+ layers (combinatorial harshness)
