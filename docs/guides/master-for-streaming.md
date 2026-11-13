---
title: Finish a master for streaming
nav: Master for streaming
summary: Give it a loudness target for Spotify or Apple, and it finishes the master bus and checks the result.
section: try
order: 7
image: media/loudness.png
---

Mastering here means the last steps on the master bus: a gentle corrective EQ, some glue compression, and a limiter that stops peaks while hitting a loudness target. `/mastering` does those and verifies each against the meters.

## Say this

> say: /mastering Prepare this for Spotify

Or give it a number: `/mastering hit -14 LUFS`.

## What happens

1. **It measures the mix as it is**: integrated loudness, peaks, dynamics, stereo width.
2. **It adds the chain** on the master, one step at a time, with small moves.
3. **It measures again** against your target and the platform's usual rules, including true peak, so streaming services don't clip it on conversion.
4. **It reports the numbers**, and the snapshots let you flip between before and after.

## A few things worth knowing

- **LUFS** is a loudness measure that follows how loud something *sounds* over the whole song. Streaming services turn loud tracks down, so chasing "louder" past the target mostly costs you dynamics. Check the [glossary](glossary.md).
- **It won't make a weak mix strong.** If the problem is in the mix, it'll say so rather than hide it with a limiter.
- **Check the ending too.** Loudness is averaged over the song, so ask it to look at the quietest and loudest sections.

> your-call: The target is a number, but "loud enough" is a taste call. If the master feels squashed to you, ask it to back off the limiter.
