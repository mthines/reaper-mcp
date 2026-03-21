---
name: Session Preparation
id: session-prep
description: Organize and prepare a REAPER session for mixing — naming, coloring, routing, markers, bus structure
---

# Session Preparation

## When to Use

Before any mixing begins. Session preparation is the organizational groundwork that makes everything downstream faster and less error-prone. A well-prepared session prevents routing mistakes, makes navigation instant, and ensures no tracks are overlooked.

Use this workflow when:
- Opening a new session for the first time before mixing
- A session has grown organically and needs reorganization
- Tracks have generic names like "Audio_001" or "Track 14"
- There is no bus/routing structure in place
- The session has no markers for song sections

## Prerequisites

- REAPER session is open with all recorded tracks
- You have a general idea of the song structure (verse, chorus, bridge, etc.)
- No mixing has been done yet (or you are willing to reorganize before continuing)

## Step-by-Step

### Step 1: Save a safety snapshot

```
tool: snapshot_save
params:
  name: "pre-session-prep"
  description: "State before session organization"
```

### Step 2: Inventory all tracks

```
tool: get_project_info
tool: list_tracks
```

Note: track count, existing names, any folder/bus structure already present, sample rate, tempo.

Identify each track's instrument/source by its name, audio content, or position. If names are unclear, read media items to check source filenames:

```
tool: list_media_items
params:
  trackIndex: [n]
```

### Step 3: Rename tracks with descriptive names

Apply clear, consistent names. Standard naming conventions:

| Category | Examples |
|----------|---------|
| Drums | Kick In, Kick Out, Snare Top, Snare Bot, Hi-Hat, Tom 1, Tom 2, OH L, OH R, Room L, Room R |
| Bass | Bass DI, Bass Amp |
| Guitars | Gtr Rhythm L, Gtr Rhythm R, Gtr Lead, Gtr Clean, Gtr Acoustic |
| Keys | Piano, Organ, Synth Pad, Synth Lead |
| Vocals | Lead Vox, BV 1, BV 2, BV Harmony, Dbl Vox |
| Effects | FX Riser, FX Impact, FX Ambience |

```
tool: set_track_property
params:
  trackIndex: [n]
  property: "name"
  value: "Kick In"
```

### Step 4: Reorder and group tracks

Standard track ordering (top to bottom):
1. **Drums** — Kick, Snare, Toms, Hi-Hat, Overheads, Room
2. **Bass** — DI, Amp
3. **Guitars** — Rhythm (L/R pairs), Lead, Clean, Acoustic
4. **Keys/Synths** — Piano, Organ, Pads, Leads
5. **Vocals** — Lead, Doubles, Backing Vocals, Harmonies
6. **Effects/Samples** — Risers, Impacts, Pads
7. **Buses** — Drum Bus, Instrument Bus, Vocal Bus, Effects Bus
8. **Returns** — Reverb, Delay
9. **Master/Mix Bus** — Always last

### Step 5: Color code by group

Apply consistent colors across the session:

| Group | Suggested Color |
|-------|----------------|
| Drums | Blue |
| Bass | Dark Blue / Navy |
| Guitars | Green |
| Keys/Synths | Purple |
| Vocals | Orange / Yellow |
| Effects/Samples | Pink / Magenta |
| Buses | Gray |
| Returns | Teal |

```
tool: set_track_property
params:
  trackIndex: [n]
  property: "color"
  value: "0,100,200"
```

### Step 6: Set up bus/routing structure

Create submix buses for each instrument group. Typical bus structure:

| Bus | Routes From | Purpose |
|-----|------------|---------|
| Drum Bus | All drum tracks | Group processing, glue compression |
| Bass Bus | Bass DI + Amp | Blend and control |
| Guitar Bus | All guitar tracks | Group EQ, width control |
| Vocal Bus | Lead + BVs | Unified vocal processing |
| Instrument Bus | Guitar Bus + Keys | Non-rhythm instrument group |
| Effects Bus | FX tracks | Level control for effects |
| Reverb Return | Aux send destination | Shared reverb space |
| Delay Return | Aux send destination | Shared delay effects |

Check existing routing first:

```
tool: get_track_routing
params:
  trackIndex: [n]
```

### Step 7: Add markers for song sections

Navigate through the session and identify song sections. Add markers at each section boundary:

```
tool: add_marker
params:
  position: [seconds]
  name: "Intro"
```

Standard section markers:
- Intro
- Verse 1
- Pre-Chorus 1
- Chorus 1
- Verse 2
- Pre-Chorus 2
- Chorus 2
- Bridge
- Chorus 3 / Final Chorus
- Outro

Optionally add regions for each section:

```
tool: add_region
params:
  startPosition: [seconds]
  endPosition: [seconds]
  name: "Chorus 1"
```

### Step 8: Verify session parameters

```
tool: get_project_info
```

Confirm:
- Sample rate is consistent (44.1 kHz, 48 kHz, etc.)
- Tempo is correct
- Time signature is set

### Step 9: Save post-prep snapshot

```
tool: snapshot_save
params:
  name: "post-session-prep"
  description: "Session organized — tracks named, colored, routed, markers placed"
```

## Verification

After completing session preparation:

1. Every track has a descriptive name (no "Audio_001" or "Track 14")
2. Tracks are ordered by instrument group
3. Each group has a consistent color
4. Bus structure is in place (at minimum: drum bus, vocal bus)
5. Song section markers are placed at correct positions
6. All tracks route to appropriate buses (no orphan tracks going directly to master)
7. Session parameters are verified

## Common Pitfalls

- **Renaming without checking content**: Listen or check media items before naming — a track labeled "Guitar" might actually be a synth
- **Over-complex routing**: Start simple. A drum bus, vocal bus, and instrument bus is sufficient for most sessions. Add complexity only when needed.
- **Forgetting returns**: Reverb and delay sends need return tracks routed to the master bus
- **Inconsistent naming**: Pick a convention and stick with it — "Lead Vox" or "Lead Vocal" but not both
- **Not saving a snapshot**: Session prep involves many changes. Save before starting so you can revert if needed.
