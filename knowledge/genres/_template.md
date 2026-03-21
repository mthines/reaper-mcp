---
name: Genre Name
id: genre-id
parent: rock # optional: inherits settings from parent genre; override individual fields below
lufs_target: [-13, -10] # [min, max] integrated LUFS range for delivery
true_peak: -1.0 # dBTP ceiling
---

# Genre Name

Brief description of the genre's sonic identity, typical production era/context, and what the mix should feel like to the listener.

## Characteristics

- **Energy level**: High / Mid / Low — how dynamic and aggressive the mix is
- **Frequency balance**: Describe where the weight sits (bass-heavy, mid-forward, bright/airy)
- **Transients**: How punchy vs smooth the drum/instrument attacks are
- **Reverb/space**: Dry and close vs washy and ambient
- **Stereo width**: Mono-compatible or wide stereo image
- **Reference artists**: [Artist 1], [Artist 2], [Artist 3]

## EQ Approach

### Global HPF settings (per instrument type)

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Kick drum | 30–40 Hz | |
| Bass guitar | 40–60 Hz | |
| Snare | 80–100 Hz | |
| Electric guitar | 80–120 Hz | |
| Acoustic guitar | 80–120 Hz | |
| Vocals | 80–100 Hz | |
| Pads/synths | 60–100 Hz | |
| Cymbals | 200–400 Hz | |

### Frequency shaping targets

| Frequency Zone | Treatment | Why |
|----------------|-----------|-----|
| Sub 20–60 Hz | Describe what to do | |
| Bass 60–250 Hz | | |
| Low-mids 250–500 Hz | | |
| Mids 500 Hz–2 kHz | | |
| Upper-mids 2–5 kHz | | |
| Presence 5–8 kHz | | |
| Air 8–20 kHz | | |

## Compression

### Per instrument compression guidelines

| Instrument | Style | Ratio | Attack | Release | GR Target | Notes |
|------------|-------|-------|--------|---------|-----------|-------|
| Kick | VCA/FET | | | | | |
| Snare | FET | | | | | |
| Overheads | Opto | | | | | |
| Drum bus | VCA | | | | | |
| Bass | VCA | | | | | |
| Lead vocals | FET then Opto | | | | | |
| Guitars | VCA | | | | | |
| Mix bus | VCA | | | | | |

## Stereo Width

- **Bass (below 100 Hz)**: Always mono
- **Kick/Snare**: Center or very slight width
- **Guitars**: [Describe panning approach]
- **Vocals**: [Center / slight width / doubled-tracks panning]
- **Synths/pads**: [Describe]
- **Effects returns**: [Width approach]

## Common FX Chains

### Lead vocals

1. [EQ type] — HPF + presence sculpting
2. [Compressor type] — style, ratio, attack, release
3. [Optional second compressor] — for gain riding
4. [De-esser] — frequency, threshold
5. [Reverb type] — send/return configuration, size, pre-delay
6. [Delay type] — timing, feedback

### Drums

1. [Describe per-mic processing]
2. Drum bus: [compressor], settings
3. Parallel compression: [description]

### [Other instrument roles specific to this genre]

## What to Avoid

- List specific processing choices that are wrong for this genre
- Include specific numbers where possible (e.g., "avoid reverb tails longer than 1.2s")
- Include common amateur mistakes specific to this genre

---

<!-- CONTRIBUTING GUIDE

To add a new genre file:
1. Copy this template to knowledge/genres/{genre-id}.md
2. Set parent: to inherit from a parent genre (e.g., metal inherits from rock)
3. Fill all compression tables with specific values, not ranges where possible
4. Reference 3-5 specific album mixes as reference points
5. Be opinionated — vague guidelines are not useful for the agent

-->
