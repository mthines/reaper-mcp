---
name: Delivery
id: delivery
description: Verify final masters meet platform delivery specs — LUFS, true peak, format requirements
---

# Delivery

## When to Use

As the final step in the production workflow. Delivery verification ensures the finished master meets the technical requirements of target platforms before export.

Use this workflow when:
- The master is complete and ready for distribution
- You need to verify specs for a specific platform (Spotify, Apple Music, CD, club, broadcast)
- A mastering engineer or distributor has requested specific delivery specs
- You want a final QA pass before bouncing the final file

## Prerequisites

- Mastering is complete (master bus chain is finalized)
- Target platform(s) are known
- The session plays back correctly from start to finish
- LUFS metering is available

## Step-by-Step

### Step 1: Identify target platforms

Determine which platforms the master will be delivered to. Each has different specs:

| Platform | Integrated LUFS | True Peak | Sample Rate | Bit Depth | Format |
|----------|----------------|-----------|-------------|-----------|--------|
| Spotify / YouTube | -14 LUFS | -1.0 dBTP | 44.1+ kHz | 24-bit | WAV/FLAC |
| Apple Music | -16 LUFS | -1.0 dBTP | 44.1-96 kHz | 24-bit | WAV |
| Apple Digital Masters | -16 LUFS | -1.0 dBTP | 96 kHz | 24-bit | WAV |
| Tidal / Amazon HD | -14 LUFS | -1.0 dBTP | 44.1-96 kHz | 24-bit | WAV/FLAC |
| CD (Red Book) | -9 to -14 LUFS | -0.3 dBTP | 44.1 kHz | 16-bit | WAV (dithered) |
| Club / DJ | -6 to -9 LUFS | -0.1 dBTP | 44.1-48 kHz | 24-bit | WAV |
| Broadcast (EBU R128) | -23 LUFS | -1.0 dBTP | 48 kHz | 24-bit | BWF |
| Broadcast (ATSC A/85) | -24 LUFS | -2.0 dBTP | 48 kHz | 24-bit | BWF |
| Vinyl pre-master | N/A | N/A | 96 kHz | 24/32-bit | WAV |

### Step 2: Measure current loudness

Play the full song from start to finish for integrated LUFS measurement:

```
tool: read_track_lufs
params:
  trackIndex: [master bus index]
```

Record:
- Integrated LUFS
- Short-term LUFS (max)
- Momentary LUFS (max)
- True peak (dBTP)
- Loudness range (LRA)

### Step 3: Verify frequency balance

```
tool: read_track_spectrum
params:
  trackIndex: [master bus index]
```

Check for:
- **Sub rumble** below 30 Hz (should be minimal)
- **Low-end balance** (60-250 Hz appropriate for genre)
- **Mud buildup** (250-500 Hz — should not be dominant)
- **Harshness** (2-5 kHz — check against perceived loudness expectations)
- **Air/presence** (8-20 kHz — should be present but not harsh)

A well-mastered track typically shows a gentle downward slope from low to high frequencies on a spectrum analyzer.

### Step 4: Check dynamics

```
tool: read_track_crest
params:
  trackIndex: [master bus index]
```

Crest factor targets by genre:
- **Orchestral/Classical**: 14-20+ dB (maximum dynamic range)
- **Jazz/Folk**: 12-16 dB
- **Rock/Pop**: 8-12 dB
- **Hip-Hop/R&B**: 6-10 dB
- **EDM/Club**: 6-8 dB

If crest factor is below 6 dB, the master is likely over-compressed.

### Step 5: Verify stereo image

```
tool: read_track_correlation
params:
  trackIndex: [master bus index]
```

Check:
- **Correlation > 0.7**: Good mono compatibility (safe for all playback systems)
- **Correlation 0.3-0.7**: Wide stereo (check mono playback carefully)
- **Correlation < 0.3**: Very wide or phase issues (will sound thin on mono systems)
- **Correlation < 0**: Phase cancellation (FIX THIS — will disappear on mono systems)

### Step 6: Check peak levels

```
tool: read_track_meters
params:
  trackIndex: [master bus index]
```

