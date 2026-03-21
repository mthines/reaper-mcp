---
name: ReaGate
fx_match: ["ReaGate", "VST: ReaGate", "ReaGate (Cockos)"]
category: gate
style: transparent
vendor: Cockos
preference: 40
---

# ReaGate

## What it does

ReaGate is REAPER's noise gate and downward expander. It silences or reduces signal that falls below a threshold, used to eliminate bleed between microphones, remove noise floor during silent passages, and tighten drum recordings. Supports sidechain input (filter another signal to trigger the gate), hysteresis (different open/close thresholds), and range control (how much to attenuate rather than full silence). Fully featured and reliable as a stock gate.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Threshold | -80 to 0 dB | Level below which gating occurs |
| Hysteresis | 0–40 dB | Difference between open (threshold) and close threshold — prevents chattering |
| Attack | 0.1–1000 ms | Time to open the gate after signal exceeds threshold |
| Hold | 0–5000 ms | Minimum time gate stays open after signal drops |
| Release | 1–5000 ms | Time to close the gate after hold expires |
| Range | -inf to 0 dB | How much attenuation when gate is closed — 0 dB = no gating, -inf = full silence |
| Sidechain | checkbox | Use external sidechain signal for triggering |
| Pre-open | 0–10 ms | Lookahead: open gate slightly before threshold crossing to preserve attack |

## Recommended settings

### Snare drum gate (eliminate hat bleed)

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -30 to -40 dB | Just above the noise floor / bleed level |
| Hysteresis | 5–10 dB | Prevent chattering on ghost notes |
| Attack | 0.5–2 ms | Fast enough not to clip the snare crack |
| Hold | 50–100 ms | Keep gate open through the full snare hit |
| Release | 50–150 ms | Smooth closing |
| Range | -inf or -60 dB | Full or near-full silence between hits |

### Kick drum gate (eliminate bleed, tighten tail)

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -40 to -50 dB | Above room bleed, below kick |
| Attack | 0.1–1 ms | Preserve attack |
| Hold | 100–200 ms | Full kick tail |
| Release | 50–100 ms | Natural close |
| Range | -inf dB | Silence between hits |

### Noise gate on recorded guitar (amp hum between notes)

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -50 to -60 dB | Just above amp hum level |
| Hysteresis | 10–15 dB | Prevent chattering as note decays |
| Attack | 1–5 ms | Let pick attack through |
| Hold | 200–500 ms | Keep open through note sustain |
| Release | 100–300 ms | Natural decay feel |
| Range | -60 to -80 dB | Heavy attenuation without full silence (more natural) |

### Vocal gate (studio noise between phrases)

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -50 to -60 dB | Above noise floor, below breath sounds |
| Hysteresis | 8–12 dB | Stable operation |
| Attack | 2–5 ms | Don't clip word starts |
| Hold | 100–300 ms | Stay open through short pauses |
| Release | 100–200 ms | Smooth close |
| Range | -60 dB | Attenuate heavily, not full silence (sounds more natural) |

Note: For vocals, prefer manual editing or volume automation over gating. Gates can cause unnatural artifacts on expressive performances.

### Tom gate using kick sidechain (sidechain gating)

Use the kick sidechain to trigger tom gates during kick hits — keeps toms open in busy sections.

| Parameter | Value | Why |
|-----------|-------|-----|
| Threshold | -35 to -45 dB | Set for the sidechain signal level |
| Sidechain | enabled | Route kick drum to sidechain input |
| Attack | 1–3 ms | |
| Hold | 200–400 ms | Full tom ring |
| Release | 100–200 ms | |

## Presets worth knowing

No notable factory presets. Gate settings are highly recording-dependent.

## When to prefer this

- Eliminating microphone bleed between drum kit mics (snare, toms)
- Removing noise floor hiss/hum from guitar amps between phrases
- Tightening tracks recorded in less-than-ideal acoustic environments
- Use Hysteresis liberally — it prevents the chattering/stuttering that makes gates sound unnatural

Avoid gating on mix bus, master bus, or as a creative effect (use a transient shaper instead for tightening attacks without silencing).
