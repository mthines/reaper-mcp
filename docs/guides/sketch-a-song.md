---
title: Sketch a song from a hum or a few notes
nav: Sketch a song
summary: Hum or beatbox an idea and get the notes, the tempo and a band arrangement. Or have it write, quantize and humanize MIDI with you.
section: create
order: 1
keywords: compose composition write music melody hum humming beatbox midi chords key ideas ideation arrangement songwriting
poster: media/tools/insert_midi_notes.webp
duration: 4 min
---

Ideas arrive away from the computer, as a hummed line or a rhythm tapped on a table. The assistant turns them into something you can hear on real instruments, and then helps you push the sketch further.

## Say this

> say: Here's a voice memo of a melody I hummed, /Users/me/Desktop/idea.wav. Turn it into MIDI with a band behind it, then import it as new tracks.

Use a WAV file, not an m4a, and name the part with the music in it if there's talking at the start ("from 0.8 seconds").

## What happens

1. **It listens for notes.** It finds the pitches you hummed, the tempo and the key, and picks out any beatboxed hits as tentative drums.
2. **It proposes a band.** Drums that follow your kicks, a bass line, electric piano chords and the melody on vibraphone. The chords lean on the notes you actually sang.
3. **You decide what stays.** Nothing is written to your project until you say so. It saves a MIDI file and, if you like, short audio stems you can drop in right away.
4. **It imports the tracks.** Each part lands on its own named track, ready for you to swap in the instruments you own.

The intro, verse, chorus and outro are proposals, not something it detected in your recording. If the tempo comes out at half or double speed, tell it the BPM and it will redo it.

## Keep going from there

Once the notes are in REAPER, everything else is a sentence away:

> say: What key is this in, and what chords go under the chorus?

> say: Quantize the drums to the grid but keep a little swing, then humanize the bass velocities.

It can also bring in a `.mid` file you already have, transpose a part, lengthen notes to legato, or write a new line from your description. You can ask for a version in another key and keep both.

## You'll need

The audio add-on (Python) for the voice part. [Install](install.md) covers it. Writing, quantizing and importing MIDI needs nothing extra.

> your-call: The arrangement is a starting point, not a verdict. Keep the melody, throw the band away, or the other way round. It's your song.
