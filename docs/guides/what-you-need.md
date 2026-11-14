---
title: What you need
nav: What you need
summary: REAPER, an AI app to talk to, and Node.js. A short shopping list, with what each one is for.
section: start
order: 2
---

Four things, and you probably have one of them already.

| | What it is | Why you need it |
|---|---|---|
| **REAPER** | Your DAW, version 6 or newer (7 recommended). | It's the thing being controlled. [reaper.fm](https://www.reaper.fm/) |
| **An AI app** | The chat you type to. Claude Code is the one reaper-mcp is built and tested around. Codex CLI, Gemini CLI and Cursor connect too. New to it? [Set it up](set-up-your-ai-app.md). | This is where the "assistant" part lives. reaper-mcp brings no AI of its own. |
| **Node.js 20+** | A small program that runs quietly in the background. | It runs the connector between the AI app and REAPER. [nodejs.org](https://nodejs.org/) |
| **LoreKit** *(recommended)* | A free memory for the assistant. You can add it after the rest works. | It's how the assistant remembers what it learned about your plugins and the way you like to work. [How to connect it](connect-lorekit.md) |

SWS Extensions are optional. They give REAPER a few extra powers, and plenty of people never need them.

## What does it cost?

reaper-mcp is free and open source, and so is LoreKit. You need REAPER (it has an evaluation period and an inexpensive license) and an AI app plan that lets you use it. That's the one bill you may not have yet, so check what yours includes before you start.

## Do I need to know how to code?

No. You paste a few commands once, and after that you type in normal sentences. If you've never opened a terminal, [Set up your AI app](set-up-your-ai-app.md) starts from there.

## The whole path

1. [Set up your AI app](set-up-your-ai-app.md) (skip it if you use Claude Code already)
2. [Install reaper-mcp](install.md)
3. [Your first conversation](first-conversation.md)
4. [Connect LoreKit](connect-lorekit.md), so it remembers
5. [Teach it your plugins](teach-it-a-plugin.md)
