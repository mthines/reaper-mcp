# Compression Reference

Specific compression settings per instrument and use case. All values are starting points — adjust by ear after setting. The most important parameter is the GR (gain reduction) target: set threshold to achieve the target GR, don't chase specific threshold numbers.

## How to Read This Table

- **Style**: Type of compressor character to use (FET = fast/aggressive, Opto = slow/smooth, VCA = versatile/accurate, Variable-Mu = warmest/slowest)
- **Ratio**: Higher = more compression per dB above threshold
- **Attack**: Slower attack = more transient preserved; faster = more control
- **Release**: Slower = more "pumping"; faster = more transparent
- **GR Target**: How much gain reduction to aim for at the loudest passages
- **Knee**: Soft (higher dB value) = gradual onset; Hard (0 or low) = abrupt

## Per-Instrument Settings

### Kick Drum

| Use Case | Style | Ratio | Attack | Release | GR Target | Knee |
|----------|-------|-------|--------|---------|-----------|------|
| Standard punch | VCA/FET | 4:1–6:1 | 2–5 ms | 30–80 ms | 4–6 dB | 2–4 dB |
| Tight/click (dance, EDM) | FET | 6:1–10:1 | 0.5–2 ms | 20–50 ms | 6–10 dB | Hard (0 dB) |
| Natural/acoustic | Opto | 3:1 | 10–20 ms | 100–200 ms | 2–4 dB | 6 dB |

Note: If using a transient shaper (e.g., Transient Master), you often don't need a compressor on the kick at all.

### Snare Drum

| Use Case | Style | Ratio | Attack | Release | GR Target | Knee |
|----------|-------|-------|--------|---------|-----------|------|
| Crack and presence | FET | 4:1–8:1 | 3–8 ms | 40–80 ms | 4–6 dB | 2 dB |
| Heavy/aggressive (rock, metal) | FET | 8:1–12:1 | 1–3 ms | 30–50 ms | 6–10 dB | Hard |
| Natural (jazz, acoustic) | Opto | 2:1–3:1 | 15–30 ms | 100–200 ms | 1–3 dB | 6 dB |

### Drum Overheads

| Use Case | Style | Ratio | Attack | Release | GR Target | Knee |
|----------|-------|-------|--------|---------|-----------|------|
| Gentle cymbal control | Opto | 2:1–3:1 | 20–40 ms | 100–300 ms | 2–4 dB | 6 dB |
| Bus glue | VCA | 2:1 | 20–30 ms | 150–300 ms | 1–2 dB | 6–8 dB |

### Drum Bus (full kit)

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Rock/pop glue | VCA | 4:1 | 10–20 ms | 50–150 ms | 3–6 dB | HPF sidechain 80–100 Hz |
| Metal (heavier glue) | VCA | 4:1–6:1 | 5–15 ms | 50–100 ms | 4–8 dB | HPF sidechain 80 Hz |
| Jazz/acoustic (very light) | Opto | 2:1 | 30–60 ms | 200–500 ms | 0.5–2 dB | Near-transparent |

### Parallel Drum Compression ("New York")

| Use Case | Style | Ratio | Attack | Release | GR Target | Blend |
|----------|-------|-------|--------|---------|-----------|-------|
| Rock punch | FET | 20:1–100:1 | 0.1–2 ms | 50–150 ms | 10–20 dB | 30–50% |
| Metal impact | FET | 100:1 (limiting) | 0.1 ms | 80–200 ms | 15–25 dB | 40–60% |
| Pop/modern | VCA | 20:1–40:1 | 1–5 ms | 60–150 ms | 10–15 dB | 20–40% |

### Bass Guitar

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| General (pop/rock) | VCA | 4:1 | 5–20 ms | 50–150 ms | 3–5 dB | Consistent output |
| Aggressive (hip-hop) | VCA | 4:1–6:1 | 3–10 ms | 50–100 ms | 4–6 dB | Even level for 808-style |
| Natural/dynamic (jazz) | Opto | 2:1–3:1 | 20–40 ms | 200–400 ms | 1–3 dB | Preserve dynamics |
| Sidechain from kick | VCA | 4:1–6:1 | 1–5 ms | 80–200 ms | 4–10 dB | Kick triggers, pumping effect |

### Lead Vocals

| Stage | Style | Ratio | Attack | Release | GR Target | Notes |
|-------|-------|-------|--------|---------|-----------|-------|
| First compressor (control) | FET | 4:1 | 10–15 ms | 50–80 ms | 4–8 dB | Character and presence |
| Second compressor (smooth) | Opto | 3:1–4:1 | 30–50 ms | Auto | 2–4 dB | Smoothing and leveling |
| Heavy pop vocal | FET | 4:1–6:1 | 8–12 ms | 40–60 ms | 6–10 dB | Very controlled |
| Transparent leveling | VCA | 2:1–3:1 | 20–40 ms | Auto | 2–4 dB | Classical, jazz, acoustic |

