---
name: Vocal Alignment
id: vocal-alignment
description: Tighten doubles, harmonies and backing vocals to a lead by timing, and check the result without listening
---

# Vocal Alignment

## When to Use

- "Tighten the backing vocals to the lead"
- A double, harmony or call-and-response that drifts against the guide
- Any stretch or slow-down of a vocal where you need to know if it still sounds clean

The ear decides in the end. These steps find the problems the agent can measure and say which edits to hand to the user for listening.

## Tools

- `align_audio_to_guide`: hits of a guide item and 1-8 doubles (read from their **source files**), paired in order within `maxShiftMs`, then one stretch marker per hit moves the double onto the guide. `dryRun` shows the move first, `strength` scales it, `protectConsonants` keeps high-band hits rigid. A guide that already has stretch markers is refused. It does not hear take FX: Melodyne and the like are take FX on the item, and the alignment ignores them.
- `verify_edit`: compares the result with the audio from before the edit (a kept copy on an unmuted reference track, or a bounce). Set `timeScale` to the playback rate when the timing changed (1.1 = the edit is 10% shorter) and `expect: "changed"` for a stretch.
- `measure_track_alignment`: delay and polarity between two tracks, with the play offset and phase to set.

## Steps

1. **Keep the originals.** Copy the guide and each double to new tracks (`T ref`, `T edit` are fine as temporary names, delete them when done) and edit the copies. Never touch the user's items or solo state. Tracks created without a master send are silent in playback but still render, so turn the master send on for tracks the user will audition.
2. **Pick the guide.** The louder, tighter take. A quiet backing vocal against a loud lead is a good test: onsets are found per source file, so level does not matter.
3. **Dry run.** `align_audio_to_guide` with `dryRun: true`: read the offset before and after (avg and max ms) per double. Start with `strength` around 0.8 and a `maxShiftMs` under the typical phrase gap; raise it only when hits are missed.
   A dry run that reports `replacedMarkers` above 1 means the double already had stretch markers (an earlier alignment or edit by the user): say so before applying, and keep the original on the copy.
4. **Apply** (same call without `dryRun`), then run **Verify and iterate** below. Do not tell the user the alignment is done before that loop has finished; the align call's own after-offsets are what the tool planned, not what plays.
5. **Listen** before accepting: play the aligned range with the guide. The tool checks for damage, not for taste. Name the spots that are still uncertain.

## Verify and iterate (always, without being asked)

The align call plans from the items' source files. What the user hears is the rendered track, so measure that.

1. **Damage check.** `verify_edit` against the kept copy: `timeScale: 1`, `expect: "changed"`. The `discontinuity` check must be ok (no click or hard splice).
2. **Timing check on the render.** `detect_transients` on the guide track and the double track over the aligned range (`limit` high enough for the range, `minGapMs` 60). Pair hits within about 100 ms, using the strong ones first (strength above about 0.4 on either side, or both). Write down each pair's offset (double minus guide, ms).
3. **Judge.** Most pairs should sit within about ±15 ms (the tool's own after-average is 5-7 ms). Pairs beyond about 20 ms are outliers. List them with time, offset and strength.
4. **Do not use `measure_track_alignment` to judge a lead against a backing.** The two differ in texture (a scream against a sung line was measured at correlation 0.07-0.11, under the 0.3 it needs), so its delay is not to be trusted. Use onset pairing.
5. **Detectors can disagree.** `align_audio_to_guide` reads source files; `detect_transients` on a track reads the render. On low-band hits of a loud lead the two once placed the same hit about 100 ms apart. Before moving a marker for an outlier, check that both sides really have that hit (strength, band, a neighbouring pair that agrees). When the detectors disagree and nothing nearby confirms the outlier, do not move it: hand it to the user's ear.
   A wrong pairing is the usual cause of a real outlier. Look at both source files with `detect_transients` (`path`, `filePosition` = item position minus start offset, `startTime` at or after `filePosition`): a guide hit with a very low `peakDb` (about -40 dB or lower) is a false hit, and the pairing can put the double's real hit on it and shift every hit after it by one (seen: a -53 dB blip took a real hit 80 ms early and stretched the audio after it by 1.4x). The fix is the markers: pin the double's real hit (marker `sourcePosition` = start offset + the hit's item time) on the guide's real hit, and keep the next marker at its natural spacing.
   Two strong hits of the double close together (about 50 ms) against one guide hit are ambiguous (which one is the onset?). Do not guess: report the spot to the user.
6. **Fix and re-measure.** For a confirmed outlier, move that one hit: `get_stretch_markers`, then `edit_stretch_markers` (position in item seconds; all edits are checked against the whole list first). Re-render and repeat from step 2 on the touched range. At most 3 rounds, then stop and report what is left; never loop on an outlier the markers cannot fix (a hit with no partner, a marker that would cross its neighbour).
7. **Report** the before and after (average and worst offset on the render, number of outliers), what was fixed, and what is still loose or unconfirmed, with times. Say plainly which numbers come from onset detection rather than a waveform measurement.

## Undoing an alignment

- **Before aligning, save the markers:** `snapshot_save { name: "before-align", trackIndices: [<guide track>, <double track>], stretchMarkers: true }`. It keeps the stretch markers of every audio item on those tracks, apart from the track chunk, and `snapshot_restore` puts them back on the same items (found by GUID, else by track, position and length). The reply says how many items it restored, left alone or could not find. Scope it with `trackIndices` in a big project.
- Without `stretchMarkers` a snapshot holds no items, so it cannot undo an alignment. `undo_project` does, one undo point per `align_audio_to_guide` call, as long as nothing was written after it.
- A `fullChunk` snapshot of the tracks was refused (`SetTrackStateChunk failed`) on tracks whose items carry Melodyne (ARA) take FX; the cause is not confirmed. The restore warns, leaves that track unchanged and still restores the saved stretch markers. For such tracks pass `fullChunk: false` when only the markers matter.
