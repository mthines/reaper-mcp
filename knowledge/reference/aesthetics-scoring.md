# Aesthetics Scoring Reference

How to read `analyze_track_aesthetics` (Meta Audiobox Aesthetics, CC-BY 4.0) and how big a difference has to be before it means anything. The numbers below were measured on a real session (a full mix and a solo lead vocal) on 2026-10-29.

## The four scores (0-10)

| Score | Measures | Use it to judge a mix change? |
|-------|----------|-------------------------------|
| PQ — Production Quality | Clarity, fidelity, balance, technical quality | **Yes** — the main signal |
| CU — Content Usefulness | How usable the audio is as material | **Yes**, as a second opinion |
| CE — Content Enjoyment | How enjoyable the content is | No — follows the arrangement, and rises with level |
| PC — Production Complexity | How many sources / how dense | No — follows the arrangement |

## Noise floor

The model itself is deterministic: scoring the same file three times gives identical scores. The noise comes from REAPER renders of the same range not being bit-identical (plugins with internal randomness, modulation, analog modelling).

| Clip length | PQ spread over 3 re-renders of the same range |
|-------------|-----------------------------------------------|
| 10 s | 0.38 (7.32 / 7.19 / 6.94) |
| 30 s | 0.04 (6.69 / 6.70 / 6.73) |

- Score **30 s clips** (the tool's default). A 10 s clip is too noisy to compare two mix versions.
- With 30 s clips, treat **PQ differences under ~0.1 as no change**.
- Sections differ: consecutive 10 s sections of one song ranged PQ 5.76-7.32. Always compare the **same range** before and after a change, never two different sections.

## Level

Louder audio does not raise PQ much, but it does raise CE. A fixed vocal clip normalized to different loudnesses:

| Loudness | PQ | CE |
|----------|----|----|
| -30 LUFS | 7.68 | 5.77 |
| -18 LUFS | 7.67 | 6.10 |
| -12 LUFS | 7.64 | 6.15 |
| -6 LUFS | 7.62 | 6.16 |

`analyze_track_aesthetics` normalizes every clip to -18 LUFS before scoring (`normalizeLufs`, default -18; `false` scores the audio as rendered) and reports `inputLufs` and `gainDb`. Keep the default for every A/B so that a version which is only louder does not look better.

## A/B workflow

1. `snapshot_save` the current state.
2. `analyze_track_aesthetics` on the master (or the bus) over a representative 30 s range. Note PQ and CU.
3. Make the change.
4. Score the **same** 30 s range again.
5. PQ up by more than ~0.1 → keep. Within ±0.1 → no measurable difference; decide with the other measurements (`analyze_track_offline`) and the user's ears. Down → `snapshot_restore`.

The score is one opinion. It does not know the genre or the user's intent; do not overrule a clear user preference with it.
