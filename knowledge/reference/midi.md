# MIDI & Media Item Reference

A cheat sheet for the agent: MIDI note numbers, drum maps, chord construction, CC parameters, beat math, and media item manipulation. All values are standard — adapt to the session's time signature and tempo.

## MIDI Note Numbers

Middle C = 60 (C4). Each semitone = +1. Each octave = +12.

| Note | Oct 1 | Oct 2 | Oct 3 | Oct 4 | Oct 5 | Oct 6 | Oct 7 |
|------|-------|-------|-------|-------|-------|-------|-------|
| C    | 24    | 36    | 48    | **60** | 72   | 84    | 96    |
| C#   | 25    | 37    | 49    | 61    | 73    | 85    | 97    |
| D    | 26    | 38    | 50    | 62    | 74    | 86    | 98    |
| D#   | 27    | 39    | 51    | 63    | 75    | 87    | 99    |
| E    | 28    | 40    | 52    | 64    | 76    | 88    | 100   |
| F    | 29    | 41    | 53    | 65    | 77    | 89    | 101   |
| F#   | 30    | 42    | 54    | 66    | 78    | 90    | 102   |
| G    | 31    | 43    | 55    | 67    | 79    | 91    | 103   |
| G#   | 32    | 44    | 56    | 68    | 80    | 92    | 104   |
| A    | 33    | 45    | 57    | 69    | 81    | 93    | 105   |
| A#   | 34    | 46    | 58    | 70    | 82    | 94    | 106   |
| B    | 35    | 47    | 59    | 71    | 83    | 95    | 107   |

## General MIDI Drum Map (Channel 9)

| Note | Drum              | Note | Drum              |
|------|-------------------|------|-------------------|
| 35   | Acoustic Bass Drum | 49  | Crash Cymbal 1    |
| 36   | Bass Drum 1       | 50   | High Tom          |
| 37   | Side Stick        | 51   | Ride Cymbal 1     |
| 38   | Acoustic Snare    | 52   | Chinese Cymbal    |
| 39   | Hand Clap         | 53   | Ride Bell         |
| 40   | Electric Snare    | 54   | Tambourine        |
| 41   | Low Floor Tom     | 55   | Splash Cymbal     |
| 42   | Closed Hi-Hat     | 56   | Cowbell           |
| 43   | High Floor Tom    | 57   | Crash Cymbal 2    |
| 44   | Pedal Hi-Hat      | 58   | Vibraslap         |
| 45   | Low Tom           | 59   | Ride Cymbal 2     |
| 46   | Open Hi-Hat       | 60   | Hi Bongo          |
| 47   | Low-Mid Tom       | 61   | Low Bongo         |
| 48   | Hi-Mid Tom        | 69   | Cabasa            |

## Beat Position Math

Positions and durations are in **beats** (quarter notes) from item start.

### Note Durations

| Duration       | Beats  | At 120 BPM (seconds) |
|----------------|--------|---------------------|
| Whole note     | 4.0    | 2.0                 |
| Dotted half    | 3.0    | 1.5                 |
| Half note      | 2.0    | 1.0                 |
| Dotted quarter | 1.5    | 0.75                |
| Quarter note   | 1.0    | 0.5                 |
| Dotted eighth  | 0.75   | 0.375               |
| Eighth note    | 0.5    | 0.25                |
| Triplet quarter| 0.667  | 0.333               |
| Sixteenth note | 0.25   | 0.125               |
| Triplet eighth | 0.333  | 0.167               |
| 32nd note      | 0.125  | 0.063               |

### Conversion Formulas

```
seconds = beats × (60 / tempo)
beats = seconds × (tempo / 60)
item_length_seconds = bars × beats_per_bar × (60 / tempo)
```

Example: 4 bars of 4/4 at 120 BPM = 4 × 4 × (60/120) = 8 seconds

### Beat Grid (4/4 Time, One Bar)

| Beat  | Position | 8th grid | 16th grid |
|-------|----------|----------|-----------|
| 1     | 0.0      | 0.0, 0.5 | 0.0, 0.25, 0.5, 0.75 |
| 2     | 1.0      | 1.0, 1.5 | 1.0, 1.25, 1.5, 1.75 |
| 3     | 2.0      | 2.0, 2.5 | 2.0, 2.25, 2.5, 2.75 |
| 4     | 3.0      | 3.0, 3.5 | 3.0, 3.25, 3.5, 3.75 |

## Velocity Dynamics

| Dynamic       | Velocity | When to use |
|---------------|----------|-------------|
| Ghost note    | 20–40    | Ghost snares, subtle percussion, background texture |
| Pianissimo    | 40–55    | Soft passages, intro/outro, ambient parts |
| Piano         | 55–70    | Verse, gentle playing |
| Mezzo-forte   | 70–85    | Default, natural medium feel |
| Forte         | 85–105   | Accents, chorus, energetic passages |
| Fortissimo    | 105–120  | Strong accents, hits |
| Maximum       | 121–127  | Crash cymbals, max-impact moments |

**Important**: Vary velocity for realism. Robotic patterns use constant velocity; human patterns vary by ±5–15 around the target.

## Common CC Numbers

| CC  | Name            | Typical Use                                    |
|-----|-----------------|------------------------------------------------|
| 0   | Bank Select MSB | Program/bank selection                         |
| 1   | Modulation      | Vibrato, filter modulation                     |
| 2   | Breath Control  | Wind instrument expression                     |
| 7   | Volume          | Channel volume automation                      |
| 10  | Pan             | Left (0) to right (127), center = 64           |
| 11  | Expression      | Musical dynamics within a phrase                |
| 64  | Sustain Pedal   | 0 = off, 127 = on (binary)                     |
| 65  | Portamento      | Pitch glide on/off                             |
| 71  | Resonance       | Filter resonance (synths)                      |
| 74  | Cutoff          | Filter cutoff frequency (synths)               |
| 91  | Reverb Send     | Reverb amount                                  |
| 93  | Chorus Send     | Chorus amount                                  |
| 123 | All Notes Off   | Panic / silence                                |

