# Connecting LoreKit (so the mix skills can remember)

Read this when a skill needs LoreKit and the `memory.*` tools are not there. The person
you are talking to is most likely a musician, not a developer: use plain words, one step
at a time, and never paste commands without saying what they do.

## What it is, in one breath

LoreKit is a free memory for AI assistants. With it connected, the mixer remembers every
plugin it has learned and every correction you gave it, in every project. Without it,
everything still works, it just starts from zero each session. The built-in plugin
library needs no account.

## How to tell if it is connected

The tools whose names start with `memory.` (or `mcp__lorekit__memory_`) are available in
this session. If you cannot see any, it is not connected (or Claude Code has not been
restarted since it was).

## Walk the user through it

1. **Make a free account** at https://lorekit.io (sign-in takes a minute).
2. **Copy the connection details** LoreKit shows after sign-in. It gives you either a
   one-line command to paste into Terminal, or a small settings snippet. Use exactly
   what the site shows; do not guess a URL or token.
3. **Restart Claude Code** (close it and open it again), so it picks the connection up.
   Typing `/mcp` should list `lorekit` as connected.
4. **Run the original request again** (for example `/learn-plugin <plugin>`).

## Rules for you

- Offer to wait while they do it; do not carry on pretending the memory exists.
- If they would rather skip it: skills that only read memory continue with the built-in
  knowledge and say so once. `/learn-plugin` and `/mix-memory` have nothing to save to
  without LoreKit, so say that plainly and stop; do not write the record anywhere else.
- Never ask for, store or repeat their LoreKit token in chat.
