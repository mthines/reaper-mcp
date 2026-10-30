---
name: Transient Lighting
id: transient-lighting
description: Find the hits in a song (drums, accents) and turn them into lighting (or any) automation that flashes in time
---

# Transient Lighting

## When to Use

When something should follow the hits of a song:

- "Make the lights flash on the kick and snare"
- "Create lighting automation that matches the transients"
- "Where are the big accents in this song?"
- Video cuts, markers or MIDI triggers synced to drum hits

## Tools

- `detect_transients`: hit times (project seconds), strength 0..1, dominant band
  (low = kick/bass, mid = snare/vocals, high = hats/cymbals), per-band counts, per-section density.
- `create_transient_automation`: the same detection, written as one pulse per hit
  (attack, hold, decay) onto an existing envelope. `dryRun` shows the points first.

## Steps

1. **Find what the audience hears.** Analyze a **track** (`trackIndex`), not the file, whenever the
   song is an item in the project: a live-set reference is often warped onto the click with stretch
   markers and pitched, and a file is read as-is. Seen live: an mp3 with 159 stretch markers read
   2.6% fast, and its hits drifted off the grid by seconds. If the track runs a stem separator
   (e.g. Acon Digital Remix), the full mix is its input: bypass it for one render, then re-enable.
2. **Pick the source per idea.**
   - Drum flashes: the drum stem or drum bus, `bands: ["low","mid"]` (kick + snare), `minStrength`
     0.5, `minGapMs` about one 16th (90 ms at 160 BPM), `holdMs` 20, `decayMs` 150.
   - Big accents: the full mix, `minStrength` 0.8, `minGapMs` 250, `holdMs` 40, `decayMs` 400.
3. **Read the sections before writing.** Use `sectionSeconds` or the project's regions. Sections
   with few hits (a sustained wall-of-sound chorus) look dull as flashes; give those sustained
   brightness on the main light track instead.
4. **Use the project's tempo map as the grid.** The detector's `tempo` is a single autocorrelation
   guess: it is wrong for odd meters (7/4 as 3+4, a 6/8 bridge) and low `confidence` means ignore it.
5. **Write onto a new, muted track.** Copy the rig's MIDI/DMX plugin (e.g. ReaControlMIDI) from an
   existing light track with `copy_fx` so the channel and CC mapping match, `create_track_envelope`
   on its intensity parameter, then `create_transient_automation`. Muted, it never drives the rig
   until the user unmutes it. Set the envelope's default point at 0 s to the base value
   (`edit_envelope_points`), or the lights sit at the plugin's current value before the song starts.

## Checks

- Strong hits of a full mix and a drum stem of the same song should mostly coincide (within 10 ms);
  if they match no better than random times, one source is warped or offset.
- Hits of a song played to a click lock onto its tempo: phase coherence at the project tempo far above
  a random spread. A band's feel shows as a steady per-section offset (verses 15 ms behind the click).
