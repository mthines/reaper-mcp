---
title: Set up your AI app
nav: Set up your AI app
summary: Never used Claude Code or a terminal? Pick an AI app, install it, sign in, and learn the four things you'll actually use.
section: start
order: 3
---

reaper-mcp is only the connector. The thinking happens in an AI app you chat with, and this page gets that app ready from nothing. Already use Claude Code? Skip to [Install](install.md).

## Pick your app

reaper-mcp works with these four. Each card links the app's own install page and its page about MCP, the standard reaper-mcp uses to plug in. Those pages always have the current install steps, so follow them rather than a copy here.

::: gallery Apps that work with reaper-mcp

- **Claude Code**: the recommended one. reaper-mcp is built and tested around it, and `/mixer`, `/critique` and `/learn-plugin` are written for it. [Setup](https://code.claude.com/docs/en/setup) · [MCP docs](https://code.claude.com/docs/en/mcp)
- **Codex CLI**: OpenAI's terminal app. It connects, but gets less testing. [Setup](https://developers.openai.com/codex/cli) · [MCP docs](https://developers.openai.com/codex/mcp)
- **Gemini CLI**: Google's terminal app. It connects, but gets less testing. [Setup](https://github.com/google-gemini/gemini-cli) · [MCP docs](https://geminicli.com/docs/tools/mcp-server/)
- **Cursor**: a code editor with a chat built in. It connects, but gets less testing. [Setup](https://cursor.com/download) · [MCP docs](https://cursor.com/docs/context/mcp)

:::

You don't have to add reaper-mcp by hand in any of them: `reaper-mcp init` finds the ones you have installed and connects itself. For Claude Code you need a Claude plan that includes it (Pro or above), or an Anthropic API account that bills you by usage.

The rest of this page uses Claude Code.

## Open a terminal

A terminal is a window where you type commands instead of clicking.

- **Mac:** press Cmd+Space, type `Terminal`, press Enter.
- **Windows:** open the Start menu, type `PowerShell`, press Enter.

You paste a command, press Enter, and wait for it to finish. That's the whole skill. Run the install command from your app's Setup page here, then close the terminal and open a new one so it finds the new command.

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
