---
title: Teach it a plugin you own
nav: Teach it your plugins
summary: Have it research a plugin, test it live in REAPER, and remember how it behaves for next time.
section: try
order: 8
image: media/spectrum.png
---

The assistant works with any plugin REAPER can load, but it works *better* with ones it knows. `/learn-plugin` teaches it one, or a list.

## Before you start

- **[LoreKit is connected](connect-lorekit.md).** That's where the result is saved. Without it, the assistant offers to walk you through connecting, and stops if you'd rather not: there's nowhere to keep what it learned.
- **REAPER is open with a project**, and the status window shows a green light. Any project will do; it doesn't touch your tracks.
- **The plugin is installed** and shows up in REAPER's FX browser.
- **Check the [built-in list](https://github.com/mthines/reaper-mcp/blob/main/docs/PLUGINS.md).** It already knows those. Teach it again only to add how *you* use one.

## Say this

> say: /learn-plugin Soothe2

Or a few at once: `/learn-plugin Soothe2, Decapitator, Kotelnikov`. They're researched side by side.

## What happens

1. **It reads up on the plugin** on the web: what it's for, what each control does, how people set it.
2. **It adds a scratch track** called `[MCP] plugin-research …`, loads the plugin there and tries its controls, so it knows what they really do in REAPER. Heavy plugins can make REAPER lag for a moment.
3. **It removes the scratch track.** Your project is left as it was.
4. **It asks only what it couldn't work out**, as a short multiple-choice question or two. Usually how much you like the plugin (a 0 to 100 preference, so it knows when to pick it) and how you tend to use it. Each question has its researched answer marked **(keep)**, so you can just accept.
5. **It saves the record** to your own layer in LoreKit and shows a short "How it works" summary.

A single plugin takes a few minutes, most of it research.

## Check it saved

> say: /mix-memory status

Your plugin shows up under your own layer. The status window's **Plugins** tab can show it too, once you've [added a read-only key](connect-lorekit.md#optional-see-your-records-in-the-status-window).

## From then on

When you ask `/mixer` for something like a vocal chain, it reaches for your best-liked installed plugin of the right kind, with settings that suit it. It adds notes to the record as it works with it. A plugin it has never met gets researched automatically the first time it's needed, so `/learn-plugin` is for getting ahead, or for telling it how you like things.

Changed your mind about a plugin? Run `/learn-plugin` on it again, or just tell it: "I prefer Pro-C 2 over ReaComp for vocals."

## Share it with everyone

Proud of a record? With the [read-only key](connect-lorekit.md#optional-see-your-records-in-the-status-window) added, the status window's **Plugins** tab shows a **Contribute** button once you have records of your own. It opens a pull request on GitHub (you'll need a free GitHub account), and once the maintainer approves it, every reaper-mcp user gets it built in.

> your-call: What it learns is saved under your account and never includes song or client names. See or tidy it any time with `/mix-memory`.
