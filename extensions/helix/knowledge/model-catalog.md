---
title: Helix Model Catalog — Real Model IDs and Parameters
impact: HIGH
tags:
  - helix
  - models
  - catalog
  - parameters
---

# Helix Model Catalog

Real `@model` identifiers and their **exact parameter names**, harvested from inspecting real `.hlx` presets.
Use these verbatim — parameter names are case- and space-sensitive (`"Mid Freq"`, `"Hi Thresh"`, `"31p25Hz"`).

## Contents

- [Hard rule: never invent IDs](#hard-rule-never-invent-ids)
- [ID naming pattern](#id-naming-pattern)
- [Amps](#amps)
- [Cabs and IRs](#cabs-and-irs)
- [Drives / distortion / fuzz](#drives--distortion--fuzz)
- [Dynamics: compressors and gates](#dynamics-compressors-and-gates)
- [EQ](#eq)
- [Modulation](#modulation)
- [Delay](#delay)
- [Reverb](#reverb)
- [Pitch / synth / filter / wah / volume](#pitch--synth--filter--wah--volume)
- [Routing nodes](#routing-nodes)
- ["Based on" map for common models](#based-on-map-for-common-models)

## Hard rule: never invent IDs

Model-ID spelling is **firmware-version-sensitive** and new models appear with each firmware.
The list below is what was present in the inspected presets — it is **not exhaustive** of all ~93 amps / ~69 cabs / ~342 total models Helix ships.

**To use a model not listed here:** copy its exact `@model` string and full default parameter block from a real preset that already contains it (export one from Helix Native, or search the user's preset library). Do not guess an ID like `HD2_AmpMesaMarkV` — it will silently fail to load.

## ID naming pattern

`HD2_<Category><ModelName>` — e.g. `HD2_AmpBritPlexi`, `HD2_DistScream808`, `HD2_ReverbHall`.
A few use other prefixes: legacy modelers (`DM4...`, `DL4...`, `FM4...`, `L6SPB_...`) and the VIC reverbs (`VIC_DynPlate`, `VIC_ReverbRotating`).

## Amps

Amp param block is consistent: `Drive` (gain), `Bass`/`Mid`/`Treble`/`Presence` (tone stack), `Master`/`ChVol` (volume), plus advanced: `Bias`, `BiasX`, `Sag`, `Hum`, `Ripple`, `Resonance`, `Depth`, `Aggression`, `BrightSW`. **All amp knobs are normalized `0.0–1.0`.**

| `@model` | Params |
| --- | --- |
| `HD2_AmpPVPanama` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple Resonance |
| `HD2_AmpRevvGenRed` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple Resonance **Aggression** |
| `HD2_AmpLine6Badonk` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Depth |
| `HD2_AmpLine6Epic` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple |
| `HD2_AmpArchetypeClean` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple Depth **BrightSW** |
| `HD2_AmpArchetypeLead` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple Depth |
| `HD2_AmpPlacaterDirty` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag **Fat HBE C45 Voice Saturation SSwitch** Ripple |
| `HD2_AmpJazzRivet120` | Drive Bass Mid Treble Presence Master ChVol **Bright** |
| `HD2_AmpUSDoubleVib` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple |
| `HD2_AmpUSPrincess` | Drive Bass Mid Treble Presence Master ChVol Bias BiasX Sag Hum Ripple |
| `HD2_AmpAguaSledge` (bass) | Drive Gain Master Ch Vol Bass Mid Treble **Mid Freq** |

## Cabs and IRs

**Cab params use real units** (Hz / degrees / index), NOT 0–1. See [`../rules/parameter-encoding.md`](../rules/parameter-encoding.md).

| `@model` | Params |
| --- | --- |
| `HD2_CabMicIr_4x12CaliV30` | Mic Position Distance Angle LowCut HighCut Level |
| `HD2_CabMicIr_1x12Epicenter` | Mic Position Distance Angle LowCut HighCut Level |
| `HD2_CabMicIr_4x12UberT75WithPan` | Mic Position Distance Angle LowCut HighCut Level **Pan Delay** |
| `HD2_Cab4X12CaliV30` | Distance EarlyReflections LowCut HighCut Level |
| `HD2_Cab4x12XXLV30` | Distance EarlyReflections LowCut HighCut Level |
| `HD2_Cab8x10SVBeast` (bass) | Distance EarlyReflections LowCut `High Cut` Level |
| `HD2_ImpulseResponse1024` | Index LowCut HighCut Mix Level |
| `HD2_ImpulseResponse1024Dual` | Index Index_1 LowCut LowCut_1 HighCut HighCut_1 `A Pan` `B Pan` `A Polarity` `B Polarity` Delay Level_1 Mix |

## Drives / distortion / fuzz

Klon/TS-style drives are simple: `Gain Level Tone` (normalized 0–1).

| `@model` | Based on | Params |
| --- | --- | --- |
| `HD2_DistScream808` | Ibanez TS808 | Gain Level Tone |
| `HD2_DistMinotaur` | Klon Centaur | Gain Level Tone |
| `HD2_DistTeemah` | Paul Cochrane Timmy | Gain Level Bass Treble Clipping |
| `HD2_DistDhyanaDrive` | — | Gain Level Tone Voice |
| `HD2_DistHorizonDrive` | Horizon Precision Drive | Drive Level Bright Attack Gate Gate_Range |
| `HD2_DistHeirApparent` | — | Gain Level Tone Presence Voltage Clipping GainMod |
| `HD2_DistObsidian7000` (bass) | Darkglass B7K | Drive Blend Level Bass Treble LoMid HiMid LoMidFreq HiMidFreq Grunt Attack Distortion Master |
| `HD2_DM4ClassicDistortion` | DigiTech DM4 model | Drive Output Bass Treble Filter |

## Dynamics: compressors and gates

Comp thresholds/ratios are in **real units** (dB, ratio). Gate thresholds in **dB**.

| `@model` | Params |
| --- | --- |
| `HD2_CompressorDeluxeComp` | Threshold Ratio Attack Release Knee Mix Level |
| `HD2_CompressorLAStudioComp` | PeakReduction Gain Emphasis Type Mix Level |
| `HD2_CompressorRedSqueeze` | Sensitivity Mix Level |
| `HD2_CompressorRochesterComp` | Threshold Ratio Attack Release Knee Gain Mix Level |
| `HD2_Compressor3BandComp` (bass) | `Lo Thresh` `Mid Thresh` `Hi Thresh` `Lo Gain` `Mid Gain` `Hi Gain` `Lo X Freq` `Hi X Freq` Ratio Attack Release Detector Level |
| `HD2_CompressorAutoSwell` | Attack Decay Threshold Taper `Rel Offset` Level |
| `HD2_GateNoiseGate` | Threshold Decay Level |
| `HD2_GateHardGate` | OpenThreshold CloseThreshold Decay HoldTime Level |

## EQ

EQ freq params in **Hz**, gains in **dB**, Q as a number. Graphic-EQ band keys: `31p25Hz 62p5Hz 125Hz 250Hz 500Hz 1kHz 2kHz 4kHz 8kHz 16kHz`.

| `@model` | Params |
| --- | --- |
| `HD2_EQParametric` | LowFreq LowGain LowQ MidFreq MidGain MidQ HighFreq HighGain HighQ LowCut HighCut Level |
| `HD2_EQLowCutHighCut` | LowCut HighCut Level |
| `HD2_EQGraphic10Band` | 31p25Hz 62p5Hz 125Hz 250Hz 500Hz 1kHz 2kHz 4kHz 8kHz 16kHz Level |
| `HD2_EQSimple3Band` | LowGain MidGain MidFreq HighGain Level |
| `HD2_EQSimpleTilt` | Tilt CenterFreq Level |
| `HD2_PreampVintagePre` (bass) | Input Output `Hi Pass` `Low Pass` MicLine Polarity |

## Modulation

| `@model` | Params |
| --- | --- |
| `HD2_Chorus` | Speed Depth Tone Predelay Spread Mix Level WaveShape SyncSelect1 TempoSync1 |
| `HD2_ChorusTrinityChorus` | Rate Manual Mode Preset Left Center Right LeftBoost CenterBoost RightBoost Mix Level SyncSelect1 TempoSync1 |
| `HD2_PhaserScriptModPhase` | Rate Spread Mix Level SyncSelect1 TempoSync1 |
| `HD2_PhaserUbiquitousVibe` | Rate Intensity Mode LampBias Spread Mix Level SyncSelect1 TempoSync1 |
| `HD2_FlangerGrayFlanger` | Rate Width Manual Regen Spread Headroom Mix Level SyncSelect1 TempoSync1 |
| `HD2_TremoloTremolo` | Speed Intensity DutyCycle WaveShape Spread Level SyncSelect1 TempoSync1 |
| `HD2_TremoloHarmonic` | Speed Intensity DutyCycle WaveShape BassFreq TrebFreq Spread Mix Level SyncSelect1 TempoSync1 |
| `HD2_RetroReel` | TapeSpeed Saturation Texture WowFluttr LowCut HighCut Level |

## Delay

Time params: `TempoSync1` bool + `SyncSelect1` note value; `Time`/`Scale` set the time. `Mix`/`Feedback`/`HighCut`/`LowCut` common.

| `@model` | Params |
| --- | --- |
| `HD2_DelaySimpleDelay` | Time Feedback Mix Level Scale SyncSelect1 TempoSync1 |
| `HD2_DelayPingPong` | Time Feedback Spread Mix Level Scale LowCut HighCut SyncSelect1 TempoSync1 |
| `HD2_DelayDualDelay` | `Left Time` `Right Time` LeftFeedback RightFeedback MixL MixR Spread Depth Speed ModulationMode LowCut HighCut Level SyncSelect1/2 TempoSync1/2 |
| `HD2_DelayDuckedDelay` | Time Feedback Threshold Ducking DynAttack DynRel DynType Scale Mix Level LowCut HighCut SyncSelect1 TempoSync1 |
| `HD2_DelayCrissCross` | TimeA TimeB FeedbackA FeedbackB Crossfeed PanA PanB ModDepth ModRate Shape Phase BitDepth SampleRate Headroom LowCut HighCut Mix Level SyncSelect1/2 TempoSync1/2 |
| `HD2_DelayVintageDigitalV2` | Time Feedback Depth Rate BitDepth SampleRate Headroom Scale Mix Level SyncSelect1 TempoSync1 |
| `HD2_DL4DynamicDelayStereo` | Time Feedback Threshold Ducking Mix Level SyncSelect1 TempoSync1 |

## Reverb

Common shape: `Decay Predelay Mix Level LowCut HighCut`.

| `@model` | Params |
| --- | --- |
| `HD2_ReverbHall` / `HD2_ReverbRoom` / `HD2_ReverbPlate` / `HD2_ReverbTile` | Decay Predelay Mix Level LowCut HighCut |
| `HD2_ReverbPlateaux` | Decay Predelay Mix Level Tone Modulation Pitch1 Pitch2 Cents1 Cents2 PitchMix |
| `VIC_DynPlate` | Decay PreDelay Mix Level LowCut HighCut Damping BassBoost BassFreq MatrFreq VarDelayAmpl |
| `VIC_ReverbRotating` | Decay Predelay Mix Level LowCut HighCut Damping Diffusion RoomSize Motion BassBoost BassFreq |

## Pitch / synth / filter / wah / volume

| `@model` | Params |
| --- | --- |
| `HD2_PitchSimplePitch` | Interval1 Cents1 Time1 LevelVoice1 PanVoice1 PanDry Mix Level |
| `HD2_PitchDualPitch` | Interval1 Interval2 Cents1 Cents2 Time1 Time2 LevelVoice1 LevelVoice2 PanVoice1 PanVoice2 PanDry Mix Level |
| `HD2_FM4SynthOMatic` | Wave Frequency Q Pitch Mix Level |
| `HD2_WahColorful` / `HD2_WahChromeCustom` | Pedal FcLow FcHigh Mix Level |
| `L6SPB_PolyWham` | Position HeelShift ToeShift Tracking AutoEQ Mix Level |
| `HD2_VolPanVol` | Pedal VolumeTaper |
| `HD2_VolPanGain` | Gain |

## Routing nodes

| `@model` | Params |
| --- | --- |
| `HD2_AppDSPFlow1Input` | (input) noiseGate threshold decay |
| `HD2_AppDSPFlowSplitY` | BalanceA BalanceB bypass |
| `HD2_AppDSPFlowSplitAB` | RouteTo bypass |
| `HD2_AppDSPFlowJoin` | `A Level` `B Level` `A Pan` `B Pan` `B Polarity` Level |

## "Based on" map for common models

For genre recommendations, these real-world equivalences help pick a model:

- **Metal/high-gain amps:** `HD2_AmpPVPanama` ≈ Peavey 5150/6505 · `HD2_AmpRevvGenRed` ≈ Revv Generator (Red ch) · `HD2_AmpPlacaterDirty` ≈ Friedman BE-100 · `HD2_AmpArchetypeLead` ≈ Neural archetype lead.
- **Clean/cleanish amps:** `HD2_AmpUSDoubleVib` ≈ Fender Twin · `HD2_AmpUSPrincess` ≈ Fender Princeton · `HD2_AmpJazzRivet120` ≈ Roland JC-120 · `HD2_AmpArchetypeClean` ≈ Neural archetype clean.
- **Bass amps:** `HD2_AmpAguaSledge` ≈ Aguilar/SVT-style.
- **Drives:** `HD2_DistScream808` = TS808 (tightening boost) · `HD2_DistMinotaur` = Klon · `HD2_DistTeemah` = Timmy · `HD2_DistObsidian7000` = Darkglass B7K (bass grind).
