---
name: Rock
id: rock
lufs_target: [-11, -9]
true_peak: -1.0
---

# Rock

Rock mixes are energetic, punchy, and guitar-forward. The mix should feel powerful and direct — tight low end, present midrange (guitars and vocals competing for space), and defined transients. Reverb is used tastefully; the room is felt but not heard. Classic rock leans warmer and more spacious; modern rock is drier and more compressed.

## Characteristics

- **Energy level**: High — punchy transients, forward presentation
- **Frequency balance**: Mid-forward; guitars occupy 200 Hz–5 kHz heavily
- **Transients**: Punchy kick and snare with preserved attack
- **Reverb/space**: Short-to-medium room reverb; plate on snare; vocals get subtle tail
- **Stereo width**: Guitars panned wide; center reserved for kick, snare, bass, vocals
- **Reference artists**: Foo Fighters, AC/DC, Pearl Jam, Nirvana, Rage Against the Machine

## EQ Approach

### Global HPF settings

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Kick drum | 40 Hz | Preserve sub punch |
| Bass guitar | 50–60 Hz | Allow some sub warmth |
| Snare | 100 Hz | |
| Electric guitar | 80–120 Hz | Tighter for rhythm, 80 Hz for lead |
| Acoustic guitar | 100–150 Hz | |
| Vocals | 80–100 Hz | |
| Pads/keys | 80 Hz | |
| Cymbals/overheads | 200–300 Hz | |
| Room mics | 80–200 Hz | |

### Frequency shaping targets

| Frequency Zone | Treatment | Why |
|----------------|-----------|-----|
| Sub 20–60 Hz | Keep kick and bass; HPF everything else | Foundation and punch |
| Bass 60–250 Hz | Warm and present; kick at 60–80 Hz, bass guitar at 80–150 Hz | The engine |
| Low-mids 250–500 Hz | Reduce on guitars and bass (-2 to -4 dB at 300–400 Hz) | Clear the mud zone |
| Mids 500 Hz–2 kHz | Preserve guitar body; compete carefully with vocals | Most congested zone |
| Upper-mids 2–5 kHz | Controlled — 3–4 kHz is the harshness zone; be careful on guitar | Edge and cut |
| Presence 5–8 kHz | Vocals and snare presence; guitar brightness | Definition |
| Air 8–20 kHz | Cymbals, vocal air (+1 to +2 dB shelf on vocals) | Openness |

Guitar-specific: Cut around 250–400 Hz on rhythm guitars to reduce mud. Boost 2–4 kHz gently (+1 to +2 dB) for cut in the mix. Scoop mids (400 Hz – 1 kHz) slightly on high-gain rhythm guitars.

## Compression

| Instrument | Style | Ratio | Attack | Release | GR Target | Notes |
|------------|-------|-------|--------|---------|-----------|-------|
| Kick | VCA/FET | 4:1–6:1 | 2–5 ms | 50–100 ms | 4–6 dB | Fast, punchy |
| Snare | FET | 4:1–8:1 | 3–8 ms | 50–100 ms | 4–6 dB | Let crack through |
| Overheads | Opto | 2:1–3:1 | 20–40 ms | 100–200 ms | 2–4 dB | Gentle control |
| Drum bus | VCA | 4:1 | 10–20 ms | 50–100 ms | 3–6 dB | Glue drums together |
| Bass | VCA | 4:1–6:1 | 5–15 ms | 50–150 ms | 3–5 dB | Consistent output |
| Rhythm guitars | VCA | 3:1 | 15–25 ms | 50–200 ms | 2–4 dB | Even out picking |
| Lead vocals | FET then Opto | 4:1 + 4:1 | 10 ms + slow | 50 ms + auto | 4–6 + 2–3 dB | Two-stage vocal control |
| Mix bus | VCA | 2:1–4:1 | 10–30 ms | Auto | 1–3 dB | Glue and density |

Parallel drum compression is heavily used in rock. Blend 40–60% crushed signal for impact without losing punch.

## Stereo Width

- **Bass (below 100 Hz)**: Mono always — sum to mono below 100 Hz
- **Kick**: Center
- **Snare**: Center
- **Overheads**: Wide (±80–100%) — cymbals and room information
- **Rhythm guitars**: Hard pan ±70–100% — left and right filling the stereo field
- **Lead guitar**: Slightly off center (±20–40%) or doubled hard panned
- **Bass guitar**: Center
- **Lead vocals**: Center
- **BG vocals**: Panned pairs (±30–60%) around lead vocal
- **Keys/pads**: Spread wide in stereo to fill behind guitars
- **Reverb returns**: Very wide — create the sense of space

## Common FX Chains

### Lead vocals

1. EQ (Pro-Q 3 or ReaEQ) — HPF 80–100 Hz, -2 dB at 300 Hz, dynamic cut at 8 kHz for sibilance
2. FET compressor (Pro-C 2 FET or JS 1175) — 4:1, 10 ms attack, 50 ms release, 4–6 dB GR
3. Opto compressor (Pro-C 2 Opto) — 4:1, slow attack, auto release, 2–3 dB GR
4. EQ (subtle) — +1 to +2 dB shelf at 10 kHz for air
5. De-esser — 6–9 kHz, gentle threshold
6. Reverb send — short room (1.0–1.5s RT60) or plate, pre-delay 20–30 ms
7. Delay send — 1/4 note, -60 ms decay, filtered (LPF 6 kHz, HPF 200 Hz)

### Drums

- Kick: Channel EQ (punch at 60 Hz, reduce 300 Hz, click at 3–5 kHz), gate, VCA comp 4:1
- Snare top: EQ (HPF 100 Hz, crack at 200 Hz, presence at 5 kHz), FET comp 6:1
- Snare bottom: Phase flip, blend with top for snare rattle
- Overheads: Gentle high shelf boost (+1–2 dB at 10 kHz), Opto comp 2:1
- Room mics: HPF 100–200 Hz, slow comp 4:1, blend for ambience
- Drum bus: VCA comp 4:1, 10 ms attack, 50–100 ms release, 3–5 dB GR, HPF sidechain 80 Hz
- Parallel bus: FET/hard comp 20:1, crush 10–15 dB, blend 40–50%

### Electric guitar

1. Amp sim (if DI) or direct into chain (if already amped)
2. EQ — HPF 80–120 Hz, cut 250–400 Hz (-2 to -3 dB), boost 2–4 kHz (+1–2 dB)
3. Light compressor — 3:1, 15–25 ms attack, 100–200 ms release, 2–3 dB GR (evening out, not squashing)

## What to Avoid

- Too much reverb on drums — rock drums are close and punchy, not washy
- Muddy guitars (200–400 Hz buildup from multiple guitars stacking)
- Harsh upper mids on guitars without presence cutting through (different from harshness — presence is 5–8 kHz, harshness is 2–5 kHz)
- Bass guitar fighting kick below 100 Hz — one should own each sub zone
- Over-compressing the drum bus (crest factor below 8 dB means the punch is gone)
- Narrow stereo image — rock guitars need to fill the sides
- Vocals too wet (reverb tail over 1.5s makes rock feel soft and unclear)
- Lack of parallel compression on drums (rock punch largely comes from this technique)
