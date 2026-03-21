---
name: Plugin Display Name
fx_match: ["exact name in REAPER FX list", "alternate match string"]
category: eq # eq | compressor | limiter | saturator | reverb | delay | gate | de-esser | amp-sim | channel-strip | analyzer | stereo-imager | multiband | pitch-correction
style: transparent # transparent | character | vintage | modern | surgical  (optional)
vendor: Vendor Name
preference: 70 # 0-100. Stock REAPER: 30-50. Popular third-party: 70-85. Industry standard: 85-95.
replaces: [] # optional: list of stock plugin IDs this replaces, e.g. ["rea-eq"]
---

# Plugin Display Name

## What it does

One paragraph describing the plugin's purpose, character, and primary use cases. Be specific about its sonic character (clean/colored, aggressive/gentle, etc.) and what problems it solves best.

## Key parameters by name

List parameters EXACTLY as they appear in the plugin UI (since these are what the agent sees via `get_fx_parameters`). Use the parameter's actual name, not a description.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Band 1 Frequency | 20–20000 Hz | Center/cutoff frequency for band 1 |
| Band 1 Gain | -24 to +24 dB | Boost or cut amount |
| Band 1 Q | 0.1–40 | Bandwidth — higher Q = narrower band |
| Band 1 Type | Bell/Shelf/HPF/LPF | Filter shape |

## Recommended settings

### Use case 1: [e.g., Vocals]

Specific parameter values for this use case. Be precise.

| Parameter | Value | Why |
|-----------|-------|-----|
| Band 1 Type | HPF | Remove low-frequency rumble |
| Band 1 Frequency | 80–100 Hz | Below fundamental vocal range |
| Band 1 Slope | 24 dB/oct | Clean, steep cut |

### Use case 2: [e.g., Kick drum]

...

## Presets worth knowing

If the plugin ships with notable factory presets that the agent can load via `set_fx_preset`:

- **Preset Name** — What it does, when to use it as a starting point
- **Another Preset** — ...

If no useful presets exist, write: "No notable factory presets. Build from scratch using recommended settings."

## When to prefer this

Bullet list of situations where this plugin is the best choice over alternatives:

- When you need [specific characteristic]...
- On [specific instrument type] because...
- Avoid when you need [different characteristic] — use [alternative] instead

---

<!-- CONTRIBUTING GUIDE

To add a new plugin knowledge file:

1. Copy this template to knowledge/plugins/{vendor-slug}/{plugin-slug}.md
2. Fill in ALL frontmatter fields
3. Set fx_match to the exact string(s) REAPER shows in its FX list
   - Open REAPER > FX Browser > find your plugin > copy the name exactly
   - VST plugins: usually "VST: Plugin Name (Vendor)" or just "Plugin Name"
   - VST3 plugins: usually "VST3: Plugin Name"
   - JS plugins: usually "JS: plugin/name"
4. Set preference score:
   - 30-50: Stock/free plugins you use as fallback only
   - 55-70: Good third-party plugins you like but have alternatives
   - 70-85: Preferred plugins you reach for first
   - 85-95: Industry-standard tools, best in category
5. List recommended settings with EXACT parameter names (copy from REAPER's FX window)
6. Run /learn-plugin in Claude Code for a guided interview instead of writing manually

-->
