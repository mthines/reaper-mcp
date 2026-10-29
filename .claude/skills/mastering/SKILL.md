---
name: mastering
description: >
  Masters the mix bus in a live REAPER session — gentle corrective EQ, glue
  compression, and a true-peak limiter targeting a platform LUFS standard — while
  verifying against metering and preserving the mix's character. Use when the user
  asks to master, finalize, or prepare a track for Spotify/Apple/streaming or a
  specific loudness target. Triggers on "master this", "prepare for Spotify",
  "final master", "hit -14 LUFS", "/mastering".
argument-hint: '[platform or LUFS target]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - mastering
    - loudness
    - lufs
    - limiter
    - reaper
    - audio
---

# Mastering

Act as a mastering engineer working the mix bus in a **live** REAPER session via
the `reaper` MCP tools. Apply a transparent chain that hits a loudness standard
while preserving the mix's character.

**Mastering is subtle** — moves are fractions of a dB. If large corrections are
needed, tell the user the mix needs work first and consider `/mixer`.

## Targets

Default to **-14 LUFS, -1.0 dBTP** (safe for all streaming) unless the user names
a platform. Full target table: `reference/metering.md`.

## Memory

Per `reference/memory-protocol.md` — plugin knowledge and lessons in LoreKit
(scope `project::reaper-mcp`), in two layers: the read-only **built-in** layer and
the user's own `user::` layer on top. Reads combine both; writes go to `user::` keys only.
- **Before:** read the `loop::mixing-lessons` bucket (capped at 5 + one search on
  "mastering limiter loudness …") and, for your limiter/EQ/comp plugins, both
  `get_builtin_knowledge { key: "plugins::{vendor}/{plugin}" }` and `memory.read`
  of `user::plugins::{vendor}/{plugin}` — past
  targets the user preferred and known gotchas (the user record wins).
- **Unknown plugin?** Bootstrap it first (see protocol): dispatch the
  `plugin-researcher` agent (or follow its steps yourself), then read its
  `user::plugins::` record and use it.
- **At a correction point — write the lesson immediately, before your next
  action** (the user found your master too loud and you backed off; a re-measure
  missed the LUFS/true-peak target; you over-limited and lost crest). Non-
  negotiable (see Hard Rules); **say in chat that you captured it** (key +
  takeaway). A silent skip is a bug.
- **End-of-session retrospective (always, even on a clean master).** Before the
  final report, ask: did the user override a target/ceiling, did a measurement
  surprise me, did a lesson I had fail to fire? If anything surfaced, write or
  UPDATE a lesson (rewriting the same key bumps the store's `seen_count`). A
  lesson seen `>= 3×` is promotable to a Hard Rule via `/mix-memory promote`.
- **Durable facts:** also capture a verified limiter param map or a ceiling the
  user kept under the `user::plugins::` record's `## Learned notes`
  (read-merge-write; never write a built-in key). Name the key you wrote.

## Workflow

1. **Snapshot** — `snapshot_save { name: "pre-master" }`.
2. **Discover plugins** — `list_available_fx`; prefer limiter Pro-L 2 > ReaLimit,
   EQ Pro-Q 3 > ReaEQ (linear phase for mastering), comp Pro-C 2 > ReaComp. Check
   the LoreKit plugin records (built-in + `user::`) for settings; bootstrap any
   unknown plugin first.
3. **Assess the bus** — `analyze_track_offline { trackIndex: -1, startTime: 0,
   endTime: <song end>, sectionSeconds: 10 }`: integrated LUFS over the whole
   song (not a few seconds of meter), LRA, true peak, crest, loudest/quietest
   sections and band balance. With a reference song, add `referencePath` for the
   loudness and tonal-balance delta. Peak should be -6 to -3 dBFS (reduce the
   mix fader first if hotter); note distance from target LUFS and the dynamics.
4. **Corrective EQ** — gentle only. Typical: steep HPF 20–30 Hz; low shelf -0.5 to
   -1 dB @ 80 Hz; low-mid dip -0.5 to -1 dB @ 250–350 Hz; +0.5 dB presence @
   2–4 kHz only if needed; air shelf +0.5 to +1 dB @ 10–12 kHz. The 2–5 kHz range
   has outsized perceptual impact (`reference/perceived-loudness.md`). **If you're
   EQing more than ±2 dB, the mix has a problem — go back.**
5. **Glue compression** (optional) — only for cohesion: 1.5:1–2:1, slow attack
   30–80 ms, auto/200–500 ms release, **1–2 dB GR max**. More GR → fix the mix.
6. **Limiter** (last in chain) — ceiling -1.0 dBTP (streaming) or -0.3 (CD); raise
   input until integrated LUFS hits target; keep limiter GR under ~3 dB.
7. **Verify** — `analyze_track_offline` on the master over the whole song:
   integrated LUFS within 0.5 of target, true peak below the ceiling, LRA and
   crest genre-appropriate; `read_track_correlation` healthy (>0.3). To compare
   chain versions, `analyze_track_aesthetics` on the same 30 s range keeps the
   default level match (-18 LUFS), so the louder master does not win by level;
   PQ moves under ~0.1 are noise (`reference/aesthetics-scoring.md`).
8. **Report** — first run the **end-of-session retrospective** (Memory) and write
   any lesson it surfaces; then `snapshot_save { name: "master-v1" }` and report
   target vs achieved LUFS, true peak, crest, the chain + settings, any
   compromises, and **what you captured to memory (or that nothing was)**.

## Hard Rules

<!-- Promotion target: recurring mastering lessons graduate here via /mix-memory promote. -->

- **Capture the lesson at the correction point** — if the user overrides a
  target/ceiling or a re-measure misses, write the lesson before your next action
  and say you did. Never end a session that had a correction without a written
  lesson. (Invariant.)
- **Mastering is the final stage** — the mix should already be finished.
- **If the bus clips before you start, reduce it first** — don't just add a limiter.
- **Linear-phase EQ if available** — avoids phase shift on the master.
- **Always A/B with `snapshot_restore`** — mastering is subtle enough to fool you.
- **A balanced master slopes gently down** from lows to highs on the analyzer.
