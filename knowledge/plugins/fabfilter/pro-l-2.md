---
name: FabFilter Pro-L 2
fx_match: ["Pro-L2", "Pro-L 2", "VST3: Pro-L2 (FabFilter)", "VST: Pro-L2 (FabFilter)", "FabFilter Pro-L 2"]
category: limiter
style: transparent
vendor: FabFilter
preference: 92
replaces: ["rea-limit"]
---

# FabFilter Pro-L 2

## What it does

FabFilter Pro-L 2 is the industry-standard mastering limiter and loudness maximizer. It provides true peak limiting (ISP — intersample peak detection), integrated LUFS metering, multiple limiting algorithms, automatic gain control for target loudness, and adjustable transient shaping. It is the last plugin in the mastering chain before export. Its combination of ISP-based true peak limiting and loudness display make it essential for modern streaming delivery. Unlike ReaLimit (simple brickwall), Pro-L 2 actively maximizes loudness while preserving dynamics.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Input Gain | -6 to +6 dB | Pre-limiting gain stage |
| Output Level | -inf to 0 dBFS | True peak ceiling — set to -1.0 or -0.3 |
| Transients | 0–100% | Increase to preserve transient punch; reduce for maximized loudness |
| Attack | 0.01–150 ms | How quickly limiting engages — affects transient character |
| Release | 0.01–2000 ms | How quickly gain recovers — program-dependent when in Auto |
| Attack Type | Aggressive / Smooth | Aggressive = more volume, Smooth = more natural dynamics |
| Lookahead | 0–15 ms | Minimum 0.5 ms for ISP detection |
| Style | Transparent/Dynamic/Aggressive/Bus/Allround/Pumping/Mastering | Limiting character |
| LUFS Target | -6 to -24 LUFS | Sets Output Level to hit target integrated loudness |
| Stereo Link | 0–100% | L/R gain reduction coupling |
| ISP | checkbox | True peak detection via intersample peak processing |

## Recommended settings

### Streaming master — Spotify/YouTube (-14 LUFS)

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Transparent or Allround | Clean, natural dynamics |
| Output Level | -1.0 dBFS | -1 dBTP ceiling (streaming requirement) |
| ISP | on | True peak detection |
| LUFS Target | -14 LUFS | Spotify/YouTube integrated target |
| Transients | 40–60% | Preserve some punch |
| Lookahead | 1–4 ms | Adequate catch time |
| GR target | 1–3 dB average | Subtle maximization |

### Streaming master — Apple Music (-16 LUFS)

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Transparent | |
| Output Level | -1.0 dBFS | |
| ISP | on | |
| LUFS Target | -16 LUFS | Apple Music target |
| Transients | 50–70% | More transient preservation at lower targets |

### Club master / EDM (-8 to -6 LUFS, louder)

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Dynamic or Aggressive | More loudness, still coherent |
| Output Level | -0.3 dBFS | -0.3 dBTP for club playback |
| ISP | on | |
| LUFS Target | -8 to -6 LUFS | Competitive club loudness |
| Transients | 20–35% | Sacrifice some transient for loudness |
| Attack | 0.5–2 ms | Fast limiting |
| Lookahead | 2–5 ms | |

### Mix bus protection (not mastering)

Use as a safety net during mixing, not for loudness maximization:

| Parameter | Value | Why |
|-----------|-------|-----|
| Style | Transparent | No character |
| Output Level | -0.3 dBFS | |
| ISP | on | |
| Transients | 80–100% | Maximum transient preservation |
| Input Gain | 0 dB | Don't drive extra gain in |
| GR target | 0.5–1 dB max | True safety net only |

## Presets worth knowing

- **Transparent** — Clean limiting, maximum transient preservation
- **Streaming** — Pre-configured for -14 LUFS, -1 dBTP delivery
- **Mastering Allround** — Balanced loudness and dynamics for general mastering

## When to prefer this

- Always for final master delivery — this is the industry standard mastering limiter
- When LUFS targeting is needed (streaming delivery, broadcast)
- For true peak (-1 dBTP) compliance with ISP enabled
- When the mix needs competitive loudness maximization, not just clipping prevention

ReaLimit is only used when Pro-L 2 is not installed. Pro-L 2 is in a different category — it is a loudness maximization tool, not just a brickwall.
