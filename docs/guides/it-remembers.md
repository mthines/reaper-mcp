---
title: It remembers how you work
nav: How it remembers
summary: What LoreKit is, what the assistant saves in it, and how to see or clear it.
section: know
order: 2
---

An assistant that forgets everything between sessions is a lot of re-explaining. That's what [LoreKit](https://lorekit.io) fixes: a free, simple memory the assistant reads from and writes to. Not connected yet? [Five minutes, here's how](connect-lorekit.md).

## What it remembers

- **Plugins.** How a plugin behaves and the settings that tend to work, from [`/learn-plugin`](teach-it-a-plugin.md) or from the first time it meets one.
- **Lessons.** Things that went wrong, or that you corrected. "This singer's sibilance peaks around 7 kHz." "I never want the master limiter above -1 dB." A lesson that keeps coming up becomes a permanent rule, so it stops making that mistake.

## Two layers

- **Built in.** Shared knowledge about common plugins and mixing lessons, curated and read-only. It comes with reaper-mcp and works without a LoreKit account. [The list](https://github.com/mthines/reaper-mcp/blob/main/docs/PLUGINS.md).
- **Yours.** Everything it learns from you. When the two disagree, yours wins, so your taste never gets overwritten.

Your layer isn't tied to one project folder. Whatever song you open, it brings what it knows.

## What it doesn't do

It isn't watching your audio or your files. It stores short notes written in words, and keeps out client names, song titles and license keys.

## Seeing and tidying it

> say: /mix-memory status

Other options: `recall` (what's relevant now), `consolidate` (merge duplicates), `promote` (turn a lesson into a rule). You can also browse and delete records on [lorekit.io](https://lorekit.io), under your account.

## Without it

Everything still works. Genre conventions, workflows and the built-in plugin knowledge are there either way. It just starts fresh every conversation, and `/learn-plugin` has nowhere to save.
