---
name: Electronic / EDM
id: electronic
lufs_target: [-10, -6]
true_peak: -0.3
---

# Electronic / EDM

Electronic music mixes prioritize translation across club sound systems — enormous subwoofers, powerful midrange arrays, and loud playback levels. The kick drum and bass line are the foundation of everything. The mix must be simultaneously loud, wide, and dynamically impactful when the drop hits versus the breakdown. Sub frequencies must be precise and mono. The mixdown is often more "mastering-like" since many electronic producers deliver a near-final mix directly.

Subgenres vary widely: house, techno, drum and bass, ambient, synthwave each have their own character. This file covers general EDM/club production principles with subgenre notes where they diverge.

## Characteristics

- **Energy level**: Extremely high at drop; dynamic contrast between breakdown and drop
- **Frequency balance**: Sub-dominant; extended highs; scooped or wide mids depending on subgenre
- **Transients**: Precise kick transients; controlled but impactful
- **Reverb/space**: Creative use of space — large halls in pads, dry on percussion
- **Stereo width**: Extremely wide (synths, pads, FX); mono bass and kick
- **Reference artists**: Martin Garrix, Deadmau5, Skrillex, Eric Prydz, Aphex Twin, Carl Cox

## EQ Approach

### Global HPF settings

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Kick | 30–40 Hz | Let sub through; cut rumble |
| Bass / sub | 20–30 Hz | Sub is the genre — minimal HPF |
| Synth bass | 40–80 Hz | Depends on register |
| Leads / plucks | 80–200 Hz | Depends on register |
| Hi-hats | 500–1000 Hz | Tight and crisp; no low-end |
| Pads | 80–200 Hz | Clear the sub zone |
| Samples/breaks | 80–150 Hz | |
| Vocals (if present) | 80–120 Hz | |

### Frequency shaping targets

| Frequency Zone | Treatment | Why |
|----------------|-----------|-----|
| Sub 20–60 Hz | Precision management — this is the genre foundation | Club subs reproduce this; must be clean and mono |
| Bass 60–250 Hz | Kick punch + bass body; careful spectral balance | Two elements often compete here |
| Low-mids 250–500 Hz | Heavy reduction on pads/synths to make room | Mud-zone management is critical |
| Mids 500 Hz–2 kHz | Synth leads and melodic content; often scooped in techno | Genre-dependent |
| Upper-mids 2–5 kHz | Lead synth presence and attack transients | Pluck and click live here |
| Presence 5–8 kHz | Hi-hat sizzle; synth character | Brightness |
| Air 8–20 kHz | Open high end; cymbals; synth shimmer | Openness and energy |

Sub-bass management: Decide whether kick or bass sub owns 30–60 Hz and carve accordingly. Common approach: kick owns 40–80 Hz peak, sub bass fills 25–50 Hz. Use sidechain compression (kick triggers bass/sub) for the pumping characteristic of house music.

## Compression

| Instrument | Style | Ratio | Attack | Release | GR Target | Notes |
|------------|-------|-------|--------|---------|-----------|-------|
| Kick | FET/Transient shaper | 4:1–8:1 | 0.5–3 ms | 30–80 ms | 4–6 dB | Tight and defined |
| Sub bass | VCA | 4:1 | 5–10 ms | 80–150 ms | 2–4 dB | Even, controlled |
| Sidechain (classic house) | — | 10:1+ | 1 ms | 100–300 ms | 10–20 dB | Kick triggers bass/pad compression for pumping |
| Synth leads | VCA | 3:1 | 5–10 ms | 50–100 ms | 2–4 dB | Consistent output |
| Drums/breaks | Parallel | 20:1 | 0.1–1 ms | 50–150 ms | 15+ dB | Crushed and blended |
| Mix bus | Multiband or VCA | — | — | — | 2–3 dB | Loudness preparation |
| Limiter | Brickwall | — | — | — | -0.3 dBTP | Club delivery |

House/techno pump: The iconic 4-to-the-floor pump is created by kick-triggered sidechain compression on the main bass synth or pad. Set a VCA comp on the bass/pad with the kick as sidechain input. Fast attack (1 ms), release tuned to the groove (usually 100–200 ms — must breathe back up before next kick). 10:1+, 10–15 dB GR. This is not an effect — it is a defining characteristic of house music.

## Stereo Width

- **Sub bass (below 80–100 Hz)**: MONO — absolutely mandatory for club system compatibility
- **Kick**: Mono (center)
- **Claps/snares**: Center, sometimes slight width on room/reverb tail
- **Hi-hats**: Wide (±40–80%); auto-pan or subtle width creates movement
- **Synth leads**: Often mono for punch, stereo for pads
- **Pads**: Extremely wide — this is where the EDM "wall of sound" comes from
- **FX sweeps and risers**: Wide; often with panning automation
- **Reverb/delay returns**: Very wide
- **Vocals**: Center; heavily reverbed/delayed vocals may have wide processing

## Common FX Chains

### 4-to-the-floor kick drum

1. Transient shaper — increase attack for click; reduce sustain for tightness
2. EQ — HPF 30–40 Hz, boost punch 60–80 Hz (+3 dB), cut 200–300 Hz (-3 dB), boost click 3–5 kHz (+2 dB)
3. FET compressor — 6:1, fast attack 1–3 ms, 50–80 ms release, 4–6 dB GR
4. Limiter — prevent kick clipping, -3 dBFS ceiling
5. Stereo: Center / mono

### Sub bass (analog-style)

1. Synth output — sine or triangle wave fundamental
2. EQ — boost at fundamental frequency (+2–3 dB), cut anything above 200 Hz on the pure sub layer
3. Saturation — light distortion adds harmonics; essential for translation on small speakers
4. VCA compressor — 4:1, 5 ms attack, 100 ms release, 2–4 dB GR
5. Sidechain input from kick — pumping characteristic
6. Mono sum below 100 Hz

### House music pad (sidechain pump)

1. EQ — HPF 80–150 Hz, high shelf boost +2 dB at 10 kHz for air
2. Chorus or wide stereo — maximize width
3. VCA compressor with kick sidechain — 10:1, 1 ms attack, 150–200 ms release, 12–15 dB GR
4. Reverb — large hall or plate, 2–4s, high wet mix on the bus

## What to Avoid

- Mono sub frequencies that aren't checked on a mono speaker (club systems sum sub to mono)
- Too much low-mid buildup on pads (250–500 Hz) — creates a muddy, undefined drop
- Under-loudness for the subgenre — EDM can go -8 to -6 LUFS for club delivery
- Missing the sidechain pump characteristic in house/techno — it is expected
- Kick without enough attack click (disappears in a club's sub pressure)
- Over-reverbed high-frequency elements (hats and leads should be present and direct, not washy)
- Not checking on club-style speakers before delivery — small monitors don't show sub behavior
