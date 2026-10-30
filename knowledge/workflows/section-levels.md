---
name: Section Levels
id: section-levels
description: Balance a track per song section with pooled automation items on its Volume envelope
---

# Section Levels

## When to Use

When a track sits right in one part of the song and wrong in another:

- "The vocal is a bit loud in the first verse"
- "The guitars disappear in the chorus"
- "Make the vocal even between verse, chorus and bridge"

## The approach (opinionated)

Section level changes go on the track's **Volume envelope** as **automation items**,
with one **pool per section type**. Every chorus is an instance of the "Chorus" pool,
so changing one chorus changes all of them.

- **Never use item gain or take volume for this.** It changes the signal going into
  the FX chain, so compressors, saturation and amp sims (Helix Native and similar)
  react differently. The envelope acts after the chain, at the fader.
- **Never ride the fader with loose points** for a repeated section. They drift
  apart the moment one copy is edited.
- **A section that happens once** (an intro verse over a thin arrangement, a bridge)
  gets its own pool. Don't bend a shared pool to fit one occurrence.
- **Name the pools after the section**, prefixed with the track role: `Vox Verse`,
  `Vox Chorus`, `Vox C`, `Gtr Chorus`.
- **Pools are project-wide.** When a track is duplicated (for example a new lead
  with a different amp sim), instance the same pools on the new track instead of
  copying the points, so both stay in step.

## Step-by-Step

### Step 1: Save a snapshot and find the sections

```
tool: snapshot_save
params: { name: "before-section-levels", trackIndices: [<track>], fullChunk: true }

tool: list_regions
```

Snapshots store mixer state, not envelopes. `fullChunk: true` keeps the track chunk,
envelopes included, and each tool call is also one undo point (`undo_project`).

### Step 2: Measure each section against the mix

Render the track and the mix bus once each with `analyze_track_offline`, using
`sectionSeconds` (or one call per region). For each section, take the track's
loudness minus the mix's loudness. The constant offset doesn't matter, only how
it moves between sections. A track rendered as a stem excludes its folder's fader,
so compare sections with each other, never the absolute numbers.

Example (lead vocal, vocal minus mix in LU):

| Section | vox − mix |
|---|---|
| Verse 1, first half | −0.9 |
| Verse 1, second half | −3.8 |
| Chorus | −5.0 |
| Verse 2 | −4.3 |
| C | −5.6 |

Read this as: the first half of verse 1 sits about 3–4 LU more forward than the rest,
and C is a touch behind the choruses. Breakdowns that are far lower are usually an
arrangement choice; ask before you level them.

### Step 3: Make sure the Volume envelope exists

```
tool: get_track_envelopes        # look for "Volume"
tool: create_track_envelope
params: { trackIndex: <track>, envelopeName: "Volume" }
```

### Step 4: Create one pool per section type

Insert the first occurrence of each section type with its points. Points are given in
seconds from the item start, and in `db` on volume envelopes.

```
tool: insert_automation_item
params:
  trackIndex: <track>
  envelopeIndex: 0
  position: 120
  length: 32
  name: "Vox Chorus"
  points: '[{"time":0,"db":0.5}]'
```

Note the returned `poolId`. For a one-off section with a ramp back to 0 dB, end the
ramp at the item's length and set `loop: false`:

```
points: '[{"time":0,"db":-2},{"time":32,"db":-2},{"time":33.5,"db":0}]'
```

### Step 5: Instance the pool on every repeat

```
tool: insert_automation_item
params: { trackIndex: <track>, envelopeIndex: 0, position: 204, length: 32, poolId: <Chorus pool> }
```

`pooledWith` in the response counts the other instances of that pool in the project.

### Step 6: Verify, then adjust one pool

```
tool: list_automation_items          # every section covered, the right pool on each
tool: get_envelope_points
params: { trackIndex: <track>, envelopeIndex: 0, automationItemIndex: <i> }
```

Re-measure the same sections. To change all choruses, edit one instance's points with
`edit_envelope_points` and `automationItemIndex`; every instance follows. Keep moves
small (0.5–2 dB) and let the user listen.

## Gotchas

- **Fader-scaled values:** REAPER's Volume envelope stores 716.2 for 0 dB, not 1.0.
  Always pass `db`.
- **Automation items override the underlying envelope** where they sit; between items
  the envelope's own points apply.
- **Looping:** a looped item repeats its pool's points over its length. A flat level
  loops fine; a ramp should use `loop: false`.
- **Points outside an item** are refused, and a point at the item's very end is kept
  1 ms inside it, because REAPER drops pool points past the pool's length.

## Related

- `workflows/vocal-chain.md` — the processing chain the envelope sits after
- `reference/perceived-loudness.md` — why balance is judged in LU, never dBFS
