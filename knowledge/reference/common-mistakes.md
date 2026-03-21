# Common Mixing Mistakes

A checklist of the most common amateur mixing mistakes. The "roast my mix" analysis mode uses this list to identify problems in a session. Each item includes how to detect it and how to fix it.

## Checklist Format

Each mistake is listed with:
- **Symptom**: How it sounds / what the meters show
- **Detection**: What to check in REAPER (meter readings, spectrum, routing)
- **Fix**: Specific corrective action

---

## Category 1: Gain Staging Errors

### 1. No gain staging done

**Symptom**: Compressors are barely touching or are slammed; mix bus is clipping; everything sounds inconsistent in level.

**Detection**:
- Read track meters: if tracks average -6 dBFS or -30 dBFS, gain staging is off
- Read mix bus: if peaking at 0 dBFS with individual tracks, no headroom
- Look for compressors showing 0 dB GR (not triggered) or constantly in peak GR (slammed)

**Fix**: Run the gain-staging workflow. Target -18 dBFS average per track.

---

### 2. Tracks too hot going into compressors

**Symptom**: Compressors are constantly limiting, not compressing; everything sounds squashed; GR never recovers.

**Detection**:
- Track average above -12 dBFS before compressor
- Compressor GR constantly at max

**Fix**: Reduce fader or clip gain before the compressor. The compressor threshold should be set ABOVE the average signal level, only catching peaks.

---

### 3. Mix bus clipping

**Symptom**: Audible distortion on the loudest passages; peaks hit 0 dBFS or above on the master.

**Detection**:
- Master bus peak level at 0 dBFS
- Clip indicator lit on master bus or any bus

**Fix**: Reduce all tracks proportionally (select all, reduce faders by the excess dB) or reduce master fader. Do NOT add a limiter to cover up a clipping mix bus — fix the gain structure first.

---

## Category 2: EQ Mistakes

### 4. No high-pass filters on anything

**Symptom**: Mix sounds muddy, undefined, congested in the low end; sub-100 Hz is full of competing signals; no clarity.

**Detection**:
- Spectrum analysis on non-bass tracks: if there's energy below 80 Hz on vocals, guitars, pads
- No EQ or HPF visible in the FX chain of non-bass instruments
- Mix bus spectrum shows broad low-frequency buildup

**Fix**: Apply HPF to every non-bass instrument at appropriate frequencies (see reference/frequencies.md). This is the single most impactful corrective step in most amateur mixes.

---

### 5. Mud zone buildup (250–500 Hz)

**Symptom**: Mix sounds warm but foggy; instruments lose definition; mids feel congested; kick drum loses punch.

**Detection**:
- Mix bus spectrum shows a hump or plateau between 250–500 Hz
- Individual track spectrums all have significant energy in this zone

**Fix**: Cut -2 to -4 dB with a Bell filter at 300–400 Hz on ALL non-bass instruments (guitars, keys, pads, vocals). Small cuts on each instrument have a cumulative effect that clears the zone.

---

### 6. Harsh upper mids (2–5 kHz)

**Symptom**: Mix is fatiguing after 15–20 minutes; instruments sound thin and piercing rather than present; listener wants to turn it down.

**Detection**:
- Mix bus spectrum shows a peak or plateau in 2–5 kHz
- Listening fatigue within 20 minutes
- Specific culprits: distorted guitars, overheads, vocals with too much presence boost

**Fix**: Identify the culprit instrument (look for which individual track has the biggest 2–5 kHz peak). Cut 1–3 dB with a broad Bell (Q=0.8) in this zone on that instrument. On the master bus, a gentle -0.5 to -1 dB cut can provide relief if multiple instruments contribute.

---

### 7. Boosting instead of cutting

**Symptom**: EQ has many boosts; instruments all sound boosted but the mix still lacks clarity; mix is loud but not clear.

**Detection**:
- EQ plugins show mostly positive gain values
- Many tracks boosted in competing frequency zones

**Fix**: For every boost you make, ask if a cut somewhere else achieves the same result. "The bass sounds thin" often means the low-mids are too full on competing instruments, not that the bass needs boosting. Cut what's in the way before boosting what's missing.

---

### 8. Vocal not sitting in the mix (EQ-related)

**Symptom**: Vocal sounds great in isolation but disappears in the full mix; or vocal is too loud but still doesn't cut.

