# Perceived Loudness Reference

Human hearing does not perceive all frequencies equally. A bass note and a vocal at the same dB SPL sound like very different volumes. Every balance and EQ decision is made on **perceived** loudness, the level the listener hears, and never on raw meter values.

## The Rule: Perceived Values Only, Never Raw

| Decision | Measure with | Never with |
|----------|--------------|------------|
| Level of one track/bus against another (balance) | **Short-term LUFS** (`read_track_lufs`, `measure_tracks` with `lufs`), as **LU relative to the mix bus**, all read over the same section | Peak dBFS, RMS dBFS, fader positions on their own |
| Tonal balance, masking, "which band is too much" | **`kDb`** of `read_track_spectrum` / `measure_tracks` bands (K-weighted) | The band's raw `db`, raw FFT bins |
| Mix loudness against a target | Integrated LUFS over the whole song (`reference/metering.md`) | RMS |
| Headroom and clipping only | Peak / true-peak dBFS, `read_track_meters` | (allowed here: this is not a balance decision) |
| Dynamics only | Crest factor (peak minus RMS) | (allowed here) |

Why: a raw value counts every frequency equally, but the ear does not. Equal RMS on a bass and a vocal does not mean equal loudness, and raw band levels understate 2–5 kHz by ~4 dB against the low mids and overstate the deep lows by 4–10 dB (see the K-weighting table). Even a perceptual number can mislead when it is read wrong: in Emptiness (2026-10-29) a raw band table made the bass look fine while it sounded far too loud. The real cause was a changed EQ band, which only the ear and a parameter diff revealed.

Rules that follow from it:

1. **Same section, same window.** Compare LU only between readings taken over the same passage, ideally in one `measure_tracks` call. A chorus reading against a verse reading compares the arrangement, not the balance. Measure where every compared element is playing (check the regions first).
2. **Track meters are pre-fader.** The LUFS and spectrum meters sit in the track's FX chain, before the fader. A track's level in the mix is its reading **plus its fader (dB)**. A bus, which sums its children after their faders, reads them post-fader. Seen live: VOX at +5 dB read -10.4 LU against MIX A, so it really sat at -5.4 LU.
3. **A spectrum read is a ~0.5 s snapshot.** One band moves several dB with the note being played. Read 3 or more times across the section and judge the pattern, not one value.
4. **The ear wins.** When the user reports a balance by ear, that is the finding. Measurements size the fix and check it worked; they never overrule the report. If a measurement and the ear disagree, suspect the measurement first (a changed plugin parameter, a bypassed meter, a pre-fader reading, a different section).

## Reference Points

### K-weighting per 1/3-octave band

K-weighting is the ITU-R BS.1770 filter behind every LUFS reading: a high-pass that rolls off the deep lows plus a +4 dB shelf above ~1.5 kHz. The spectrum tools add these gains to each band's raw `db` to get `kDb` (`K_WEIGHT_DB` in `apps/reaper-mcp-server/src/tools/spectrum.ts`; keep both tables equal). Values are the filter's gain at the band centre, computed from the standard's 48 kHz coefficients.

| Band (Hz) | 25 | 31.5 | 40 | 50 | 63 | 80 | 100 | 125 | 160 | 200 | 250 | 315 | 400 | 500 | 630 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **K gain (dB)** | -10.4 | -7.8 | -5.6 | -3.9 | -2.7 | -1.7 | -1.1 | -0.7 | -0.4 | -0.3 | -0.2 | -0.1 | 0 | 0 | +0.1 |

| Band (Hz) | 800 | 1k | 1.25k | 1.6k | 2k | 2.5k | 3.15k | 4k | 5k | 6.3k | 8k | 10k | 12.5k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **K gain (dB)** | +0.3 | +0.7 | +1.3 | +2.3 | +3.1 | +3.6 | +3.8 | +4.0 | +4.0 | +4.0 | +4.0 | +4.0 | +4.0 | +4.0 |

So a 4 kHz band and a 100 Hz band with the same raw `db` differ by **5.1 dB** in `kDb`, and a 40 Hz band by **9.6 dB**.

K-weighting is a deliberately gentle model: it is nearly flat from 100 Hz to 1 kHz, while the ear at moderate levels is less sensitive at 100 Hz than that (see the equal-loudness section below). Two consequences:

- At the **same LU**, a bass-dominant source can still sound a little quieter than a mid-range one. Don't add a fixed correction for this. Place the element with the stem reference points below, then confirm by ear.
- At **low monitoring levels** the gap grows (bass drops out first). Make balance decisions at a moderate level (~75–85 dB SPL).

### Stem balance (dense rock / metal)

Starting points for short-term LUFS of each element (post-fader), in **LU below the mix bus**, read together over the densest section (chorus). They are working heuristics from mixing practice and the measured sessions below, not a published standard. They place an element; they are not a pass/fail target. Confirm by ear, and when the user settles a balance, record it as a `user::mixing-lessons::` lesson so the next mix starts from their taste.

