---
name: Learn Plugin
id: learn-plugin
description: Discover an unknown plugin by reading its parameters, researching online, and saving a plugin knowledge record
---

# Learn Plugin

## When to Use

When you encounter an installed FX plugin that has no plugin record and you need to understand what it does, how to use it, and what parameters to set. This workflow turns an unknown plugin into a documented, reusable plugin record in LoreKit.

## Prerequisites

- The plugin must be loaded on a track in the current session (so you can read its parameters)
- You need the track index and FX index of the plugin

## Steps

### Step 1: Read the plugin's parameters

```
tool: get_fx_parameters
params:
  trackIndex: N
  fxIndex: M
```

Examine the parameter list carefully. Parameter names are strong clues:
- **Frequency, Q, Gain, Bandwidth, Slope** → EQ
- **Threshold, Ratio, Attack, Release, Knee, Makeup** → Compressor
- **Ceiling, Lookahead, True Peak** → Limiter
- **Pre-delay, Decay, Damping, Room Size, Diffusion** → Reverb
- **Time, Feedback, Mix, Sync, Ping-pong** → Delay
- **Drive, Saturation, Harmonics, Warmth** → Saturator
- **Range, Hold, Hysteresis** → Gate
- **Frequency, Sensitivity, Reduction** → De-esser
- **Amp Model, Cabinet, Gain** → Amp sim
- **Width, Mid/Side, Rotation** → Stereo imager
- **Pitch, Formant, Speed, Correction** → Pitch correction

Record the full parameter list with names, current values, and ranges.

### Step 2: Check factory presets

```
tool: get_fx_preset_list
params:
  trackIndex: N
  fxIndex: M
```

Preset names often reveal intended use cases and the plugin's character. Look for:
- Category hints (e.g., "Vocal", "Drum Bus", "Mastering")
- Character hints (e.g., "Warm", "Transparent", "Aggressive", "Vintage")
- Genre hints (e.g., "Hip Hop Vocal", "Rock Guitar")

### Step 3: Research the plugin (if still unclear)

If the parameter names and presets don't clearly identify the plugin, do a web search:

```
Search: "{plugin name}" audio plugin parameters guide
```

Look for:
- Official product page (features, description)
- Manual or parameter reference
- Professional reviews describing the plugin's character and best use cases
- Forum discussions about recommended settings

### Step 4: Determine metadata

From what you've learned, decide:

| Field | How to determine |
|-------|-----------------|
| `name` | Full display name as shown in REAPER |
| `fx` patterns (`fx::` tags) | The exact name from REAPER's FX list, plus common variations (VST/VST3/AU) |
| `category` | Primary category from: eq, compressor, limiter, saturator, reverb, delay, gate, de-esser, amp-sim, channel-strip, stereo-imager, multiband, pitch-correction |
| `vendor` | The plugin manufacturer |
| `preference` | 30-50 for free/stock, 55-70 for decent third-party, 70-85 for preferred, 85-95 for industry-standard |
| `style` | transparent, character, vintage, modern, or surgical |
| `replaces` | Stock REAPER plugin IDs this can replace (e.g., "rea-eq", "rea-comp") |

### Step 5: Write the plugin record

Plugin knowledge lives in LoreKit, not in this repo: write one record to scope
`project::reaper-mcp` with key `user::plugins::{vendor-slug}/{plugin-slug}` (the
user's layer — `plugins::…` keys are the read-only built-in layer). The record
shape, the tag list (`plugin-knowledge`, `category::…`, `preference::…`, one
`fx::…` per FX name, …) and the exact `memory.write` call are in
`reference/memory-protocol.md` → "Plugin knowledge". The fields above become the
record's header line and its tags; put the verified parameter map from Step 2
under `## Learned notes`. No expiry.

### Step 6: Verify the plugin record

After writing the record, confirm:
- its `fx::` tags actually match the installed FX name (case-insensitive substring)
- All parameter names are EXACT (copy from `get_fx_parameters` output)
- Category and preference score are appropriate
- Recommended settings include at least one concrete use case

## Tips

- When multiple parameters share a prefix (e.g., "Band 1 Frequency", "Band 2 Frequency"), document the pattern once with "Band N" notation
- Include the normalized value range (0.0-1.0) alongside the human-readable range when the mapping isn't obvious
- If the plugin has multiple modes or routing options, document each mode separately
- For channel-strip plugins with multiple sections (EQ + comp + gate), consider documenting under the most prominent category but mention all capabilities
