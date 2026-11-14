---
title: Connect LoreKit so it remembers
nav: Connect LoreKit
summary: A free account, one key, one command. Then it keeps what it learns about your plugins and your taste.
section: start
order: 6
---

Out of the box, the assistant starts every conversation from scratch. [LoreKit](https://lorekit.io) is a free memory it reads before it works and writes to when it learns something. It's optional, but [`/learn-plugin`](teach-it-a-plugin.md) needs it, and it's how your corrections and favourite plugins carry over to the next song. [More on what it stores](it-remembers.md).

About five minutes.

## 1. Make an account

Go to [lorekit.io](https://lorekit.io) and sign in (GitHub, email, or a magic link).

## 2. Create a key

In LoreKit, open **Settings → API keys** and click **Generate new token** (LoreKit says token, this page says key: same thing).

- Name it something you'll recognise, like `reaper-mcp`.
- Pick **read + write**. The key starts with `lk_rw_`.
- Copy it now. LoreKit only shows it once (miss it and you just make another).

Treat it like a password. Never paste it into the chat with the assistant.

## 3. Add it to Claude Code

If Claude Code is running, leave it with `/exit` first. Then, in the terminal, paste this with your key in place of `lk_rw_YOUR_KEY`. It's one long line; paste it whole:

```bash
claude mcp add --transport http --scope user lorekit https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp --header "Authorization: Bearer lk_rw_YOUR_KEY"
```

`--scope user` matters: it makes the memory work whichever folder you start Claude Code in. LoreKit's own setup page shows a version that only works in one folder, so use this one.

Then start Claude Code again with `claude`.

::: details Using Cursor, Codex CLI or Gemini CLI instead

Add LoreKit to the app's **global** settings, not one project's, using the snippet LoreKit shows after sign-in. For Cursor that's `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "lorekit": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp", "--header", "Authorization:Bearer lk_rw_YOUR_KEY"]
    }
  }
}
```

Restart the app afterwards.

:::

## 4. Check it worked

In Claude Code, type `/mcp`. You should see both `reaper` and `lorekit` as connected. Then:

> say: /mix-memory status

The first time it uses memory, Claude Code asks permission. Choose **Yes, and don't ask again**. A fresh account has nothing of yours yet, so you'll only see the built-in plugin knowledge.

## 5. Teach it something

> say: /learn-plugin (the name of a plugin you use a lot)

Pick one that isn't on the [built-in list](https://github.com/mthines/reaper-mcp/blob/main/docs/PLUGINS.md) yet; it already knows those. [What happens next](teach-it-a-plugin.md).

## Optional: see your records in the status window

The status window's **Plugins** tab can show what it learned about your plugins. In LoreKit, create a second key, this time **read-only** (it starts with `lk_ro_`). In the status window, open **Settings → Your plugin knowledge** and paste it there. Only a read-only key goes in that box.

## Something's off?

- **`lorekit` isn't in `/mcp`.** Restart Claude Code. Still missing? Run `claude mcp list` in a terminal; if it's not there, repeat step 3.
- **It's listed but shows an error.** The key is wrong or was deleted. Make a new one, then run `claude mcp remove lorekit --scope user` and step 3 again.
- **Memory works in one folder but not another.** It was added per folder. Add it again with `--scope user`.
- **The assistant says it can't save.** Ask it to check `/mcp`. Without LoreKit, `/learn-plugin` has nowhere to put the record, and it will say so instead of pretending.
