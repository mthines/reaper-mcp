---
title: Set up your AI app
nav: Set up your AI app
summary: Never used Claude Code or a terminal? Install it, sign in, and learn the four things you'll actually use.
section: start
order: 3
---

reaper-mcp is only the connector. The thinking happens in an AI app you chat with, and this page gets that app ready from nothing. Already use Claude Code? Skip to [Install](install.md).

## Which app?

**Claude Code.** It's the one reaper-mcp is built and tested around, and the `/mixer`, `/critique` and `/learn-plugin` commands are written for it. Codex CLI, Gemini CLI and Cursor connect too, but they get less testing.

You need a Claude plan that includes Claude Code (Pro or above), or an Anthropic API account that bills you by usage. Check what yours includes before you start.

## Open a terminal

A terminal is a window where you type commands instead of clicking.

- **Mac:** press Cmd+Space, type `Terminal`, press Enter.
- **Windows:** open the Start menu, type `PowerShell`, press Enter.

You paste a command, press Enter, and wait for it to finish. That's the whole skill.

## Install Claude Code

On a Mac, paste this:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Then close the terminal and open a new one, so it can find the `claude` command. If anything goes differently, Anthropic's [quickstart](https://code.claude.com/docs/en/quickstart) has the current steps.

## Sign in

Type `claude` and press Enter. The first time, it opens your browser to sign in. Afterwards you're in a chat, right there in the terminal.

It doesn't matter which folder you start it in. It talks to REAPER directly, not to your project file, so your song folder is as good a place as any.

## The four things you'll use

1. **Plain sentences.** Type what you want, press Enter. "Which track is clipping?" works.
2. **Slash commands.** A line starting with `/` starts one of reaper-mcp's ready-made jobs: `/mixer`, `/critique`, `/learn-plugin`. Type `/` to see the list.
3. **Permission questions.** Before it uses a new tool, Claude Code asks. reaper-mcp pre-approves its own REAPER tools, so you'll mostly see this for other things, like memory. Choose **Yes, and don't ask again** for tools you trust.
4. **`/mcp`.** Lists the connections Claude Code has. After you install, `reaper` should be there, and `lorekit` once you add memory.

To leave, type `/exit` or press Ctrl+C twice. To pick up where you left off later, run `claude --continue`.

## Next

That's the AI side done. Now [install reaper-mcp](install.md) so it can reach REAPER.
