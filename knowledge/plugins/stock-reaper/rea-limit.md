---
name: ReaLimit
fx_match: ["ReaLimit", "VST: ReaLimit", "ReaLimit (Cockos)"]
category: limiter
style: transparent
vendor: Cockos
preference: 38
---

# ReaLimit

## What it does

ReaLimit is REAPER's brickwall limiter. It prevents signal from exceeding a set ceiling, used as the final stage before export to prevent intersample clipping and true peaks exceeding 0 dBFS. It uses lookahead limiting to catch transients before they clip. Clean and transparent — appropriate for protecting individual buses and as a last-resort master limiter when better options are not available. Lacks the loudness maximization algorithms of dedicated mastering limiters like FabFilter Pro-L 2.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Ceiling | -inf to 0 dBFS | Maximum output level — true peak will not exceed this |
| Threshold | -inf to 0 dBFS | Where limiting begins — set equal to ceiling for brickwall |
| Release | 1–2000 ms | How quickly gain recovers after a peak |
| Lookahead | 0–100 ms | How far ahead ReaLimit reads to catch transients |
| Stereo link | checkbox | Link L/R gain reduction so stereo image is maintained |

## Recommended settings

### Track bus protection (prevent clipping on buses)

Prevents a bus from clipping even with extreme processing. A safety net, not a loudness tool.

| Parameter | Value | Why |
|-----------|-------|-----|
| Ceiling | -0.3 dBFS | Slight safety margin for intersample peaks |
| Threshold | -0.3 dBFS | Same as ceiling — brickwall |
| Release | 100–200 ms | Transparent release |
| Lookahead | 5–10 ms | Catch fast transients |
| Stereo link | on | Preserve stereo image |

Target: no more than 1–3 dB of gain reduction on average. If seeing 6+ dB GR, the mix needs adjustment upstream.

### Master bus limiter (for streaming delivery)

For Spotify/YouTube delivery at -14 LUFS integrated, -1 dBTP true peak:

| Parameter | Value | Why |
|-----------|-------|-----|
| Ceiling | -1.0 dBFS | -1 dBTP to account for intersample peaks in MP3/AAC encoding |
| Threshold | -1.0 dBFS | |
| Release | 150–300 ms | Transparent for mastering |
| Lookahead | 10 ms | |
| Stereo link | on | |

Note: ReaLimit is a simple brickwall. For competitive loudness (loudness maximization), FabFilter Pro-L 2 with its ISP-detected true peak and LUFS metering is strongly preferred.

### Live recording safety limiter (insert on input)

| Parameter | Value | Why |
|-----------|-------|-----|
| Ceiling | -3 dBFS | Safety headroom for unexpected peaks |
| Threshold | -6 dBFS | Catch sustained hot recordings |
| Release | 50–100 ms | Fast enough to not affect performance |
| Lookahead | 1–3 ms | Minimal latency |

## Presets worth knowing

No factory presets needed — settings are project-specific.

## When to prefer this

- As a safety net on individual buses when a bus is clipping during a session
- As a final protection pass on tracks before committing recordings
- As a master limiter placeholder when Pro-L 2 is not installed

Prefer FabFilter Pro-L 2 (preference: 92) for mastering. Pro-L 2 offers true peak limiting, LUFS metering, multiple limiting algorithms (Transparent, Punchy, Dynamic), and a much better loudness maximization result. ReaLimit for mixing safety; Pro-L 2 for delivery masters.
