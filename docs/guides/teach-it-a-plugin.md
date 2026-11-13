---
title: Teach it a plugin you own
nav: Teach it your plugins
summary: Have it research a plugin, test it live in REAPER, and remember how it behaves for next time.
section: try
order: 8
image: media/spectrum.png
---

The assistant works with any plugin REAPER can load, but it works *better* with ones it knows. `/learn-plugin` teaches it one, or a list.

## Say this

> say: /learn-plugin FabFilter Pro-Q 3

Or a few at once: `/learn-plugin Pro-Q 3, Pro-C 2, Valhalla Room`.

## What happens

1. **It reads up on the plugin** on the web, and finds what it's for and how people use it.
2. **It loads it on a scratch track** and tries its controls, so it knows what each one actually does.
3. **It only asks what it couldn't work out**, such as how *you* like to use it.
4. **It saves what it learned**, to your own memory in [LoreKit](it-remembers.md). Next time you ask for "a vocal chain", it can reach for this plugin in the right way.

The scratch track is removed afterwards. Your project is left as it was.

## Which plugins does it already know?

There's a [built-in list](https://github.com/mthines/reaper-mcp/blob/main/docs/PLUGINS.md). It researches the rest on its own the first time it needs one.

> your-call: What it learns is saved under your name, and you can see or tidy it any time with `/mix-memory`.
