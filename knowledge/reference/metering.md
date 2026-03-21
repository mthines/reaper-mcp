# Metering Reference

Standards, targets, and interpretations for all metering types used in audio production. These are the numbers the agent compares against when analyzing a mix.

## LUFS (Loudness Units relative to Full Scale)

LUFS is the standard loudness measurement for broadcast, streaming, and delivery. Unlike peak meters, LUFS measures perceived loudness weighted by human hearing sensitivity.

### Types of LUFS Measurements

| Measurement | Window | Use Case |
|-------------|--------|----------|
| Momentary LUFS | 400 ms | Instantaneous loudness — how loud right now |
| Short-term LUFS | 3 seconds | Section loudness — how loud this passage |
| Integrated LUFS | Full duration | Overall loudness of the entire program — delivery standard |
| LRA (Loudness Range) | Full duration | Dynamic range expressed in LU — difference between quiet and loud |

The **Integrated LUFS** is the number that streaming platforms normalize to.

### Streaming Platform Targets

| Platform | Integrated LUFS Target | True Peak Ceiling | Notes |
|----------|----------------------|------------------|-------|
| Spotify | -14 LUFS | -1 dBTP | Normalizes louder content to -14; quieter passes through |
| YouTube | -14 LUFS | -1 dBTP | Same normalization as Spotify |
| Apple Music | -16 LUFS | -1 dBTP | More conservative target |
| Tidal | -14 LUFS | -1 dBTP | |
| Amazon Music | -14 LUFS | -2 dBTP | |
| SoundCloud | -14 LUFS (approx) | -1 dBTP | Less strict normalization |
| Deezer | -15 LUFS | -1 dBTP | |
| Pandora | -14 LUFS | -1 dBTP | |
| CD (Red Book) | No standard | 0 dBFS | Pre-streaming; aim for -9 to -6 LUFS for competitive CDs |
| Vinyl | No standard | N/A | Requires specific mastering considerations |
| EBU R128 (broadcast) | -23 LUFS | -1 dBTP | European broadcast standard; very conservative |
| ATSC A/85 (US broadcast) | -24 LUFS | -2 dBTP | US broadcast standard |

### Genre LUFS Targets (beyond platform standards)

Even for streaming platforms, different genres have conventional loudness levels within their norms:

| Genre | Integrated LUFS Range | Notes |
|-------|----------------------|-------|
| Classical/orchestral | -23 to -16 LUFS | Maximum dynamic range; don't over-limit |
| Jazz/acoustic | -18 to -14 LUFS | Preserve natural dynamics |
| Singer-songwriter | -16 to -13 LUFS | Intimate feel |
| Rock | -11 to -9 LUFS | Competitive and energetic |
| Pop | -14 to -10 LUFS | Platform-normalized target |
| Hip-hop | -10 to -7 LUFS | Bass-heavy loudness; check with streaming normalization |
| EDM/electronic | -10 to -6 LUFS | Club context is loud; streaming normalization applies |
| Heavy metal | -11 to -8 LUFS | Very dense mixes |

Note: For streaming, anything louder than -14 LUFS will be turned DOWN by the platform. Delivering at -10 LUFS for Spotify does NOT make your song louder — it gets normalized to -14 anyway. You just lose dynamic range unnecessarily.

### What Streaming Normalization Means for Mixing

- If your integrated LUFS is louder than the platform target: platform turns your song down
- If your integrated LUFS is quieter than the platform target: your song plays at its natural level (not boosted on most platforms)
- **Conclusion**: Hit the target, not louder. Exceeding target costs dynamic range with no benefit.

## True Peak (dBTP)

True peak is not the same as sample peak. When audio is decoded and played back (especially in MP3/AAC encoding), intersample peaks can exceed 0 dBFS even if the original samples never did. True peak meters catch these intersample excursions.

| Target | When to Use |
|--------|-------------|
| -1.0 dBTP | Standard streaming delivery (Spotify, YouTube, Apple Music) |
| -0.3 dBTP | Club/EDM delivery; more headroom used for louder levels |
| -2.0 dBTP | Broadcast (extra margin for encoding artifacts) |
| 0 dBFS (sample peak) | Not sufficient — always use true peak measurement |

Use Pro-L 2's ISP mode or any true peak limiter to ensure compliance. A sample peak of -0.1 dBFS can produce intersample peaks of +0.5 to +1.0 dBTP in some content.

## Peak Level Standards

| Measurement Point | Standard Peak Level | Notes |
|------------------|---------------------|-------|
| Individual track pre-processing | -12 to -6 dBFS peak | Gain staging target for headroom |
| Individual track average (RMS) | -18 dBFS (±3 dB) | Gain staging target |
| Bus (drum, vocal, guitar) output | -10 to -8 dBFS peak | Before mix bus |
| Mix bus pre-limiting | -6 to -3 dBFS peak | Headroom before limiter |
| Mix bus pre-limiting (average) | -18 to -14 dBFS RMS | |
| Final export (peak) | -0.3 to -1.0 dBTP | True peak after limiter |

## Crest Factor (Dynamic Range Health)

Crest factor = peak level - RMS level, measured in dB. A higher crest factor means more dynamic range — the difference between the loudest peaks and the average level.

| Crest Factor | Interpretation | Likely Cause |
|-------------|---------------|-------------|
| 20+ dB | Excellent dynamics | Minimal compression, natural performance |
| 14–20 dB | Good dynamics | Appropriate compression for most genres |
| 10–14 dB | Moderate compression | Rock/pop normal range |
| 8–10 dB | Heavy compression | EDM, hip-hop; approaching limiting territory |
| 6–8 dB | Over-compressed | Mix will sound fatiguing; losing dynamics |
| Below 6 dB | Heavily over-limited | "Loudness war" territory; sounds flat and lifeless |

