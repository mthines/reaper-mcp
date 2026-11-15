---
title: Flash your lights to the music
nav: Light show from the song
summary: It finds the kicks, snares and accents in a song and writes them as automation, so lights, video or anything else can follow the hits.
section: create
order: 2
keywords: lighting lights dmx show transients hits drums kick snare automation envelope sync visuals video
duration: 4 min
---

Programming a light show by hand means scrubbing through the song and drawing a point for every kick. The assistant listens for the hits and draws them.

## Say this

> say: Find the kick and snare hits in my drum bus and write them as flashes on a new muted track. Show me the points first.

## What happens

1. **It finds the hits.** For each one you get the time, how hard it was, and whether it was low (kick), mid (snare) or high (hats). It also reports the tempo it hears and how busy each section is.
2. **It shows you the plan.** A dry run lists the points it would write, and nothing in your project changes.
3. **It writes the pulses.** Each hit becomes a short rise, a hold and a decay, scaled by how hard the hit was. They land on an envelope of a new track, muted, so nothing drives your rig until you unmute it.
4. **It checks the sections.** A sustained chorus has few hits and looks dull as flashes, so it suggests steady brightness there instead.

## Make it fit your rig

Say what your lights are: a ReaControlMIDI track, a DMX plugin, a video cue. It copies your existing light plugin onto the new track so the channel and CC mapping match. You can also ask for different jobs:

> say: Flash only on the big accents in the full mix, longer decay.

> say: Add a marker on every hit in the chorus.

Use a track in your project rather than the audio file when you can. A track is read as it plays, with any warping applied, so the hits line up with what you hear.

## You'll need

The audio add-on (Python) for the hit detection. [Install](install.md) covers it.

> your-call: Tell it what the lights should feel like, then watch the result against the song. If it flashes too much, say "fewer, only the loud ones".
