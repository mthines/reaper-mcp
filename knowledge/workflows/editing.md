---
name: Editing
id: editing
description: Edit audio items for mix-readiness — crossfades, timing, phase alignment, cleanup
---

# Editing

## When to Use

After session preparation and before gain staging. Editing makes raw recorded performances mix-ready by fixing timing, managing transitions, cleaning up noise, and ensuring phase coherence between related microphones.

Use this workflow when:
- Raw recorded tracks need cleanup before mixing
- There are audible clicks or pops at edit points (missing crossfades)
- Drum timing needs tightening
- Multi-mic recordings have phase issues (kick in/out, snare top/bottom, DI + amp)
- Tracks have noise, bleed, or unwanted sounds between performances
- The arrangement needs structural changes (cut a verse, extend a chorus)

## Prerequisites

- Session preparation is complete (tracks named, organized, routed)
- REAPER session is open with all recorded tracks
- You understand the song structure (markers placed in session prep)
- Transport is functional (can play, stop, navigate)

## Step-by-Step

### Step 1: Save a safety snapshot

```
tool: snapshot_save
params:
  name: "pre-editing"
  description: "State before audio editing"
```

### Step 2: Inventory media items per track

```
tool: list_tracks
```

For each track, get an overview of media items:

```
tool: list_media_items
params:
  trackIndex: [n]
```

Note: item count, positions, lengths, gaps between items, any overlapping items.

### Step 3: Phase check multi-mic recordings

For tracks that share a source (e.g., kick in + kick out, snare top + snare bottom, DI + amp), check phase coherence:

```
tool: read_track_correlation
params:
  trackIndex: [first track]
```

If correlation is negative or very low (< 0.3), the tracks may need phase alignment:

1. Check if polarity flip fixes it:
```
tool: set_track_property
params:
  trackIndex: [n]
  property: "phase"
  value: true
```

2. If polarity flip doesn't help, time-align by nudging the item:
```
tool: get_media_item_properties
params:
  trackIndex: [n]
  itemIndex: 0
```
Then adjust position to align transients:
```
tool: set_media_item_properties
params:
  trackIndex: [n]
  itemIndex: 0
  position: [adjusted seconds]
```

### Step 4: Crossfade management

Check all edit points for smooth transitions. Every splice point needs a crossfade to prevent clicks:

For items that are adjacent or overlapping:
```
tool: get_media_item_properties
params:
  trackIndex: [n]
  itemIndex: [n]
```

Apply short crossfades at edit points:
```
tool: set_media_item_properties
params:
  trackIndex: [n]
  itemIndex: [n]
  fadeInLength: 0.005
  fadeOutLength: 0.005
```

Standard crossfade lengths:
- **Percussive edits** (drums, transients): 2-5 ms
- **Sustained sounds** (vocals, pads): 10-50 ms
- **Comp edit points** (between takes): 20-100 ms

### Step 5: Timing alignment with stretch markers

For performances that drift from the grid, use stretch markers to align without cutting:

```
tool: get_stretch_markers
params:
  trackIndex: [n]
  itemIndex: [n]
```

Add stretch markers at transients that need realignment:
```
tool: add_stretch_marker
params:
  trackIndex: [n]
  itemIndex: [n]
  position: [item-relative seconds — where in the item the marker goes]
  sourcePosition: [where this point maps to in the source audio]
```

Timing alignment priorities:
1. **Kick drum** — the rhythmic anchor, align to grid first
2. **Snare** — lock to grid or slightly behind for groove
3. **Bass** — align note attacks to kick drum hits
4. **Rhythm guitars** — align strums to kick/snare pattern
5. **Vocals** — nudge phrases to sit naturally, don't over-quantize

### Step 6: Head and tail cleanup

Ensure clean silence before the first downbeat and appropriate decay at the end:

Check the first and last items on each track:
```
tool: get_media_item_properties
params:
  trackIndex: [n]
  itemIndex: 0
```

Trim heads (remove pre-roll noise):
```
tool: trim_media_item
params:
  trackIndex: [n]
  itemIndex: 0
  trimStart: [seconds to trim inward]
```

Apply fade-ins to track starts:
```
tool: set_media_item_properties
params:
  trackIndex: [n]
  itemIndex: 0
  fadeInLength: 0.01
```

Apply fade-outs to track ends:
```
tool: set_media_item_properties
params:
  trackIndex: [n]
  itemIndex: [last]
  fadeOutLength: 0.05
```

### Step 7: Arrangement editing (if needed)

If the song structure needs changes (cut a section, extend, rearrange):

Split items at section boundaries:
```
tool: split_media_item
params:
  trackIndex: [n]
  itemIndex: [n]
  position: [seconds — absolute project time]
```

Move sections:
```
tool: move_media_item
params:
  trackIndex: [n]
  itemIndex: [n]
  newPosition: [seconds]
```

Delete unwanted sections:
```
tool: delete_media_item
params:
  trackIndex: [n]
  itemIndex: [n]
```

**Important**: When rearranging, process ALL tracks at each section boundary to keep everything in sync. Do not move items on one track without moving corresponding items on all other tracks.

### Step 8: Strip silence / gap cleanup

For tracks with long silences between performances (e.g., vocal tracks with silence between verses):

Identify items with excessive silence by checking positions and lengths. Items far apart with no content between them are candidates for trimming or splitting.

### Step 9: Save post-editing snapshot

```
tool: snapshot_save
params:
  name: "post-editing"
  description: "Audio editing complete — crossfades, timing, phase, cleanup done"
```

## Verification

After completing audio editing:

1. No clicks or pops at any edit point (all splices have crossfades)
2. Multi-mic recordings are phase-coherent (correlation > 0.5)
3. Timing is tight (kick and bass locked, drums on grid or grooved consistently)
4. Heads and tails are clean (no pre-roll noise, appropriate decays)
5. Song structure is correct (if arrangement was edited)
6. All tracks start and end cleanly

## Common Pitfalls

- **Over-editing timing**: Some genres (jazz, folk, indie) rely on human feel. Don't grid-lock everything — only tighten where timing is distractingly loose
- **Missing crossfades**: Every edit point needs at least a 2 ms crossfade. One missed crossfade = one audible click
- **Phase-flipping without checking**: Flipping polarity helps when signals are ~180 degrees out, but can make things worse if they're only partially misaligned. Always measure correlation before and after
- **Editing tracks independently**: Multi-mic drum recordings must be edited as a group — if you nudge the snare top, the snare bottom and overheads must move with it
- **Destructive arrangement edits**: Always save a snapshot before rearranging sections. One wrong split or delete can be very hard to undo manually
- **Ignoring stretch marker artifacts**: Heavy time-stretching introduces artifacts (metallic sound, pitch warbling). If stretch is more than ~10%, consider re-recording instead