**How to measure**: Take peak reading minus RMS reading over the same time window.

### Crest Factor Targets by Genre

| Genre | Healthy Crest Factor |
|-------|---------------------|
| Classical/orchestral | 20–30 dB |
| Jazz/acoustic | 14–22 dB |
| Singer-songwriter | 12–18 dB |
| Country | 10–14 dB |
| Rock | 10–14 dB |
| Pop (modern) | 8–12 dB |
| Heavy metal | 8–10 dB |
| Hip-hop | 8–12 dB |
| EDM/club | 6–10 dB |

## Stereo Correlation

Stereo correlation measures the relationship between the left and right channels.

| Correlation Value | Interpretation | Action |
|------------------|---------------|--------|
| +1.0 | Perfectly mono (L and R identical) | No stereo information |
| +0.8 to +1.0 | Mono-compatible stereo | Excellent — sounds good mono and stereo |
| +0.5 to +0.8 | Wide stereo | May have some center cancellation in mono |
| 0 to +0.5 | Very wide | Check mono compatibility — some content may disappear |
| -0.5 to 0 | Out-of-phase stereo | Problem — content cancels in mono sum |
| -1.0 | Fully out of phase | Complete mono cancellation — this is broken |

**Target for music delivery**: Correlation above +0.5, ideally +0.7 or higher. The bass register (below 100 Hz) should always be at +0.99 or higher (near perfect mono).

## RMS Levels (Approximate Mix References)

These are typical readings when the master bus is playing back a well-balanced mix in the chorus:

| Genre | Short-term LUFS (chorus) | Mix Bus RMS |
|-------|-------------------------|------------|
| Classical (tutti) | -18 to -12 LUFS | -20 to -14 dBFS |
| Acoustic ballad | -18 to -14 LUFS | -20 to -16 dBFS |
| Pop (chorus) | -12 to -8 LUFS | -14 to -10 dBFS |
| Rock (chorus) | -10 to -8 LUFS | -12 to -10 dBFS |
| Hip-hop (drop) | -10 to -6 LUFS | -12 to -8 dBFS |
| EDM (drop) | -8 to -4 LUFS | -10 to -6 dBFS |

## Headroom at Each Processing Stage

For a healthy mix signal chain:

| Stage | Headroom Available | Peak Level |
|-------|------------------|-----------|
| Microphone preamp output | 6–12 dB before clip | -12 to -6 dBFS peaks |
| A/D converter input | 6 dB | -6 dBFS peaks maximum |
| Individual track (post-gain stage) | 6–12 dB | -18 dBFS average |
| Compressor input | 6 dB above threshold | Threshold at -18 to -24 dBFS typically |
| Bus input | 6 dB | -12 to -6 dBFS peaks |
| Mix bus pre-limiter | 6–10 dB | -10 to -6 dBFS peaks |
| Limiter output | 1 dBTP headroom | -1.0 dBTP |
| Final export | Compliant with platform | Per platform spec |

## Perceived Loudness vs. Metered Loudness

**Critical concept**: Meters measure electrical/digital signal level, not what the listener actually hears. The human ear is 10-15 dB more sensitive at 2-5 kHz (presence range) than at 100 Hz (bass range). This has direct implications for how you interpret meter readings. See `perceived-loudness.md` for full reference.

### What This Means for Metering

| Scenario | Meter Says | Listener Hears | Correct Action |
|----------|-----------|---------------|----------------|
| Bass and vocal at same RMS | "Equal volume" | Bass is much quieter | Bass should read 3-6 dB hotter on meters |
| Hi-hat and kick at same peak | "Equal transients" | Hi-hat is much louder | Pull hi-hat fader down 3-5 dB |
| "Flat" spectrum on analyzer | "Balanced mix" | Presence-heavy, harsh | A well-balanced mix has a gentle downward slope on the analyzer |
| LUFS matches target | "Correct loudness" | Depends on spectral content | LUFS uses K-weighting which partially compensates, but per-track balance still needs perceptual awareness |

### LUFS and K-Weighting

LUFS measurements already incorporate some psychoacoustic compensation via K-weighting (a +4 dB shelf at ~1.7 kHz + a 100 Hz high-pass). This means LUFS is better than raw RMS for perceived loudness — but it's a broadband measure. It tells you the overall perceived loudness, NOT whether individual instruments within the mix are perceptually balanced against each other. Per-track balance decisions still require perceived loudness awareness.

## Common Metering Mistakes

| Mistake | Correct Practice |
|---------|-----------------|
| Using sample peak as delivery spec | Use true peak (dBTP) measurement |
| Measuring LUFS on 30 seconds for integrated | Integrated LUFS requires full song duration |
| Ignoring correlation meter | Check before delivery; correlations below +0.5 indicate phase issues |
| Setting gain for momentary LUFS | Set gain for integrated LUFS |
| Not accounting for intersample peaks | Always use a true peak limiter (ISP mode) |
| Comparing short-term LUFS between songs | Compare integrated LUFS for an apples-to-apples comparison |
| Ignoring crest factor | A mix with good integrated LUFS but low crest factor is over-compressed |
| Setting all tracks to the same dBFS target | Account for perceived loudness — bass instruments need higher meter readings than presence-range instruments |
| Treating a "flat" spectrum as balanced | The ear amplifies 2-5 kHz naturally; a flat spectrum sounds harsh. Expect a gentle downward slope from low to high |