Note: Two-stage compression (FET → Opto) is standard for lead vocals in competitive pop/rock. The total GR across both stages should not exceed 10–12 dB combined.

### Backing/Harmony Vocals

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Blend into mix | Opto | 3:1–4:1 | 20–30 ms | Auto | 3–5 dB | Smooth, sit behind lead |
| Pop BG vocals | VCA | 4:1 | 10–15 ms | 50–80 ms | 3–5 dB | Consistent, present |

### Electric Guitar (rhythm)

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Rock rhythm | VCA | 3:1 | 15–25 ms | 50–200 ms | 2–4 dB | Even picking dynamics |
| Tight/fast riffing | VCA | 4:1 | 10–15 ms | 30–80 ms | 3–5 dB | Metal, punk |
| Cleaner country/pop | VCA | 2:1–3:1 | 20–30 ms | 80–200 ms | 1–3 dB | Preserve dynamics |

### Acoustic Guitar

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Strumming (pop/country) | VCA | 3:1 | 15–30 ms | 80–200 ms | 2–4 dB | Tighten strum velocity |
| Fingerpicking | Opto | 2:1–3:1 | 20–40 ms | 100–300 ms | 1–3 dB | Preserve dynamic touch |
| Hard strumming | VCA | 4:1 | 10–15 ms | 50–100 ms | 3–5 dB | Control peaks |

### Piano

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Pop/rock (control) | VCA | 3:1–4:1 | 10–20 ms | 80–200 ms | 2–4 dB | Even velocity |
| Jazz (transparent) | Opto | 2:1 | 30–60 ms | 200–500 ms | 1–2 dB | Dynamics are musical |
| Film/orchestral | None or minimal | — | — | — | 0.5 dB max | Let dynamics breathe |

### Strings (group/section)

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Film/orchestral | Opto | 1.5:1–2:1 | 30–80 ms | 200–500 ms | 0.5–2 dB | Barely there |
| Rock/pop strings | VCA | 3:1 | 15–25 ms | 100–200 ms | 2–4 dB | Control dynamics for mix |

### Mix Bus

| Use Case | Style | Ratio | Attack | Release | GR Target | Notes |
|----------|-------|-------|--------|---------|-----------|-------|
| Rock/pop glue | VCA | 2:1–4:1 | 10–30 ms | Auto | 1–3 dB | Cohesion only |
| Loud/competitive | VCA | 4:1 | 10–20 ms | Auto | 2–4 dB | More density |
| Orchestral | None or optical | 1.5:1 | 60 ms | 500 ms | 0.5 dB max | Near-transparent |

## Gain Reduction as a Signal

The GR meter tells you what the compressor is doing:

| GR Reading | Interpretation | Action |
|------------|---------------|--------|
| 0 dB | Compressor never triggers | Lower threshold or check signal level |
| 0.5–1 dB | Barely touching — glue only | Good for mix bus |
| 2–4 dB | Moderate control | Good for most uses |
| 4–8 dB | Heavy compression | Intentional character use |
| 8–12 dB | Very heavy | Only for parallel or parallel blend |
| 12+ dB constantly | Over-compressed | Loosen threshold or ratio |

## Attack and Release Intuition

**Attack too fast (below 5 ms on most instruments):**
- Kills transient (punch, click, crack disappears)
- Sounds squashed, lifeless
- Correct: increase attack time

**Attack too slow (above 30–40 ms on many instruments):**
- Transient passes through, then compressor kicks in mid-note
- Can create a "swell" effect (audible gain change after attack)
- For some uses this is intentional (swells on pads, ambient)

**Release too fast:**
- "Breathing" or "pumping" — gain recovery is audible as a breath
- Can be intentional in EDM, hip-hop (pump effect)
- Usually unwanted in pop, rock, classical

**Release too slow:**
- Compressor doesn't recover before next note
- Everything becomes heavily compressed, dynamics disappear
- Especially bad on fast passages (fast hi-hats, fingerpicked guitar)

**Auto release:**
- Program-dependent — release time follows the audio content
- Very musical result for most applications
- Use as the default when in doubt

## Crest Factor Targets (Dynamic Range Health)

Crest factor = peak-to-RMS ratio. Low crest factor = heavy compression or limiting.

| Genre | Healthy Crest Factor | Overly Compressed |
|-------|---------------------|-------------------|
| Classical/orchestral | 20+ dB | Below 15 dB |
| Jazz/acoustic | 14–20 dB | Below 12 dB |
| Rock/pop | 10–14 dB | Below 8 dB |
| EDM/hip-hop | 8–12 dB | Below 6 dB |
| Heavy metal | 8–10 dB | Below 6 dB |
| Club/electronic | 6–10 dB | Below 5 dB |

If the mix bus crest factor falls below 6 dB, dynamics are essentially gone and the mix will feel lifeless and fatiguing.
