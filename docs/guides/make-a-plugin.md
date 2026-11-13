---
title: Make your own plugin
nav: Make your own plugin
summary: Describe an effect and get a real REAPER plugin, with knobs, that keeps working without the assistant.
section: try
order: 4
poster: media/make-plugin.webp
duration: 4 min
---

Ever wanted an effect that doesn't exist? "A trance gate", "keep my bass mono", "a multiband compressor where I can drag the bands on the spectrum". Describe it, and `/make-plugin` builds it.

## What you get

A normal REAPER plugin (written in JSFX, REAPER's own plugin language) with knobs and a small interface. Once it's made, it's just a plugin: it works with no assistant, no connector, no browser. You can keep it, share it, or ask for changes later.

![A generated multiband compressor: drag each band on the spectrum to set threshold and gain](media/multiband-compressor.png)

## Say this

> say: /make-plugin a step sequencer for my drums

Or: `/make-plugin a multiband compressor`, or `/make-plugin keep everything below 120 Hz in mono`.

## What happens

1. **It shrinks the idea** to the smallest plugin that does the job, so you get a handful of knobs rather than 40.
2. **It writes the plugin**, with the main controls in front and the extras under an **Advanced** drawer.
3. **It loads it on a scratch track** and checks it by measurement that it does what you asked.
4. **It fixes what the checks find**, a few rounds if needed.
5. **It hands it over**, loaded and ready.

The newest version can also build eight playable drum pads, or a step sequencer where you draw notes like in REAPER's MIDI editor.

![A step sequencer plugin: six drum lanes, a 16th-note pattern, length and feel buttons](media/step-sequencer.webp)

## Changing it later

> say: /make-plugin update my step sequencer: add swing

Your saved presets and automation keep working, unless you agree to a breaking change.

## If something's off

- **It doesn't show up in your FX list.** A brand new plugin can need a rescan. Ask the assistant to add it by name.
- **It sounds nothing like what you meant.** Describe the sound, not the technique: "gritty like a tape machine, but only on the highs".

> your-call: It builds what you described. If it isn't *the sound*, that's a description problem as much as a code one, so keep iterating.

::: details Transcript

The transcript is added here after the video is recorded.

:::