| Element | LU below mix bus | Notes |
|---------|-----------------|-------|
| Lead vocal | -2 to -5 | The lead element sits closest to the mix level. In metal the vocal and the guitar bus are often within ~1–2 LU of each other |
| Rhythm guitars (bus) | -3 to -7 | Guitars ~2 LU or more above the vocal is the usual cause of "vocal too quiet, guitars too loud" |
| Drums (bus) | -5 to -9 | Snare and kick attack carry it. If the drums read under -10 LU, check the snare before the bus fader |
| Bass | -7 to -11 | Usually the lowest in LU yet still audible. A bass within ~3 LU of the guitars will sound heavy. Above -6 LU: check the low end before anything else |

Other genres: pop and hip-hop keep the lead vocal closest (-1 to -3 LU); in hip-hop and EDM the bass/808 can come up to the drums. Put a genre's own numbers in its `genres/{genre}.md` when they become known.

Measured data points (Emptiness, metal, 2026-10-29), LU below the MIX A bus, post-fader:

| Stage | Guitars | Vocal | Drums | Bass |
|-------|---------|-------|-------|------|
| Whole song, offline stem renders (ungated), before any change | -3.4 | -5.4 | -9.0 | -9.0 |
| Chorus 2 (208–222 s, live), after VOX +5 / GUITAR -1.5 | -3.6 | -5.4 | -8.6 | -8.7 |

By ear, the user first found the vocal too quiet and the guitars a bit loud, which matches the table: the guitars read above the vocal. After the +5 the vocal is still ~2 LU under the guitars in the chorus, because the guitars own 2–4 kHz (see masking below).

### Spectral checks on `kDb`

- **Compare a band only with the same band.** Compare one track's band with the same band on another track, or on a reference. Never compare one band with a different band in the same spectrum. K-weighting gives a correct broadband loudness, but it is not an equal-loudness curve per band. Also, 1/3-octave bands get wider towards the top, so a raw or K-weighted music spectrum often peaks at 60–125 Hz even in a well-balanced rock or metal mix. "The loudest band is the low end" is not, by itself, a finding.
- **Comparing to a reference.** Measure a reference track the same way: same section type, same `fftSize`, `kDb`, and both level-matched to the same short-term LUFS first. A difference of more than ~3 dB across 3 or more adjacent bands is a real tonal difference. One band alone is usually arrangement noise.
- **Masking between two tracks.** Compare their `kDb` in the contested band (kick/bass 60–125 Hz, bass/guitars 125–250 Hz, guitars/vocal 1–4 kHz), each with its fader added. The track that is more than ~3 dB higher there owns the band. To let the other one through, cut the owner there, or boost the other. Live example (Emptiness, chorus 2): the guitars read -41 to -45 `kDb` across 2–4 kHz, against the vocal's -57 to -64 (both with their faders added). The guitars own the vocal's presence range, so more vocal fader alone won't unbury it. Carve the guitars at 2–4 kHz (ideally a dynamic EQ keyed from the vocal) before raising the vocal further.
- **Analyzer slope.** A balanced mix's raw `db` bands slope downward from lows to highs. In `kDb` the slope is flatter, because the +4 dB shelf lifts the top. Never "flatten" either curve by EQ.

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

When setting or judging track balance:

1. **Read short-term LUFS for every element and the mix bus over the same section** (one `measure_tracks` call), and express each element as LU below the mix bus.
2. **Place each element against the stem reference points above**, starting with the lead element (usually the vocal), then guitars, drums, bass.
3. **Never match RMS or peak levels across tracks**, and never infer balance from fader positions. Raw levels make low-frequency instruments look louder than they sound and presence-range instruments look quieter.
4. **Move the fader by the LU difference you want.** 1 dB of fader is 1 LU for that element. Re-measure, then listen.
5. **Verify by ear.** The numbers place the element; the listener decides.

### Gain Staging Is Not Balance

Gain staging (`workflows/gain-staging.md`) sets each track's raw level (around -18 dBFS RMS, peaks below -6 dBFS) so plugins see a sensible input and the bus keeps headroom. This is the one place raw dBFS is the right measure, because it is about electrical headroom, not loudness. Don't use different raw targets per instrument to "pre-balance" the mix. Balance is a separate step, done afterwards in LU.

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
| Bass feels too quiet / too loud | Compare the bass RMS or raw bands with the other tracks | Read short-term LU of the bass vs the mix bus; place it against the stem reference points; check the low-end `kDb` |
| Vocals feel buried | Boost the vocal fader until it's the loudest meter | Compare the vocal LU with the guitars (guitars above the vocal = buried); check 1–4 kHz `kDb` masking from guitars/keys; a small presence move goes far |
| Cymbals are harsh | "They're not even that loud on meters!" | Read their 6–12 kHz `kDb`. The raw reading understates them by ~4 dB. Pull the fader or EQ there |
| Mix sounds thin | Boost everything below 200 Hz | Check bass and kick LU against the reference points, and the monitoring level (low volume exaggerates thinness) |
| Mix sounds muddy | Cut all low-mids on every track | Find which tracks lead the 200–500 Hz `kDb`; cut those. The ear needs bigger cuts here to notice |
| A change "measures fine" but the user says it sounds wrong | Defend the measurement | The ear wins. Diff plugin parameters against the before-snapshot and re-check the measurement setup |
