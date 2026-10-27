# Mixing Lessons — Index

Process lessons the mix skills accumulate over time — "what to do better next
time" about the *mixing process* (not facts about your mix). Always read first;
≤ 200 lines. One pointer per lesson; details live in `entries/<date>-<slug>.md`.

This file is **versioned in the repo** — commit lessons to your fork so they
travel with you and (if you push) reach anyone who clones. The full contract,
lesson schema, entrenchment guards, and the promotion/self-heal flow are in
[`../../reference/memory-protocol.md`](../../reference/memory-protocol.md).

> Empty to start. The mix skills append a pointer here at correction points
> (a reverted change, a re-measure that got worse) and increment `seen_count`
> on recurrence. A lesson at `seen_count >= 3` is promotable to a hard rule via
> `/mix-memory promote`.

## Lessons

<!-- - [short title](entries/2026-06-28-slug.md) — one-line takeaway [seen:1] -->
- [Don't hard-clip a full drum bus for loudness](entries/2026-06-29-drum-bus-clip-buries-attack.md) — clipping ~3 dB off a full drum bus shaves kick/snare attack and buries the kit even at net-neutral RMS; keep bus clipping ≈1–1.5 dB or clip kick/snare individually [seen:1]
- [Reconcile REAPER 1-based vs MCP 0-based track numbers; verify target carries signal](entries/2026-06-29-reconcile-track-numbering-verify-signal.md) — confirm a user's track number by NAME (MCP index is off-by-one), meter a child not the folder parent, and trust the user's ears over repeated bad measurements [seen:1]
