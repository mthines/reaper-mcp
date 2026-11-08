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
4. **Apply** (same call without `dryRun`), then `verify_edit` against the kept copy with `timeScale: 1` for a pure alignment (stretch markers keep the length) and `expect: "changed"`. Judge it by the `discontinuity` check (no click) and the align call's after-offsets; the null residual is one number for the whole window and under `expect: "changed"` is only reported, so it does not say where audio moved.
5. **Listen** before accepting: play the aligned range with the guide. The tool checks for damage, not for taste.

## Stretching a vocal: what the checks mean

Measured on a real lead and backings with REAPER's stretch (42 edits, two listening rounds):

- **Pitch-kept stretches** from 0.92x to 1.25x sound clean: pitch drift within a few cents, tone under 1.5 dB.
- **Below 0.9x** a pitch-kept slow-down gets audible stretch artifacts (0.80x clearly, 0.85x and 0.88x slightly, 0.90x clean). They pass pitch, tone and transients; `verify_edit` adds a **dropout** check there (deepest loudness dip under the original, warn from 12 dB). The line is provisional (one phrase), and the rate gate does most of the work: treat anything below 0.9x as "listen first", and use it as a dub rather than a lead.
- **A plain speed change** (preserve pitch cleared, so the pitch follows the speed) is reported as `info`, not a warning, when the speed alone predicts a pitch move of at least 55 cents (rates outside about 0.97x-1.03x): pitch moves by `1200*log2(rate)` cents and the tone moves with it. Up to about 1.5 semitones was accepted by ear. Nearer 1.0 the move is too small to tell from an error, so a drift of 20 cents or more there still warns, and so does any pitch move the speed does not explain.
- A pitch shift with the timing unchanged (`timeScale` 1) gets no pitch check; shifting and stretching in one edit does.
- A pass is evidence, not proof. Ratings near the audible edge are noisy (the same audio was heard as artifacted once and clean twice).

## REAPER gotchas for building test edits

- `playRate` does not change an item's length: set length = source length / rate.
- A copied item has preserve pitch on; run action 40796 (clear take preserve pitch) for a varispeed, 40795 sets it.
- Item pitch: actions 40204 / 40205 (one semitone up / down) act on the selected items.
- **Put each copy straight at its final position** (`copy_media_items` with `position`). Batch-moving items on one track re-sorts their indexes mid-edit and edits land on the wrong items.
