---
title: What it can do
summary: The kinds of things the assistant can do in REAPER, what each looks like in the status window, and how it can run almost any REAPER action.
section: know
order: 5
keywords: tools tool list features capabilities abilities commands actions macros scripts SWS what can it do supported menu reference
---

There are close to 190 tools behind the assistant, but you never pick one. You say what you want and it chooses. This page shows what's on the menu, so you know what to ask for, and what the status window draws when it does.

## What it can do

- **Tracks and plugins.** Add, name, colour, group and route tracks. Add plugins and set their parameters, copy a chain from one track to another, save chains and templates.
- **MIDI and editing.** Write, quantize and humanize notes. Split, move, trim and stretch audio. Copy a verse to the second chorus, open or close time across the whole project.
- **Automation.** Draw volume, pan and plugin envelopes, or build reusable automation items for section levels.
- **Listening.** Peak, loudness, spectrum, stereo width, masking between tracks, key and chords. It measures before and after, so "better" comes with a number.
- **Recording and finishing.** Arm tracks, set punch ranges, comp takes, render stems or a master.
- **Keeping track.** Snapshots you can flip between, plus markers, regions and tempo changes.

The full list, one line per tool, is in the [tool reference](https://github.com/mthines/reaper-mcp/blob/main/docs/TOOLS.md). A few tools need the audio add-on (Python): loudness curves, masking, stems. [Install](install.md) covers it.

## What it looks like

Every call the assistant makes shows up in the [status window](bridge-page.md) with a drawing of what changed. Here are some of them, as the demo shows them.

::: gallery What each kind of call draws
- ![A plan of four edits listed in order, marked as a dry run](media/tools/run_plan.webp) **A plan of edits**: several steps in one go, one undo. A dry run lists them and writes nothing.
- ![A plugin chain with ReaEQ and ReaComp marked as added](media/tools/setup_fx_chain.webp) **Plugin chains**: each slot marked added, moved or changed.
- ![A signal-flow diagram with sends and receives](media/tools/get_track_routing.webp) **Routing**: sends, receives and outputs as wires, thicker for louder.
- ![Plugin input pins wired to track channels](media/tools/get_fx_pins.webp) **Sidechain pins**: which track channels feed which plugin inputs.
- ![A piano roll with added notes in blue](media/tools/insert_midi_notes.webp) **MIDI notes**: a piano roll, new notes in blue, removed ones dashed.
- ![Audio hits pulled toward the grid](media/tools/quantize_audio.webp) **Audio quantize**: the hits before and after, and how far off the grid you were.
- ![Items on a lane with a split](media/tools/split_media_item.webp) **Item edits**: a lane per track, the items before dashed.
- ![A copied section on the timeline](media/tools/copy_section.webp) **Arrangement**: what was copied, where it went, and the automation that came along.
- ![Markers and regions on a timeline](media/tools/list_markers.webp) **Markers and regions**: the song's shape on one timeline.
- ![The tempo map](media/tools/get_tempo_map.webp) **Tempo**: every tempo and time signature change.
- ![An automation curve with new points](media/tools/insert_envelope_points.webp) **Automation curves**: the window the edit touched, before and after.
- ![Automation items as tinted blocks](media/tools/insert_automation_item.webp) **Automation items**: blocks tinted by pool, so shared curves are obvious.
- ![Peak and RMS meters per channel](media/tools/read_track_meters.webp) **Levels**: peak and RMS, with a warning near clipping.
- ![A 1/3-octave spectrum](media/tools/read_track_spectrum.webp) **Spectrum**: the balance, band by band.
- ![A loudness readout against a target](media/tools/read_track_lufs.webp) **Loudness**: LUFS against your target, with the last reading ghosted.
- ![Short-term loudness over time against a target line](media/tools/analyze_loudness_curve.webp) **Loudness curve**: where the song runs over target.
- ![A heat map of frequency overlap between two tracks](media/tools/measure_masking.webp) **Masking**: where two tracks fight, and which one should give.
- ![Loudness, range, true peak and band balance of a render](media/tools/analyze_track_offline.webp) **Offline analysis**: the whole song's numbers, no playback needed.
- ![Take lanes and the comp built from them](media/tools/comp_lanes.webp) **Comping**: which part of the comp came from which take.
- ![A render result with files, LUFS and true peak](media/tools/render_project.webp) **Renders**: each file's length, loudness and peak.
:::

## It can run almost any REAPER action

REAPER has about 6,000 actions: everything in the Actions list, the SWS extension, your own scripts, and the custom macros you've built. The assistant can search that list and run what it finds:

- **`search_actions`** finds actions by name ("normalize", "glue", "dynamic split").
- **`get_action`** shows one in detail, including the steps of one of your macros.
- **`run_action`** runs it.

So when there's no dedicated tool for something, it isn't a dead end. If REAPER can do it from a menu or a shortcut, the assistant can usually do it too, including the things you scripted yourself.

![Run a REAPER action, drawn in the status window](media/tools/run_action.webp)

> say: Find the action that does dynamic split, then run it on the selected drum item

> say: Run my "Prep for mixing" macro

A few things worth knowing:

- **Actions work on what's selected.** It selects the tracks or items first, then runs the action.
- **Your own actions have a stable name.** Their numbers change from session to session, so it remembers the named ID instead.
- **Anything that opens a dialog is refused**, because a dialog would freeze REAPER until someone clicked it. Quit, close project, open project and tab switching are always refused. It's one undo step, like everything else. See [undo and safety](undo-and-safety.md).
- **Some places have no way in.** The inline MIDI editor and the Media Explorer can't be driven by actions.

> your-call: If you'd normally reach for a menu, ask for it in words first. The assistant finds the action; you decide whether the result stays.
