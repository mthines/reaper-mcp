# Perceived Loudness Reference

Human hearing does not perceive all frequencies equally. A bass note and a vocal at the same dB SPL will sound like very different volumes. This reference helps the agent compensate for psychoacoustic loudness perception when balancing a mix — optimizing for what the listener actually hears, not just what the meters show.

## Equal-Loudness Contours (ISO 226:2003)

Equal-loudness contours (historically "Fletcher-Munson curves") map the SPL required at each frequency to sound equally loud to the human ear. Key takeaways:

| Frequency Range | Perceived Loudness at Same dB | Implication for Mixing |
|----------------|------------------------------|----------------------|
| 20-80 Hz (sub/bass) | Sounds **much quieter** than meter shows | Bass instruments need higher dB to feel balanced |
| 80-250 Hz (upper bass) | Sounds **somewhat quieter** | Warmth region; needs modest boost over mids |
| 250 Hz-1 kHz (mids) | Sounds **roughly accurate** to meter | Meters are fairly reliable here |
| 1-5 kHz (presence) | Sounds **louder** than meter shows | Most sensitive hearing range — a little goes a long way |
| 2-5 kHz (peak sensitivity) | Sounds **significantly louder** | The ear is 10-15 dB more sensitive here than at 100 Hz |
| 5-8 kHz (sibilance) | Sounds **louder** | Sibilance cuts through even at low levels |
| 8-20 kHz (air) | Sensitivity **drops off** | Needs more energy to be perceived, but fatigues quickly if excessive |

### The Critical Insight

At moderate listening levels (~70-85 dB SPL, typical mixing/monitoring level):
- **3-4 kHz is ~10-15 dB more sensitive** than 100 Hz
- **A snare drum** (energy at 200 Hz + 2-5 kHz) sounds louder than **a bass guitar** (energy at 60-250 Hz) even at the same RMS dB reading
- **Vocals** (fundamental 100-400 Hz, formants at 1-5 kHz) naturally cut through a mix because their energy is in the ear's most sensitive band
- **Kick drum sub** (40-80 Hz) needs significantly more energy than hi-hats (8-12 kHz) to feel "present" — but hi-hats fatigue faster

## Perceived Loudness by Instrument

Instruments ranked by how loud they **sound** relative to their **metered level**, from "sounds louder than meters suggest" to "sounds quieter":

| Instrument | Dominant Frequency Range | Perceived vs. Metered | Mixing Compensation |
|-----------|------------------------|----------------------|-------------------|
| Vocals | 1-5 kHz (formants) | Sounds **louder** | Can sit 2-4 dB below other elements on meters and still cut through |
| Snare drum | 200 Hz + 2-5 kHz (crack) | Sounds **louder** | Crack frequency is in the sensitive zone; don't over-boost |
| Hi-hat / cymbals | 6-12 kHz | Sounds **moderately louder** | Small dB changes are very audible; mix lower than you think |
| Acoustic guitar | 2-5 kHz (string attack) | Sounds **moderately louder** | Attack frequency carries; back off presence boosts |
| Electric guitar | 1-4 kHz (midrange) | Sounds **about right** | Meter-reading is fairly reliable for perceived level |
| Piano | 250 Hz-4 kHz (wide range) | Sounds **about right** | Depends on register; upper notes sound louder than lower |
| Kick drum | 60-100 Hz (thump) | Sounds **quieter** | Needs 3-6 dB more than meters suggest for balanced feel |
| Bass guitar | 60-250 Hz (fundamental) | Sounds **quieter** | Needs 2-5 dB more on meters than mid-range instruments |
| 808 / sub bass | 30-80 Hz | Sounds **much quieter** | On small speakers, nearly inaudible; rely on harmonics (150-300 Hz) |
| Pads / drones | Varies | Depends on spectral content | Low pads need more level; bright pads need less |

## How to Apply This When Mixing

### Balance by Perception, Not Meters

When setting initial track balance:

1. **Don't match RMS levels across all tracks** — this makes bass instruments too quiet and presence-range instruments too loud
2. **Bass instruments should read 3-6 dB hotter** on meters than vocals/guitars to sound "even" in the mix
3. **Vocals can sit 2-4 dB lower on meters** than the instrumental bed and still sound prominent due to presence-range sensitivity
4. **Hi-hats and cymbals at -3 dB lower on meters** than you'd expect — they punch through perceptually
5. **After setting meter levels, always verify with your ears** — meters are a starting point, perception is the target

### Gain Staging Adjustments

The standard -18 dBFS target is a good starting point, but perceived-loudness-aware gain staging considers the instrument's spectral content:

| Instrument Category | Meter Target (RMS) | Rationale |
|-------------------|-------------------|-----------|
| Sub/bass instruments | -16 to -14 dBFS | Higher on meters to compensate for lower perceived loudness |
| Full-range instruments (piano, guitar) | -18 dBFS | Standard target; spectral content spans perceptual range |
| Mid/presence instruments (vocals, snare) | -19 to -20 dBFS | Lower on meters; presence-range content sounds louder |
| High-frequency instruments (cymbals, shakers) | -20 to -22 dBFS | Much lower on meters; high sensitivity frequencies carry easily |

These are **starting points** — verify by ear and adjust for genre/arrangement context.

### EQ Decisions Informed by Perception

- **Boosting 2-5 kHz**: Even +1 dB is very audible here. Be conservative — the ear amplifies this range naturally.
- **Cutting 200-400 Hz**: The ear is less sensitive here, so cuts may need to be larger (-3 to -6 dB) to make an audible difference.
- **Boosting sub-bass (30-80 Hz)**: Large boosts (+4-6 dB) may be needed to feel present, but check on multiple speaker systems — headphones and club systems reproduce this range very differently.
- **Air boosts (10-16 kHz)**: Sensitivity drops off, so +2-3 dB can sound subtle. But accumulated boosts across many tracks cause listening fatigue.

### Compression and Dynamics

- **Fast attack on presence-range instruments** (vocals, snare) tames perceived loudness spikes more effectively than on bass instruments
- **Bass compression** with slower attack preserves the transient that helps the ear "locate" the note — critical since the fundamental is in a low-sensitivity range
- **Sidechain filtering** on bus compressors: if the compressor is triggered by low-frequency content, it may pump on bass hits even though those hits don't sound that loud — use a sidechain HPF to make the compressor react to what the listener hears

### Monitoring Level Matters

Equal-loudness contours change shape at different SPL levels:
- **Low monitoring levels** (~65 dB SPL): Bass and treble perception drops off dramatically. Mixes balanced at low volume tend to have too much bass and treble when played loud.
- **Moderate levels** (~75-85 dB SPL): Best for critical balance decisions. The ear's response is most "flat" here.
- **Loud levels** (~90+ dB SPL): Perception flattens further, but ear fatigue sets in quickly. Not reliable for balance.

**Best practice**: Mix at a moderate, conversational level (~79 dB SPL is often cited). Check at low and high volumes occasionally, but make balance decisions at moderate levels.

## Volume-Dependent Perception (The "Loudness Button" Effect)

At lower playback volumes (casual listening, phone speakers):
- Bass nearly disappears
- Presence range dominates
- The mix sounds "thin" compared to studio monitoring

At higher playback volumes (club, concert):
- Bass becomes overwhelming
- Presence range can feel harsh
- The mix sounds "boomy" compared to studio monitoring

**Implication**: A well-balanced mix at moderate monitoring levels translates best across playback systems. Don't chase balance at extreme volumes.

## Frequency Masking and Perceived Loudness

Two instruments in the same frequency range don't just compete for spectral space — they mask each other's perceived loudness:

- **Kick + bass** competing at 60-120 Hz: Neither sounds as loud as it would solo. Use sidechain compression or frequency separation (kick at 60 Hz, bass at 100 Hz) so each is perceived clearly.
- **Vocals + guitars** competing at 1-4 kHz: Guitars mask vocal presence. Cut guitars 2-4 kHz or boost vocals there — a small EQ move has outsized perceptual impact because this is the sensitivity peak.
- **Multiple instruments in the mud zone** (200-500 Hz): Cumulative energy in a low-sensitivity range creates "mud" — the ear can't separate the sources. HPF everything that doesn't need this range.

## Quick Decision Guide

| Situation | Wrong Approach | Perceived-Loudness-Aware Approach |
|-----------|---------------|----------------------------------|
| Bass feels too quiet | Boost bass until meters match vocals | Boost bass 3-5 dB above vocal meter reading; verify by ear |
| Vocals feel buried | Boost vocal fader until it's the loudest meter | Check for 1-4 kHz masking from guitars/keys; small presence boost goes far |
| Cymbals are harsh | They're not even that loud on meters! | Trust your ears — high-sensitivity frequencies are perceived louder. Pull fader down 2-3 dB |
| Mix sounds thin | Boost everything below 200 Hz | Boost bass instruments specifically; check monitoring level (low volume exaggerates thinness) |
| Mix sounds muddy | Cut all low-mids on every track | Focus cuts on instruments that don't need 200-500 Hz; the ear needs significant cuts here to notice |
| Snare cracks through | But the meter says it's only -20 dBFS! | Normal — snare crack is at 2-5 kHz (peak sensitivity). It sounds right at lower meter readings |