## Chord Construction

Build chords by stacking intervals (in semitones) from the root note.

### Triads

| Chord Type | Intervals | From C4 (60) | Sound Character |
|------------|-----------|---------------|-----------------|
| Major      | 0, 4, 7   | 60, 64, 67   | Happy, bright   |
| Minor      | 0, 3, 7   | 60, 63, 67   | Sad, dark       |
| Diminished | 0, 3, 6   | 60, 63, 66   | Tense, unstable |
| Augmented  | 0, 4, 8   | 60, 64, 68   | Mysterious      |
| Sus2       | 0, 2, 7   | 60, 62, 67   | Open, ambiguous |
| Sus4       | 0, 5, 7   | 60, 65, 67   | Suspended, tension |

### Seventh Chords

| Chord Type | Intervals      | From C4 (60)     |
|------------|----------------|------------------|
| Major 7    | 0, 4, 7, 11   | 60, 64, 67, 71  |
| Dominant 7 | 0, 4, 7, 10   | 60, 64, 67, 70  |
| Minor 7    | 0, 3, 7, 10   | 60, 63, 67, 70  |
| Half-dim 7 | 0, 3, 6, 10   | 60, 63, 66, 70  |
| Dim 7      | 0, 3, 6, 9    | 60, 63, 66, 69  |
| Min/Maj 7  | 0, 3, 7, 11   | 60, 63, 67, 71  |

### Extended & Altered Chords

| Chord Type | Intervals         | From C4 (60)          |
|------------|-------------------|-----------------------|
| Add9       | 0, 4, 7, 14      | 60, 64, 67, 74       |
| 9th        | 0, 4, 7, 10, 14  | 60, 64, 67, 70, 74   |
| Maj9       | 0, 4, 7, 11, 14  | 60, 64, 67, 71, 74   |
| Min9       | 0, 3, 7, 10, 14  | 60, 63, 67, 70, 74   |
| 11th       | 0, 4, 7, 10, 17  | 60, 64, 67, 70, 77   |
| 13th       | 0, 4, 7, 10, 21  | 60, 64, 67, 70, 81   |
| Power (5th)| 0, 7             | 60, 67               |

### Common Progressions (in Roman Numerals → MIDI Roots)

| Progression | In C Major (roots)      | Notes |
|-------------|------------------------|-------|
| I–V–vi–IV  | C(60)–G(67)–Am(69)–F(65) | Pop, rock (most common) |
| I–IV–V–I   | C(60)–F(65)–G(67)–C(60) | Blues, rock & roll |
| ii–V–I     | Dm(62)–G(67)–C(60)     | Jazz standard |
| I–vi–IV–V  | C(60)–Am(69)–F(65)–G(67) | 50s doo-wop |
| vi–IV–I–V  | Am(69)–F(65)–C(60)–G(67) | Modern pop (deceptive) |
| i–VII–VI–V | Am(69)–G(67)–F(65)–E(64) | Andalusian cadence |

## Common Drum Patterns

### Basic Rock (8th note hi-hat)

| Beat     | 1   | +   | 2   | +   | 3   | +   | 4   | +   |
|----------|-----|-----|-----|-----|-----|-----|-----|-----|
| Position | 0.0 | 0.5 | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 |
| Hi-Hat(42)| x  | x   | x   | x   | x   | x   | x   | x   |
| Snare(38)|     |     | x   |     |     |     | x   |     |
| Kick(36) | x   |     |     |     | x   |     |     |     |

### Pop Four-on-Floor

| Beat     | 1   | +   | 2   | +   | 3   | +   | 4   | +   |
|----------|-----|-----|-----|-----|-----|-----|-----|-----|
| Hi-Hat(42)| x  | x   | x   | x   | x   | x   | x   | x   |
| Snare(38)|     |     | x   |     |     |     | x   |     |
| Kick(36) | x   |     | x   |     | x   |     | x   |     |

### Hip-Hop (Boom-Bap)

| Beat     | 1   | +   | 2   | +   | 3   | +   | 4   | +   |
|----------|-----|-----|-----|-----|-----|-----|-----|-----|
| Hi-Hat(42)| x  | x   | x   | x   | x   | x   | x   | x   |
| Snare(38)|     |     | x   |     |     |     | x   |     |
| Kick(36) | x   |     |     | x   |     | x   |     |     |

## Media Item Operations Quick Reference

| Task | Tool | Key Parameters |
|------|------|---------------|
| List items on track | `list_media_items` | trackIndex |
| Inspect item details | `get_media_item_properties` | trackIndex, itemIndex |
| Change volume | `set_media_item_properties` | volume (dB, 0=unity) |
| Add fade in/out | `set_media_item_properties` | fadeInLength, fadeOutLength (seconds) |
| Split at time | `split_media_item` | position (seconds, absolute) |
| Trim from start | `trim_media_item` | trimStart (positive=shorter) |
| Trim from end | `trim_media_item` | trimEnd (positive=shorter) |
| Extend edges | `trim_media_item` | trimStart or trimEnd (negative) |
| Move to new position | `move_media_item` | newPosition (seconds) |
| Move to new track | `move_media_item` | newTrackIndex |
| Change playback speed | `set_media_item_properties` | playRate (0.1–10, 1.0=normal) |
| Time-stretch point | `add_stretch_marker` | position, sourcePosition |