**Detection**:
- Compare solo vocal spectrum vs mix spectrum
- Look for frequency zones where guitars/synths compete with vocal (1–4 kHz)

**Fix**: Either carve guitars/keys around the vocal (reduce 2–4 kHz on competing instruments when vocal plays), or boost vocal presence (3–4 kHz, +1 to +2 dB Bell). Prefer the former — make space rather than making the vocal louder.

---

## Category 3: Compression Mistakes

### 9. Over-compression (killing dynamics)

**Symptom**: Mix sounds flat and lifeless; no excitement; kick has no punch; everything feels loud but not impactful; listener fatigue.

**Detection**:
- Crest factor on mix bus below 8 dB (peak level minus RMS level)
- Compressors all showing constant 8+ dB GR
- Low-pass temporal flatness — no quiet/loud contrast

**Fix**: Increase attack times on compressors (let more transient through); reduce ratio; increase threshold (less compression). Aim for crest factor of 10+ dB on rock/pop, 14+ dB on acoustic genres.

---

### 10. Attack time too fast on drums

**Symptom**: Drums have no punch or click; kick sounds muffled; snare has no crack; drums sound over-processed.

**Detection**:
- Check attack times on kick and snare compressors: if below 3–5 ms, it may be killing the transient
- Bypass the compressor and compare — if the kick sounds more punchy without the comp, the attack is too fast

**Fix**: Increase attack time until transient is restored. Kick: 2–5 ms minimum. Snare: 3–8 ms. Drum bus: 10–20 ms.

---

### 11. No parallel drum compression

**Symptom**: Drums lack power and impact in rock/metal/pop; they sound like they're in the mix but not driving it.

**Detection**:
- No parallel drum bus in the session routing
- Drum bus GR shows only 2–3 dB (not enough for impact)

**Fix**: Create a parallel drum bus, add heavy compression (20:1, fast attack), blend 30–50% into the main drum bus. This adds weight and energy without killing the natural transients.

---

### 12. Mix bus compressor GR too high

**Symptom**: Master bus compressor is doing 6+ dB GR constantly; mix sounds pumped and squashed.

**Detection**:
- Mix bus compressor GR constantly at 5–10 dB
- Audible pumping on the mix bus

**Fix**: The mix bus compressor should do 1–3 dB GR maximum. If it's doing more, the mix is too loud going into it (fix gain staging upstream) or the threshold is too low. This is a glue compressor, not a loudness tool.

---

## Category 4: Low-End Mistakes

### 13. Bass not in mono below 100 Hz

**Symptom**: Bass disappears or sounds wrong in mono; club playback has no bass; translations problems.

**Detection**:
- Sum mix to mono and compare: if bass disappears or changes character significantly, phase issues in sub bass
- Check if bass guitar or 808 is panned off-center
- Check if the bass track has stereo widening plugins

**Fix**: Ensure all bass instruments are centered (0% pan). Apply mid/side HPF on side channel at 100 Hz (removes stereo information below 100 Hz). This enforces mono bass without affecting the stereo image above 100 Hz.

---

### 14. Kick and bass fighting

**Symptom**: Low end sounds thick and undefined; kick loses punch when bass is playing; "waterbed" low end where everything moves together.

**Detection**:
- Solo kick and bass together: if they don't clearly lock with each instrument distinct, they're fighting
- Both occupy the same frequency zone (e.g., both peaked at 60–80 Hz on spectrum)

**Fix**: Frequency split — if kick peaks at 70 Hz, cut bass at 60–80 Hz; if bass peaks at 100 Hz, cut kick at 100 Hz. Alternatively, set up sidechain compression (kick triggers bass duck), especially in hip-hop, EDM, house.

---

### 15. Sub-frequency rumble (below 30 Hz)

**Symptom**: Mix feels heavy and sluggish; mix bus headroom seems to disappear; woofer cones moving without audible sound.

**Detection**:
- Spectrum analysis on mix bus shows energy below 30 Hz
- Mix bus peaking higher than expected despite individual tracks being controlled
- Inaudible low-frequency content eating headroom

**Fix**: Apply HPF at 25–30 Hz on the mix bus (and on bass instruments if their source has rumble). This is always appropriate — there is no musical content below 25 Hz in typical music.

---

## Category 5: Reverb/Delay Mistakes

### 16. Too much reverb everywhere

**Symptom**: Mix sounds washy, distant, and lacks definition; instruments blend into each other; mix loses its punchiness; sounds like everything is in a cave.

