---
name: Learn Plugin
id: learn-plugin
description: Discover an unknown plugin by reading its parameters, researching online, and creating a knowledge file
---

# Learn Plugin

## When to Use

When you encounter an installed FX plugin that has no knowledge file and you need to understand what it does, how to use it, and what parameters to set. This workflow turns an unknown plugin into a documented, reusable knowledge file.

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
| `fx_match` | The exact name from REAPER's FX list, plus common variations (VST/VST3/AU) |
| `category` | Primary category from: eq, compressor, limiter, saturator, reverb, delay, gate, de-esser, amp-sim, channel-strip, stereo-imager, multiband, pitch-correction |
| `vendor` | The plugin manufacturer |
| `preference` | 30-50 for free/stock, 55-70 for decent third-party, 70-85 for preferred, 85-95 for industry-standard |
| `style` | transparent, character, vintage, modern, or surgical |
| `replaces` | Stock REAPER plugin IDs this can replace (e.g., "rea-eq", "rea-comp") |

### Step 5: Write the knowledge file

Create the file at `knowledge/plugins/{vendor-slug}/{plugin-slug}.md` using the template structure:

```markdown
---
name: {Plugin Name}
fx_match: ["{exact REAPER name}", "{alternate match}"]
category: {category}
style: {style}
vendor: {Vendor Name}
preference: {score}
replaces: [{stock plugins if applicable}]
---

# {Plugin Name}

## What it does

{1-2 paragraphs: purpose, character, primary use cases}

## Key parameters by name

| Parameter | Range | Description |
|-----------|-------|-------------|
| {exact name} | {range} | {description} |

## Recommended settings

### Use case: {instrument or purpose}

| Parameter | Value | Why |
|-----------|-------|-----|
| {name} | {value} | {reason} |

## Presets worth knowing

- **{Preset Name}** — {what it does}

## When to prefer this

- {situations where this plugin is the best choice}
```

### Step 6: Verify the knowledge file

After writing the file, confirm:
- `fx_match` patterns actually match the installed FX name (case-insensitive substring)
- All parameter names are EXACT (copy from `get_fx_parameters` output)
- Category and preference score are appropriate
- Recommended settings include at least one concrete use case

## Tips

- When multiple parameters share a prefix (e.g., "Band 1 Frequency", "Band 2 Frequency"), document the pattern once with "Band N" notation
- Include the normalized value range (0.0-1.0) alongside the human-readable range when the mapping isn't obvious
- If the plugin has multiple modes or routing options, document each mode separately
- For channel-strip plugins with multiple sections (EQ + comp + gate), consider documenting under the most prominent category but mention all capabilities