Verify peak levels are below the true peak ceiling for the target platform:
- Streaming: peaks below -1.0 dBTP
- CD: peaks below -0.3 dBTP
- Club: peaks below -0.1 dBTP
- Broadcast: peaks below -1.0 dBTP (EBU) or -2.0 dBTP (ATSC)

### Step 7: Verify session specs

```
tool: get_project_info
```

Confirm:
- Sample rate matches delivery requirement
- Session is playing back without errors
- Project tempo and time signature are correct (metadata)

### Step 8: Generate delivery checklist

Compile a report for the user:

```
## Delivery Report

### Target Platform: [platform]
| Spec | Target | Measured | Status |
|------|--------|----------|--------|
| Integrated LUFS | [target] | [measured] | PASS/FAIL |
| True Peak | [target] dBTP | [measured] dBTP | PASS/FAIL |
| Crest Factor | [target range] dB | [measured] dB | PASS/FAIL |
| Stereo Correlation | > 0.3 | [measured] | PASS/FAIL |
| Sample Rate | [target] kHz | [measured] kHz | PASS/FAIL |
| Sub Rumble (< 30 Hz) | Minimal | [observation] | PASS/FAIL |

### Export Instructions
- Format: [WAV/FLAC/BWF]
- Bit Depth: [16/24/32-bit]
- Sample Rate: [kHz]
- Dithering: [Yes (16-bit only) / No]
- Filename: [SongTitle]_[Platform]_[BitDepth]-[SampleRate].[ext]

### Notes
- [Any concerns, compromises, or recommendations]
```

## Platform-Specific Notes

### Spotify / YouTube
- These platforms normalize loudness to -14 LUFS. Masters louder than -14 will be turned DOWN.
- Masters quieter than -14 will be turned UP (with potential for clipping if true peak is close to 0).
- Best practice: master to -14 LUFS with -1.0 dBTP ceiling.

### Apple Music
- Normalizes to -16 LUFS. Slightly quieter target.
- Apple Digital Masters program requires 24-bit/96 kHz source files.
- High-res lossless badge requires meeting Apple's toolchain specs.

### CD (Red Book)
- 16-bit requires dithering from 24-bit source (TPDF or noise-shaped dither).
- 44.1 kHz mandatory — sample rate conversion needed if session is at 48+ kHz.
- True peak ceiling should be -0.3 dBTP to account for inter-sample peaks after D/A conversion.

### Club / DJ
- Louder targets (-6 to -9 LUFS) are acceptable and expected.
- Sub bass must be tight and controlled (club systems are very revealing below 60 Hz).
- True peak ceiling can be tighter (-0.1 dBTP) since playback is on professional systems.

### Broadcast (EBU R128 / ATSC A/85)
- Strict loudness standards enforced by regulation.
- EBU R128: -23 LUFS ± 0.5, loudness range (LRA) should be appropriate for content.
- ATSC A/85: -24 LUFS (used in North American broadcast).

### Vinyl
- No excessive sub-bass below 30 Hz (causes needle skip)
- Controlled sibilance (excessive high frequencies cause distortion on inner grooves)
- Mono bass below 300 Hz recommended (prevents groove wall issues)
- Dynamic range is welcome — vinyl handles dynamics well
- Separate master from digital — vinyl mastering is its own discipline

## Common Pitfalls

- **Not measuring full-song integrated LUFS**: Short-term or momentary readings are NOT the delivery spec. Play the entire song for integrated measurement.
- **Ignoring true peak**: Digital-to-analog conversion creates inter-sample peaks. True peak (ISP) meters catch these; regular peak meters don't. Always check true peak.
- **Same master for all platforms**: A -14 LUFS streaming master won't work for club play (-6 to -9 LUFS needed). Create separate masters for different delivery targets.
- **Forgetting dither for 16-bit**: Converting 24-bit to 16-bit without dither introduces quantization distortion. Always apply TPDF dither.
- **Over-relying on numbers**: Delivery specs are minimum requirements, not the only quality measure. A master that hits -14 LUFS but sounds distorted still needs work.
