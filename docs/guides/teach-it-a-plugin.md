---
title: Teach it a plugin you own
nav: Teach it your plugins
summary: Have it research a plugin, test it live in REAPER, and remember how it behaves for next time.
section: try
order: 8
image: media/spectrum.png
---

The assistant can use any plugin REAPER can load, but it uses the ones it knows *well*. `/learn-plugin` is how it gets to know one: it does its homework, tries the controls, then asks you the few things only you can answer.

## You'll need

- **[LoreKit connected](connect-lorekit.md).** That's where the result is saved. Without it, the assistant offers to walk you through connecting, and stops if you'd rather not.
- **REAPER open with a project**, and a green light in the status window. Any project will do.
- **The plugin installed**, so it shows up in REAPER's FX browser.

It already knows the plugins on the [built-in list](https://github.com/mthines/reaper-mcp/blob/main/docs/PLUGINS.md). Teach one of those again only to tell it how *you* use it.

## Say this

> say: /learn-plugin Soothe2

Or a few at once: `/learn-plugin Soothe2, Decapitator, Kotelnikov`. They're researched side by side.

## What happens

1. **It reads up** on the web: what the plugin is for, what each control does, how people set it.
2. **It tries it out.** It adds a scratch track called `[MCP] plugin-research …`, loads the plugin there and moves the controls, so it knows what they really do in REAPER. Then it deletes the track. Your own tracks aren't touched.
3. **It asks what it couldn't work out**, usually a question or two: how much you like the plugin (0 to 100, so it knows when to reach for it) and how you tend to use it. Its best guess is marked **(keep)**, so you can just accept.
4. **It saves what it learned** to your memory and shows a short "How it works" summary.

A plugin takes a few minutes, most of it reading.

> your-call: The research says how most people use a plugin. Your answers say how *you* do, and yours win. If it thinks your favourite compressor is a drum thing and you only use it on vocals, say so.

## From then on

Ask `/mixer` for a vocal chain and it reaches for your best-liked plugin of the right kind, with settings that suit it, and adds notes as it goes. A plugin it has never met gets researched the first time it's needed anyway, so `/learn-plugin` is for getting ahead, or for telling it your taste.

Changed your mind? Run it again, or just tell it: "I prefer Pro-C 2 over ReaComp for vocals."

To see what it knows, say `/mix-memory status`. What it saves never includes song or client names.

## Share it with everyone

Proud of a record? Once you've [added a read-only key](connect-lorekit.md#optional-see-your-records-in-the-status-window), the status window's **Plugins** tab shows a **Contribute** button. It opens a pull request on GitHub (a free account does it), and once it's approved, every reaper-mcp user gets your plugin built in.

## If something's off

- **"I can't save that."** LoreKit isn't connected. [Connect it](connect-lorekit.md) and run it again.
- **It can't find the plugin.** Use the name exactly as REAPER's FX browser shows it.
- **REAPER stutters for a moment.** That's a heavy plugin loading on the scratch track. It passes.
