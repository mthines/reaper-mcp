---
name: Stem Preparation
id: stem-prep
description: Verify bus structure and routing for stem export readiness
---

# Stem Preparation

## When to Use

After mastering is complete and before final delivery. Stem preparation ensures the session's bus structure, routing, and naming conventions are correct so that exported stems will sum to match the full mix exactly.

Use this workflow when:
- The mix is complete and mastered, ready for stem export
- Stems are needed for sync licensing, remix, or immersive audio
- A mastering engineer has requested stems instead of a stereo mix
- The session needs routing verification before export

## Prerequisites

- Mix is complete (all mixing and mastering decisions are finalized)
- Bus structure exists (drum bus, vocal bus, instrument bus, etc.)
- Session is playing back correctly (no muted tracks that should be active)
- Genre and delivery specs are known

## Step-by-Step

### Step 1: Save a safety snapshot

```
tool: snapshot_save
params:
  name: "pre-stem-prep"
  description: "State before stem preparation"
```

### Step 2: Document the current bus structure

```
tool: list_tracks
tool: get_project_info
```

Map out the full routing hierarchy. For each track:

```
tool: get_track_routing
params:
  trackIndex: [n]
```

Identify:
- Which tracks route to which buses
- Which buses route to the master
- Any orphan tracks routing directly to master (should go through a bus)
- Any tracks with sends to multiple destinations

### Step 3: Verify standard stem groups

Typical stem groups for export:

| Stem | Contains | Bus |
|------|----------|-----|
| Drums | Kick, Snare, Toms, OH, Room | Drum Bus |
| Bass | Bass DI, Bass Amp | Bass Bus |
| Guitars | All guitar tracks | Guitar Bus |
| Keys/Synths | Piano, Organ, Pads, Leads | Keys Bus |
| Vocals | Lead, BVs, Harmonies | Vocal Bus |
| Effects | Reverbs, Delays (printed) | Effects Bus |

Verify each group routes correctly:

```
tool: get_track_properties
params:
  trackIndex: [bus track index]
```

### Step 4: Check for routing problems

Common issues to flag:

1. **Orphan tracks**: Source tracks routing directly to master instead of through a bus
2. **Double-routing**: A track routing to both a bus AND the master (will be in the stem AND the full mix twice)
3. **Missing tracks**: Tracks that are muted or have no output
4. **Send-only tracks**: Reverb returns that should be captured in a stem but are going to master instead of a bus
5. **Master bus processing**: Note which FX are on the master bus — stems are typically exported pre-master-bus-processing

For each bus, check that all expected source tracks are present:

```
tool: get_track_routing
params:
  trackIndex: [bus index]
```

### Step 5: Verify naming conventions

Stems need clear, consistent names for delivery. Verify bus names follow a convention:

```
[Song Title]_[Stem Name]_[Bit Depth]-[Sample Rate]
```

Examples:
- `MySong_Drums_24-48.wav`
- `MySong_Vocals_24-48.wav`
- `MySong_Bass_24-48.wav`

Check that bus track names are clean and descriptive:

```
tool: get_track_properties
params:
  trackIndex: [bus index]
```

Rename if needed:
```
tool: set_track_property
params:
  trackIndex: [bus index]
  property: "name"
  value: "Drum Bus"
```

### Step 6: Verify technical specs

```
tool: get_project_info
```

Confirm:
- **Sample rate**: Matches delivery requirements (typically 44.1 kHz or 48 kHz)
- **Bit depth**: 24-bit or 32-bit float for stems
- **All stems have same duration**: Check that all bus tracks span the full song (from before first note to after last decay)

### Step 7: Document the stem map

Create a clear report of:
- Each stem name and what tracks it contains
- Routing chain for each stem
- Any processing on stem buses (baked into the stem)
- Master bus processing that will NOT be in individual stems
- Total stem count
- Technical specs (sample rate, bit depth)

### Step 8: Save post-prep snapshot

```
tool: snapshot_save
params:
  name: "post-stem-prep"
  description: "Stems verified — routing correct, naming consistent, ready for export"
```

## Verification

After completing stem preparation:

1. Every source track routes to exactly one bus (no orphans, no double-routing)
2. All buses route to the master
3. Bus names are clear and follow a consistent convention
4. No tracks are accidentally muted or disabled
5. Stem groups make musical sense (all drums together, all vocals together, etc.)
6. Technical specs are documented (sample rate, bit depth, duration)
7. The user knows which master bus processing will NOT be included in individual stems

## Common Pitfalls

- **Forgetting reverb/delay returns**: Shared effects (reverb bus, delay bus) need to be assigned to a stem or exported as their own stem. If they route to master only, they'll be in the full mix but not in any stem.
- **Double-counting sends**: If a track sends to both a bus and a reverb return, the dry signal is in one stem and the wet signal might be in another. This is usually correct, but document it.
- **Master bus processing**: If the master bus has EQ/compression/limiting, individual stems will sound different than the full mix. This is normal — stems are typically pre-master-bus.
- **Mismatched levels**: All stems should sum to equal the full mix at the master bus. If they don't, there's a routing or level issue.
- **Not checking mute states**: A muted track won't export. Verify all intended tracks are unmuted and active.
