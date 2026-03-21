---
name: ReaVerb
fx_match: ["ReaVerb", "VST: ReaVerb", "ReaVerb (Cockos)"]
category: reverb
style: transparent
vendor: Cockos
preference: 32
---

# ReaVerb

## What it does

ReaVerb is REAPER's convolution reverb. It uses impulse responses (IR files) to model real acoustic spaces — rooms, halls, chambers, plates — or hardware reverbs. Sound quality is entirely dependent on the IR library loaded. With high-quality IRs it can sound spectacular; with poor IRs it sounds amateurish. It has no built-in algorithmic reverb engine; it is purely a convolution processor. CPU usage is moderate-to-high compared to algorithmic reverbs.

Key limitation: IRs must be loaded manually, and the agent cannot browse IR files on disk. Use when user has confirmed they have an IR library, or as a fallback knowing the agent will need to ask the user to point it to IR files.

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| Wet | -inf to +6 dB | Level of reverberant signal |
| Dry | -inf to +6 dB | Level of dry signal passing through |
| Pre-delay | 0–500 ms | Delay before reverb onset — creates separation between dry and wet |
| Stretch | 0.1–10x | Time-stretch the IR — longer = longer reverb tail |
| Start | 0–100% | Where in the IR playback begins — trim early reflections |
| Trim | 0–100% | Where in the IR playback ends — shorten tail |
| Loop | checkbox | Loop the IR tail (for very long reverbs) |

Note: ReaVerb's main parameter is the loaded IR file, which cannot be set via `set_fx_parameter`. The agent should ask the user to load an IR or confirm which preset room to use.

## Recommended settings

### Vocal plate reverb (using a plate IR)

| Parameter | Value | Why |
|-----------|-------|-----|
| Pre-delay | 20–30 ms | Separate verb onset from dry signal |
| Stretch | 0.7–0.9x | Slightly shorter than original IR |
| Wet | -12 to -18 dB | Keep reverb in background |
| Dry | 0 dB | Full dry on insert; or run as send/return |

Best practice: Run ReaVerb on a dedicated reverb bus (send/return), not as an insert. Set Dry to -inf on the bus channel.

### Room reverb on drums (short room IR)

| Parameter | Value | Why |
|-----------|-------|-----|
| Pre-delay | 5–15 ms | Tight room feel |
| Stretch | 0.5–0.8x | Short room |
| Trim | 40–60% | Cut the tail for tighter sound |
| Wet | -10 to -14 dB | Present but not washy |

### Hall reverb on strings/pads

| Parameter | Value | Why |
|-----------|-------|-----|
| Pre-delay | 30–50 ms | Large hall separation |
| Stretch | 1.0–1.5x | Full or slightly extended tail |
| Wet | -18 to -24 dB | Subtle ambient bloom |
| Dry | -inf dB | Send/return setup |

## Presets worth knowing

ReaVerb ships with no IR files. The user must provide their own IR library. Common free IR sources:
- Voxengo Impulse Responses (free)
- OpenAIR Acoustic Impulse Response Library (free)
- Samplicity Bricasti M7 IRs (free)

## When to prefer this

- When the user has a high-quality IR library and wants to use specific room sounds
- For convolution-based hardware reverb emulations (EMT 140 plate, Lexicon 480L rooms, etc.)
- When exact acoustic space reproduction is required (post-production, sound design)

Prefer an algorithmic reverb (Valhalla Room, OldSkoolVerb, etc.) when available. Algorithmic reverbs are more flexible for mixing (adjustable size, decay, diffusion) and don't require managing IR files. Only use ReaVerb when convolution character is specifically desired.
