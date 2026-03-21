---
name: Hip-Hop
id: hip-hop
lufs_target: [-10, -7]
true_peak: -0.3
---

# Hip-Hop

Hip-hop mixes are bass-dominated, loud, and production-forward. The low end is the defining characteristic — 808 bass, deep kicks, and sub-heavy production must translate on club systems, car audio, and earbuds simultaneously. Vocals are punchy and present but sit within the production rather than floating above it as in pop. The mix is often very loud (LUFS -10 to -7) with heavy saturation keeping everything "glued" even at high loudness levels.

## Characteristics

- **Energy level**: Very high in the low end; controlled in mids
- **Frequency balance**: Bass-heavy; sub-dominant; vocals present but embedded in beat
- **Transients**: Heavy limiting, but 808 and kick transients preserved for punch
- **Reverb/space**: Dry on vocals (modern trap); spacious on lo-fi and boom-bap; minimal on mix
- **Stereo width**: Wide stereo pads and samples; mono sub bass is critical
- **Reference artists**: Drake, Kendrick Lamar, Travis Scott, J. Cole, Tyler the Creator

## EQ Approach

### Global HPF settings

| Instrument | HPF Frequency | Notes |
|------------|--------------|-------|
| Kick | 30–40 Hz | Preserve sub impact |
| 808 bass | 25–35 Hz | The sub IS the foundation — be careful |
| Snare/clap | 100–150 Hz | |
| Hi-hats | 400–800 Hz | Tight and crisp |
| Vocals (lead) | 80–100 Hz | |
| Samples/loops | 60–150 Hz | Depends on sample content |
| Synth pads | 80–150 Hz | |

### Frequency shaping targets

| Frequency Zone | Treatment | Why |
|----------------|-----------|-----|
| Sub 20–60 Hz | THIS IS THE GENRE — careful management, not removal | 808 and kick live here |
| Bass 60–250 Hz | 808 punch and warmth; kick thump; define the relationship | Critical — this is where hip-hop is felt |
| Low-mids 250–500 Hz | Aggressive cuts (-4 to -6 dB) on samples, pads | Create clarity for vocals and 808 |
| Mids 500 Hz–2 kHz | Vocal presence; sample midrange character | Balance vocal vs beat |
| Upper-mids 2–5 kHz | Vocal definition; hi-hat crispness | Clarity and articulation |
| Presence 5–8 kHz | Vocal air; hi-hat sizzle | Presence and definition |
| Air 8–20 kHz | Moderate — too much can sound thin | Controlled brightness |

808-specific: The 808's fundamental is typically 40–80 Hz; its harmonic content (160–300 Hz) carries the "note" on small speakers. Boost the harmonic zone (+2 to +3 dB) to ensure translation on phone speakers. Saturate lightly to add overtones. Keep mono below 80 Hz — check all bass elements mono.

Kick vs 808 relationship: Carve space for the kick in the 808 (cut 808 at 60–80 Hz slightly where kick lives) or vice versa. Use sidechain compression (kick triggers 808 compression) for the pumping effect characteristic of trap production.

## Compression

| Instrument | Style | Ratio | Attack | Release | GR Target | Notes |
|------------|-------|-------|--------|---------|-----------|-------|
| Kick | VCA/FET | 4:1–8:1 | 1–5 ms | 30–80 ms | 4–6 dB | Fast and punchy |
| 808 bass | VCA | 4:1–6:1 | 5–15 ms | 80–200 ms | 2–4 dB | Even output; preserve sub punch |
| 808 sidechain | — | — | — | — | — | Kick triggers 808 compression (3–8 dB GR, fast release) |
| Snare/clap | FET | 6:1–10:1 | 1–3 ms | 30–60 ms | 4–8 dB | Crisp and present |
| Hi-hats | Light VCA | 2:1–3:1 | 5–10 ms | 30–60 ms | 1–3 dB | Control velocity variation |
| Lead vocals | VCA then limiter | 4:1 | 8–12 ms | 50–80 ms | 5–8 dB | Heavy vocal comp for in-your-face sound |
| Mix bus | VCA + Limiter | 4:1 + brickwall | 10–20 ms | auto | 2–4 dB + ceiling | Loud mastering chain |

## Stereo Width

- **Sub/Bass below 80 Hz**: MONO — non-negotiable; phase issues on club systems are fatal
- **808 bass**: Mono fundamental, slight stereo on harmonic content only
- **Kick**: Center
- **Snare/Clap**: Center or narrow reverb tail
- **Hi-hats**: Wide (±60–80%); alternating hats create stereo movement
- **Samples/loops**: Often wide by nature; check mono compatibility
- **Lead vocals**: Center; heavily layered hip-hop has wide ad-libs (±60–80%)
- **Synth pads/melodics**: Wide — fills the stereo field behind the rap vocal
- **Reverb returns**: Wide, but controlled — modern trap is dry

## Common FX Chains

### Lead rap vocal (modern trap)

1. EQ — HPF 80 Hz, cut 200–350 Hz (-2 to -3 dB), boost 2–4 kHz (+1 dB), gentle top-end
2. De-esser — 7–9 kHz
3. VCA compressor — 4:1, 8 ms attack, 50 ms release, 6–8 dB GR
4. Limiter — hard limit at -3 to -6 dB below nominal — keeps vocal punchy
5. Saturation — subtle; adds grit and presence
6. Reverb send — small room or plate, short (0.8–1.5s), very dry in mix
7. Delay send — 1/8 note, filtered, very subtle

Dry vocal approach: Modern trap rap vocals are often very dry. Reverb may be minimal or only on ad-libs. Check reference tracks.

### 808 bass chain

1. EQ — HPF 30 Hz, boost 50–70 Hz (+2 dB), boost 160–250 Hz (+2–3 dB for small speaker translation)
2. Saturation — light tube sat to add harmonics; crucial for mono translation
3. VCA compressor — 4:1, 8 ms attack, 100 ms release, 2–4 dB GR
4. Mono sum below 80 Hz (use JS: M-S decode or Mid channel only below 80 Hz)
5. Sidechain input from kick for pumping effect

### Sample-based beat

- Sample: HPF 80–150 Hz, cut low-mids aggressively; high shelf boost if dull
- Trim high-end noise from sample — chops often contain vinyl hiss; HPF plus noise reduction
- Layer with original drums for punch; samples provide musical content

## What to Avoid

- Stereo bass below 80 Hz — this kills playback on club systems (mono summing collapses bass)
- 808 without saturation — it disappears on phone speakers and earbuds
- Too much reverb on lead vocals in modern trap — check reference tracks
- Under-loudness — hip-hop listeners expect loud competitive masters (-9 to -7 LUFS)
- Kick and 808 occupying the same exact frequency without sidechain relationship
- Harsh, uncontrolled hi-hats (2–5 kHz buildup from aggressive hat processing)
- Not checking on a car stereo — hip-hop is car audio music