**Detection**:
- Check FX chains: reverb plugins visible on every individual track (not just sends)
- Long reverb tails on drums, bass, or close-mic elements
- Mix bus spectrum shows excessive mid-frequency content that shouldn't be there (wash)

**Fix**:
- Drums: Use very short room verbs (0.5–0.8s) or none on kick/bass
- Vocals: Route to a send/return reverb, not insert reverb; reduce wet level
- Bass: No reverb on bass — it blurs the low end
- Use pre-delay (20–30 ms) to separate dry signal from reverb onset

---

### 17. Reverb on bass instruments

**Symptom**: Bass guitar or kick drum sounds washy and undefined; low end loses punch.

**Detection**:
- Reverb plugin visible in kick or bass guitar FX chain
- Bass sounds "woofy" and undefined

**Fix**: Remove reverb from all low-frequency instruments. Bass and kick drum should be dry (or only the most subtle of very short room sounds). Reverb in low frequencies creates mud and loses the tight, punchy low-end response.

---

### 18. Reverb insert instead of send/return

**Symptom**: Reverb sounds phasey or exaggerated; or the reverb takes up too much space because the dry signal doubles through the reverb plugin.

**Detection**:
- Reverb plugin visible as an insert in the FX chain with both Dry and Wet signals
- Reverb sounds like an unnatural amount of space around the instrument

**Fix**: Set up reverb on a dedicated bus/send. The send carries a copy of the instrument to the reverb bus. The reverb bus has the reverb plugin with Dry at -inf dB (100% wet). Control the amount with the send level. This is the correct way to use reverb in a mix.

---

## Category 6: Mix Balance Mistakes

### 19. Vocals too quiet (buried in the mix)

**Symptom**: Listeners can't make out the words; vocal exists but doesn't command attention; mix sounds instrumental.

**Detection**:
- Read vocal track meters vs mix bus: if vocal peaks are 10+ dB below mix bus average, it's buried
- Check if competing instruments are louder than the vocal in the 1–4 kHz range

**Fix**: Increase vocal fader, then check the frequency competition (guitars, synths at 2–4 kHz competing with vocal). Carve EQ space in competing instruments before simply turning the vocal up.

---

### 20. No mono compatibility check

**Symptom**: Mix sounds great in stereo but some elements disappear in mono; bass changes character; width is "fake" (phase tricks rather than true stereo).

**Detection**:
- Sum to mono and compare: anything that disappears is phase-related
- Check stereo correlation meter: values below +0.5 indicate potential issues

**Fix**: Identify phase-causing elements (over-widened stereo, haas-effect doubling, stereo bass). Fix at the source. Run correlation meter during the session, not just at the end.

---

### 21. Everything the same loudness (no dynamics between sections)

**Symptom**: Verse and chorus feel the same energy level; no build or release in the arrangement; mix sounds flat across the song.

**Detection**:
- Read mix bus meters across the song: if chorus and verse peak levels are within 1–2 dB of each other, there's no dynamic contrast
- The arrangement may be densely filled throughout

**Fix**: Mix engineers create dynamics through level automation, FX density (more reverb in chorus, less in verse), and arrangement guidance (ask the producer if this is intentional). Verse averages 3–6 dB quieter than chorus is a starting point. Adjust automation on the mix bus or main buses to create contrast.

---

## Summary Checklist (Quick Audit)

The agent runs through this checklist when performing a mix analysis ("roast my mix"):

- [ ] Gain staging: all tracks averaging -18 dBFS before processing
- [ ] Mix bus headroom: peaks at -6 to -3 dBFS before limiting
- [ ] HPF applied to all non-bass instruments
- [ ] Mud zone (250–500 Hz) checked and managed
- [ ] Upper mid harshness (2–5 kHz) checked — no fatigue
- [ ] Bass is mono below 100 Hz
- [ ] Kick and bass relationship defined (no fighting)
- [ ] Sub rumble below 30 Hz controlled
- [ ] Crest factor above 8 dB on mix bus
- [ ] Drum bus compression: 3–5 dB GR, 10+ ms attack
- [ ] Reverb not on bass instruments
- [ ] Reverb routed as send/return (not insert on lead vocal)
- [ ] Vocal presence in 2–4 kHz not buried by other instruments
- [ ] Mono check passed (stereo correlation above +0.5)
- [ ] LUFS target within range for intended platform
