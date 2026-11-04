---
title: Sleep Token style presets (starting points)
tags: [helix, prog-metal, ambient, snapshots]
---

# Sleep Token style: one preset, eight moments

Genre shorthand: a clean, wet, spacious verse; very heavy and tight rhythm guitars; ambient background leads;
breakdowns that hit like a wall. The Helix way to cover all of it is **one preset with snapshots**, not one preset per
sound: the amp and cab stay put, snapshots switch blocks and move a few controlled values.

Everything below is a **starting point to dial by ear**, not a measurement of anyone's rig. Use only models that
`helix_list_models` finds in real presets (those used here exist in the maintainer's library); read
`parameter-encoding` before setting values (amp knobs 0-1, Hz/dB/semitones in real units).

## Layout (two paths, 7 blocks max per path)

| Path | Blocks (chain order) | Why there |
|---|---|---|
| 1 | gate (input gate, `inputGate`), `HD2_DistMinotaur` (transparent push for leads), `HD2_AmpArchetypeClean`, `HD2_AmpArchetypeLead`, `HD2_Cab4X12CaliV30` | core tone on path 1; both amps present, one on per snapshot |
| 2 | `HD2_DelaySimpleDelay` (x2: short slap and long ambient), `HD2_ReverbPlateaux`, `HD2_EQParametric`, `HD2_CompressorLAStudioComp` | all time-based FX and glue on path 2, so path 1 keeps its DSP |

Heavier amp options from the catalog: `HD2_AmpPVPanama` (5150-style), `HD2_AmpRevvGenRed`, with `HD2_DistScream808`
(Gain ~0, Level ~0.55) as a tightening boost and `HD2_GateHardGate` early for palm-mute silence.
Pitch effects go before the amp, never after.

## Snapshots

| # | Name | On | Moves |
|---|---|---|---|
| 0 | Soft Verse | clean amp, cab, delay, reverb, comp | reverb `Mix` high, amp `Drive` low |
| 1 | Swell | as Soft Verse + long delay | reverb `Mix` highest, delay `Mix` up |
| 2 | Heavy Rhythm | minotaur off, lead amp, cab, comp | reverb `Mix` ~0.05-0.1, delays off, EQ `HighCut` lower to tame fizz |
| 3 | Breakdown | as Heavy Rhythm | amp `Drive` up a notch, EQ `LowCut` lower, reverb/delay off |
| 4 | Ambient Lead | minotaur, clean or lead amp, both delays, reverb | delay `Mix` ~0.35, reverb `Mix` ~0.5 |
| 5 | Heavy Lead | minotaur, lead amp, long delay, reverb | `Drive` mid, reverb `Mix` ~0.3 |
| 6 | Clean Lead | clean amp, short delay, reverb | `Drive` low |
| 7 | Pad / Synth | clean amp, both delays, reverb | reverb and delay `Mix` high, EQ `HighCut` down |

Build it with `helix_create_preset` (donor: any two-path preset with an amp on path 1), then adjust with
`helix_edit_preset`. The user's own `Sleep Token.hlx` is a good donor; it already has this routing.

## Rules that bit before

- A block that a snapshot turns off must also load off if that snapshot boots: `create_preset` and `edit_preset`
  do this for you (`@current_snapshot` decides the load-time state).
- Per-snapshot values only exist for parameters that are declared snapshot-controlled; the tools declare them
  when you pass `params` in a snapshot.
- Do not put the amp, dual cab and several time effects on one path: it fails to load as "Invalid model".
