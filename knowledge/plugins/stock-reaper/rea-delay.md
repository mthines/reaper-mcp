---
name: ReaDelay
fx_match: ["ReaDelay", "VST: ReaDelay", "ReaDelay (Cockos)"]
category: delay
style: transparent
vendor: Cockos
preference: 38
---

# ReaDelay

## What it does

ReaDelay is REAPER's multi-tap delay with up to 8 independent taps. Each tap can have independent time, level, feedback, panning, and filtering. Supports tempo-sync delay times and both stereo and mid/side processing. It is a clean, transparent delay without tape saturation or modulation by default. Excellent for utility delay tasks — slapback, doubling, echo — but lacks the warmth and character of vintage tape delay emulations.

## Key parameters by name

Each of up to 8 taps has its own parameter set. Tap 1 parameters:

| Parameter | Range | Description |
|-----------|-------|-------------|
| Tap N Enabled | 0 or 1 | Enable this tap |
| Tap N Length | 0.01–4000 ms (or beat divisions) | Delay time |
| Tap N Length mode | ms / beats | Whether to use tempo-sync or absolute time |
| Tap N Volume | -inf to +6 dB | Level of this tap's output |
| Tap N Pan | -100 to +100% | Stereo position of tap |
| Tap N Feedback | 0–100% | How much of the tap feeds back into itself |
| Tap N LPF | 20–20000 Hz | Low-pass filter on the tap |
| Tap N HPF | 20–20000 Hz | High-pass filter on the tap |
| Dry | -inf to 0 dB | Dry signal level |
| Wet | -inf to 0 dB | Wet signal level |

## Recommended settings

### Vocal slapback (rockabilly / country)

Single tap with very short delay to add depth without an audible echo.

| Parameter | Value | Why |
|-----------|-------|-----|
| Tap 1 Length | 60–120 ms | Short enough to sound like "thickening" |
| Tap 1 Volume | -6 to -12 dB | Tap should sit under the dry |
| Tap 1 Feedback | 0% | No repeats, just one echo |
| Tap 1 LPF | 8000 Hz | Soften the echo, sit behind dry |
| Tap 1 HPF | 100 Hz | Keep it from muddying the low end |
| Dry | 0 dB | Full dry level |
| Wet | -6 dB | Subtle echo |

### 1/4 note tempo-sync delay (classic rock/pop)

| Parameter | Value | Why |
|-----------|-------|-----|
| Tap 1 Length mode | beats | Sync to project tempo |
| Tap 1 Length | 1 beat (quarter note) | Classic rhythmic delay |
| Tap 1 Feedback | 30–50% | 3–5 repeats |
| Tap 1 Volume | -6 dB | Prominent but not dominant |
| Tap 1 LPF | 6000 Hz | Darker repeats, more natural |
| Tap 1 HPF | 200 Hz | Keep repeats from muddying bass |

### Ping-pong stereo delay

| Parameter | Value | Why |
|-----------|-------|-----|
| Tap 1 Length | 1 beat | First tap — left |
| Tap 1 Pan | -80% | Hard left |
| Tap 1 Volume | -6 dB | |
| Tap 2 Length | 1.5 beats (dotted quarter) | Second tap — right |
| Tap 2 Pan | +80% | Hard right |
| Tap 2 Volume | -9 dB | Slightly quieter |
| Both taps Feedback | 20–35% | Gentle repeats |
| Both taps LPF | 8000 Hz | Soften |

### Pre-delay for reverb (parallel chain)

Place ReaDelay before reverb to separate dry signal from reverb onset.

| Parameter | Value | Why |
|-----------|-------|-----|
| Tap 1 Length | 15–40 ms | Pre-delay time |
| Tap 1 Feedback | 0% | No repeats |
| Tap 1 Volume | 0 dB | Full level |
| Dry | -inf dB | No dry signal (reverb takes over) |

## Presets worth knowing

No notable factory presets. ReaDelay is flexible enough that custom settings are standard practice.

## When to prefer this

- When no third-party delay is available
- When you need multi-tap delays (up to 8 taps with independent settings)
- When you need clean, uncolored delay without tape saturation
- When you need tempo-sync with custom feedback filtering

For vintage tape echo character, look for Valhalla Delay or similar tape emulations when available.
