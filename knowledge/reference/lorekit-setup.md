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

The user-facing version of these steps is https://reaper-mcp.vercel.app/docs/connect-lorekit
(`docs/guides/connect-lorekit.md`). Link it, then walk through it one step at a time:

1. **Make a free account** at https://lorekit.io (GitHub, email or magic link).
2. **Create a key**: in LoreKit, **Settings → API keys → Generate new token**, named e.g.
   `reaper-mcp`, permission **read + write** (starts with `lk_rw_`). It is shown once, so
   they copy it now.
3. **Add it to Claude Code at user scope**, in a terminal (not inside this chat), with their
   key in place of `lk_rw_YOUR_KEY`:

   ```bash
   claude mcp add --transport http --scope user lorekit https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp --header "Authorization: Bearer lk_rw_YOUR_KEY"
   ```

   `--scope user` is the point: the mix skills run from whatever folder Claude Code was
   opened in, so a per-folder `.mcp.json` (what LoreKit's own setup page shows) only works
   in that folder. Other apps (Cursor, Codex CLI, Gemini CLI): the snippet from LoreKit's
   site, in the app's **global** config.
4. **Restart Claude Code.** `/mcp` should list `lorekit` as connected. The first memory call
   asks permission; "Yes, and don't ask again" is fine.
5. **Run the original request again** (for example `/learn-plugin <plugin>`).

Already connected but failing? `lorekit` missing from `/mcp` in this folder but present in
another means it was added per folder: add it again with `--scope user`. Listed with an
error usually means a deleted or mistyped key: `claude mcp remove lorekit --scope user`,
then step 3 with a new key.

## Rules for you

- Offer to wait while they do it; do not carry on pretending the memory exists.
- If they would rather skip it: skills that only read memory continue with the built-in
  knowledge and say so once. `/learn-plugin` and `/mix-memory` have nothing to save to
  without LoreKit, so say that plainly and stop; do not write the record anywhere else.
- Never ask for, store or repeat their LoreKit token in chat.
