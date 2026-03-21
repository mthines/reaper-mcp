---
name: Orchestral
id: orchestral
lufs_target: [-23, -16]
true_peak: -1.0
---

# Orchestral

Orchestral mixes preserve the dynamic range, spatial depth, and natural acoustic character of a live ensemble performance. The goal is transparency and realism — the mix should sound as though the listener is seated in a concert hall. Heavy processing is the enemy; the instruments should breathe and move. Dynamic range is preserved (often 20+ dB between quietest and loudest passages), which conflicts with streaming normalization and requires careful LUFS management. Used in film scoring, game music, classical recordings, and cinematic trailers.

## Characteristics

- **Energy level**: Extremely dynamic — from ppp to fff, often 20–30 dB range
- **Frequency balance**: Full range, natural; low strings warm, winds present, brass powerful, strings airy
- **Transients**: Preserved and natural — no heavy limiting
- **Reverb/space**: The most important effect — the hall reverb IS the orchestral sound
- **Stereo width**: Wide natural ensemble placement; follow traditional seating arrangement
- **Reference artists**: Hans Zimmer, John Williams, London Symphony Orchestra, Ennio Morricone

## EQ Approach

### Global HPF settings

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Bass strings | 30–40 Hz | Preserve full fundamental of double bass |
| Cello | 60–65 Hz | C2 = 65 Hz — don't cut fundamental |
| Viola | 130 Hz | C3 = 130 Hz |
| Violin | 195 Hz | G3 = 196 Hz |
| French horn | 65 Hz | B1 = 62 Hz range |
| Tuba | 40–50 Hz | |
| Trumpets/Trombones | 80–100 Hz | |
| Woodwinds | 130–200 Hz | |
| Timpani | 40–80 Hz | Low fundamental is part of the sound |
| Harp | 40–50 Hz | |
| Piano | 27 Hz (A0) — minimal HPF | |
| Room mics | 40–60 Hz | |

### Frequency shaping targets

| Frequency Zone | Treatment | Why |
|----------------|-----------|-----|
| Sub 20–60 Hz | Preserve on bass instruments; gentle roll-off elsewhere | Natural bass foundation |
| Bass 60–250 Hz | Warm and full; low strings carry the bottom | The richness of strings |
| Low-mids 250–500 Hz | Often needs slight reduction to control muddiness in dense passages (-1 to -2 dB, subtle) | Clarity in full orchestral tutti |
| Mids 500 Hz–2 kHz | Woodwind and brass body; careful not to thin | Presence of melody instruments |
| Upper-mids 2–5 kHz | Violin and viola attack; can become harsh in full orchestra | Balance brightness |
| Presence 5–8 kHz | String brightness and brass presence | Clarity and air |
| Air 8–20 kHz | String shimmer; cymbal overtones (+1 dB shelf very gently) | Natural air and openness |

Key rule: Minimal EQ. Orchestral instruments are naturally balanced when recorded well. Use EQ only to correct problems, not to shape tone aggressively.

## Compression

Orchestral music uses minimal compression. The dynamic range is musical and intentional.

| Instrument | Style | Ratio | Attack | Release | GR Target | Notes |
|------------|-------|-------|--------|---------|-----------|-------|
| Individual buses | Opto | 1.5:1–2:1 | 50–100 ms | 200–500 ms | 1–2 dB | Only if truly needed |
| Strings bus | Opto | 1.5:1–2:1 | 30–60 ms | 200–400 ms | 0.5–2 dB | Gentle — preserve bow dynamics |
| Brass bus | Opto | 2:1–3:1 | 20–40 ms | 200–400 ms | 1–3 dB | Control the peaks without killing power |
| Master bus | Limiter only | — | — | — | 0.5–1 dB | Just catch peaks; no compression |

Avoid bus compression in orchestral mixing. If a section is too dynamic, automate the send or use clip gain. Compression on orchestral music sounds artificial and kills the life of the performance.

## Stereo Width

Traditional orchestral seating from listener's perspective (follow this arrangement for sample libraries too):

- **Violins (1st)**: Left (±40–60%)
- **Violins (2nd)**: Left-center (±20–40%)
- **Violas**: Center-right (±10–30%)
- **Cellos**: Right-center (±20–40%)
- **Double basses**: Far right (±50–70%) or far right
- **Flutes/Oboes**: Center-left
- **Clarinets**: Center
- **Bassoons**: Center-right
- **French horns**: Right (±40–60%)
- **Trumpets/Trombones**: Center-right (±20–50%)
- **Tuba**: Far right (±60–80%)
- **Timpani**: Center or slightly right
- **Harp**: Far left (±60–80%)
- **Piano**: Left (traditional) or variable
- **Hall reverb**: Wide — the hall wraps the ensemble

## Common FX Chains

### Concert hall reverb (most important effect)

Use a high-quality convolution IR of a concert hall, or a premium algorithmic reverb (Lexicon-style).

- Pre-delay: 20–40 ms (larger hall = more pre-delay)
- RT60: 1.8–2.5s (concert hall range)
- Diffusion: High — the hall should be dense and smooth
- Mix: Depends on perspective — closer mic position = less reverb, back of hall = more

Apply hall reverb as a send/return with individual instrument buses having different send levels to create depth:

| Instrument | Hall Reverb Send Level | Why |
|------------|----------------------|-----|
| Room mics | 0 dB (room mics carry this) | |
| Close mics only | -6 to -12 dB | Add hall to close mics for depth |
| Strings | -6 to -10 dB | |
| Woodwinds | -8 to -12 dB | More recessed in the hall |
| Brass | -10 to -16 dB | Brass projects; needs less reverb send |
| Timpani | -12 to -18 dB | Tight, doesn't wash |

### Strings bus

1. EQ (very gentle) — HPF at instrument fundamental, gentle -1 dB at 400 Hz if muddy
2. Opto compressor — 1.5:1, 40 ms attack, 300 ms release, 0.5–1.5 dB GR only
3. Hall reverb send — moderate level
4. Optional: subtle stereo widener (keep natural)

### Brass bus

1. EQ — HPF 80–100 Hz, gentle -1 to -2 dB cut at 2–4 kHz if harsh in fortissimo
2. Opto compressor — 2:1, 20 ms attack, 200 ms release, 1–3 dB GR
3. Hall reverb send — less than strings; brass projects naturally
4. Saturation — extremely subtle; helps brass harmonics on digital recordings

## What to Avoid

- Heavy compression (crest factor should be 15+ dB on orchestral music)
- Loud LUFS targeting (-23 to -16 LUFS is correct; streaming platforms normalize up, not down)
- Tight, modern reverb on instruments that need hall space
- Hard panning that doesn't match traditional seating arrangement
- Removing the low-frequency weight of bass strings (cellos and basses provide warmth)
- Bright, harsh high-frequency EQ (orchestral highs should be airy and extended, not crisp and modern)
- Mono checking as primary reference — orchestral is inherently spatial and stereo
- Treating orchestral like rock or pop (it has completely different dynamics expectations)
