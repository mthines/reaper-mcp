---
title: It remembers how you work
nav: How it remembers
summary: What LoreKit is, what the assistant saves in it, and how to see or clear it.
section: know
order: 2
---

Without a memory, you'd explain your plugins and habits again every session. [LoreKit](https://lorekit.io) is a free memory the assistant reads before it works and adds to when it learns something. Not connected yet? [It takes five minutes](connect-lorekit.md).

## What it remembers

- **Plugins.** How a plugin behaves and the settings that tend to work, from [`/learn-plugin`](teach-it-a-plugin.md) or from the first time it meets one.
- **Lessons.** Things that went wrong, or that you corrected: "I never want the master limiter above -1 dB", "on this kind of vocal, de-ess before the compressor". A lesson that stops coming up fades after about three months. One that keeps coming up, it offers to turn into a permanent rule, so it stops making that mistake.

Each thing it saves is a short note, called a record: one per plugin, one per lesson.

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
