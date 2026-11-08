# REAPER Concepts

Plain-language explanations of the REAPER ideas the agent touches, for someone new to REAPER. `/teach` links an
entry here every time it makes a change (`reference/teaching.md`). Each entry has:

- **What it is**: two lines, no jargon left unexplained.
- **By hand**: where it lives in REAPER's default layout. Shortcuts are left out on purpose: users rebind them, so
  the agent looks up the live one with `search_actions` / `get_action` (they return each action's shortcuts).
- **Tools**: the MCP tools that act on it.
- **Learn more**: a search term for the official REAPER User Guide (<https://www.reaper.fm/userguide.php>, also
  under Help in REAPER). Page and chapter numbers change between REAPER versions, so search the PDF for the term.
  Official video tutorials: <https://www.reaper.fm/videos.php>.

Link an entry as `reference/reaper-concepts.md#<heading slug>` (the heading, lowercased, spaces as `-`).
Add an entry here before `/teach` needs one; never link a REAPER page that is not listed in this file.

## Project

**What it is:** the song: every track, item, FX setting and automation, saved as one `.rpp` file. Audio files stay
in the project's media folder; the `.rpp` points to them.
**By hand:** File menu (save, save as, project settings).
**Tools:** `get_project_info`, `save_project`, `get_project_settings`, `set_project_settings`.
**Learn more:** search the User Guide for `project settings`.

## Track

**What it is:** one lane that holds audio or MIDI items, its own FX chain, a volume fader and pan. Unlike some DAWs,
a REAPER track is not "audio" or "MIDI": any track can hold either.
**By hand:** double-click the empty area below the last track to add one; the track's controls sit on its left
(the track control panel, TCP) and in the Mixer window.
**Tools:** `list_tracks`, `add_track`, `delete_track`, `move_track`, `set_track_info`.
**Learn more:** search the User Guide for `track control panel`.

## Folder track

**What it is:** a track that holds other tracks. The children's audio flows into the folder, so the folder works as
a bus: one fader and one FX chain for the whole group (all drums, all vocals).
**By hand:** the folder icon on the track panel (click it on the track that should hold the ones below it).
**Tools:** `set_track_folder`, `list_tracks` (`parent`).
**Learn more:** search the User Guide for `folder`.

## Master track

**What it is:** where every track ends up. What you hear, and what a render writes, is the master's output. Its FX
are the last thing in the chain (mastering).
**By hand:** the MASTER strip at the left of the Mixer; show it in the arrange view from the View menu.
**Tools:** any track tool with `trackIndex: -1` (or `"master"`).
**Learn more:** search the User Guide for `master track`.

## Volume fader and gain staging

**What it is:** the fader sets how loud a track is in the mix, in dB (0 dB = unchanged, −6 dB ≈ half as loud to a
meter, about −10 dB sounds "half as loud" to the ear). Gain staging is setting every track to a sensible level
*before* adding FX, so plugins get the level they were designed for and nothing clips.
**By hand:** the volume knob or fader on the track panel, or the fader in the Mixer. Double-click to type a value.
**Tools:** `set_track_property` (`volume`), `set_multiple_track_properties`.
**Learn more:** search the User Guide for `volume`. Workflow: `workflows/gain-staging.md`.

## Pan

**What it is:** where a mono sound sits between the left and right speaker; on a stereo track, the balance between
the two sides.
**By hand:** the pan knob on the track panel or in the Mixer.
**Tools:** `set_track_property` (`pan`).
**Learn more:** search the User Guide for `pan law`.

## Mute, solo and polarity

**What it is:** mute silences a track; solo silences every *other* track so you hear one alone. Polarity (the ø
button, often called "phase") flips the waveform upside down, which matters when two mics recorded the same source
and partly cancel each other.
**By hand:** the M, S and ø buttons on the track panel.
**Tools:** `set_track_property` (`mute`, `solo`, `phase`), `measure_track_alignment`.
**Learn more:** search the User Guide for `solo` and for `phase`.

## FX chain

**What it is:** the plugins on a track, processed top to bottom: the order matters (EQ before or after compression
sounds different). Each plugin can be bypassed (switched off but kept) or taken offline (unloaded, no CPU).
**By hand:** the track's FX button opens its FX chain window; Add picks a plugin.
**Tools:** `add_fx`, `remove_fx`, `move_fx`, `set_fx_enabled`, `set_fx_offline`, `get_track_properties`.
**Learn more:** search the User Guide for `FX chain`.

## FX parameters and presets

**What it is:** the knobs of a plugin. The tools set them on a 0–1 scale and read back the value the plugin shows
(e.g. "3.0 dB", "1200 Hz"). A preset is a saved set of all knobs.
**By hand:** open the plugin from the FX chain window; the preset menu sits at its top.
**Tools:** `get_fx_parameters`, `set_fx_parameter`, `set_multiple_fx_parameters`, `get_fx_preset_list`, `set_fx_preset`.
**Learn more:** search the User Guide for `presets`.

## EQ

**What it is:** turns frequency ranges up or down: cut mud around 200–400 Hz, add air above 10 kHz, remove rumble
with a high-pass filter. Cutting usually sounds more natural than boosting. ReaEQ is REAPER's own.
**By hand:** add ReaEQ to the FX chain; drag the band points in its graph.
**Tools:** `add_fx`, `set_fx_parameter`, `read_track_spectrum`.
**Learn more:** search the User Guide for `ReaEQ`. Reference: `reference/frequencies.md`.

## Compression

**What it is:** turns the loud moments down automatically so a part sits steadier in the mix. Threshold says from
where, ratio how hard, attack and release how fast. ReaComp is REAPER's own.
**By hand:** add ReaComp to the FX chain.
**Tools:** `add_fx`, `set_fx_parameter`, `read_track_crest`.
**Learn more:** search the User Guide for `ReaComp`. Reference: `reference/compression.md`.

## Sends, receives and buses

**What it is:** a send copies a track's audio to another track (a receive, from that track's side). Use it to feed
one reverb from many tracks, or a parallel compression bus, without moving the original.
**By hand:** the track's routing button (ROUTE, or IO in older themes), or drag from it onto another track.
**Tools:** `add_send`, `set_send`, `remove_send`, `get_track_routing`.
**Learn more:** search the User Guide for `routing`.

## Sidechain

**What it is:** a plugin listening to *another* track to decide what to do, e.g. the bass compressor ducking when the
kick hits. In REAPER that is a send into channels 3/4 of the target track, plus the plugin's pins set to listen there.
**By hand:** a send to channels 3/4 from the routing window, then the plugin's pin connector (the 2 in/2 out button).
**Tools:** `add_send` (channels), `get_fx_pins`, `set_fx_pins`.
**Learn more:** search the User Guide for `sidechain`.

## Media item and take

**What it is:** an item is one block of audio or MIDI on a track. One item can hold several takes (recorded
versions); only the active take plays.
**By hand:** click to select, drag to move, drag the edges to trim; right-click → Take for takes.
**Tools:** `list_media_items`, `set_media_item_properties`, `split_media_item`, `trim_media_item`, `list_takes`, `set_active_take`.
**Learn more:** search the User Guide for `media items`.

## Fades and crossfades

**What it is:** a short volume ramp at the start or end of an item, so it does not click. A crossfade overlaps two
items so one fades out as the next fades in.
**By hand:** drag the small handle at the top corner of an item.
**Tools:** `set_item_fades`, `set_media_item_properties`.
**Learn more:** search the User Guide for `fades`.

## Time selection and edit cursor

**What it is:** the edit cursor is the line where playback starts and pasted things land. The time selection is a
highlighted range that many edits and renders act on.
**By hand:** click the ruler to move the cursor; drag in the ruler or an empty area to select a time range.
**Tools:** `set_cursor_position`, `get_time_selection`, `set_time_selection`.
**Learn more:** search the User Guide for `time selection`.

## Markers and regions

**What it is:** a marker is a named point in time ("Chorus"); a region is a named range. They help you navigate and
can drive renders (one file per region).
**By hand:** the Insert menu, or right-click the ruler.
**Tools:** `list_markers`, `add_marker`, `add_region`, `edit_marker`, `edit_region`.
**Learn more:** search the User Guide for `markers`.

## Tempo and time signature

**What it is:** the project's BPM and meter. Tempo markers change it mid-song; the grid, snapping and MIDI follow it.
**By hand:** the BPM and time signature boxes in the transport bar; tempo markers in the tempo envelope.
**Tools:** `get_tempo_map`, `set_project_tempo`, `add_tempo_marker`.
**Learn more:** search the User Guide for `tempo`.

## Envelopes and automation

**What it is:** a line over time that moves a control for you: the vocal fader rising in the chorus, a filter opening.
Points on the line are the values. Automation items are reusable blocks of such a line.
**By hand:** the track's envelope button (or right-click the track panel) shows an envelope; click on its lane to
add points.
**Tools:** `create_track_envelope`, `insert_envelope_points`, `get_envelope_points`, `insert_automation_item`.
**Learn more:** search the User Guide for `envelopes`. Workflow: `workflows/section-levels.md`.

## MIDI items and the MIDI editor

**What it is:** MIDI is notes, not sound: pitch, length and velocity (how hard). An instrument plugin on the track
turns them into audio.
**By hand:** double-click a MIDI item to open the MIDI editor.
**Tools:** `create_midi_item`, `get_midi_notes`, `insert_midi_notes`, `edit_midi_notes`, `quantize_midi`, `analyze_midi`.
**Learn more:** search the User Guide for `MIDI editor`.

## Quantize

**What it is:** moving notes or hits onto the beat grid. Full strength sounds robotic; 50–80% keeps some feel.
**By hand:** in the MIDI editor, select notes and use quantize from its Edit menu.
**Tools:** `quantize_midi`, `quantize_audio`.
**Learn more:** search the User Guide for `quantize`.

## Stretch markers

**What it is:** points inside an audio item that let you speed up or slow down parts of it without changing pitch,
e.g. to line a double up with the lead vocal.
**By hand:** select an item and run `Item: add stretch marker at cursor` from the action list; drag the markers.
**Tools:** `add_stretch_markers`, `get_stretch_markers`, `edit_stretch_markers`, `align_audio_to_guide`.
**Learn more:** search the User Guide for `stretch markers`. Workflow: `workflows/vocal-alignment.md`.

## Fixed lanes and comping

**What it is:** a track with several lanes, one per recorded pass. Comping is picking the best part of each pass and
joining them into one performance.
**By hand:** search the action list for `fixed lanes`.
**Tools:** `get_track_lanes`, `set_track_lanes`, `comp_lanes`.
**Learn more:** search the User Guide for `fixed lanes`.

## Recording and arming

**What it is:** arming a track (the red record button) tells REAPER which tracks record when you press record; the
input picks which audio or MIDI input each one listens to; monitoring lets you hear it while playing.
**By hand:** the record-arm button and input menu on the track panel.
**Tools:** `get_record_setup`, `set_track_record`, `set_record_mode`, `record`.
**Learn more:** search the User Guide for `recording`.

## Undo

**What it is:** every change the agent makes is one undo step, so undoing once takes back exactly that change.
**By hand:** Edit → Undo (Ctrl+Z, Cmd+Z on a Mac); Edit → Undo history lists every step.
**Tools:** `undo_project`, `redo_project`.
**Learn more:** search the User Guide for `undo history`.

## Snapshots (reaper-mcp)

**What it is:** a saved copy of the mix (faders, pans, FX settings, sends) made by reaper-mcp, so you can flip
between "before" and "after" while listening. Not the same as REAPER's own project undo.
**By hand:** the Snapshots view on the bridge page, or the snapshot actions in REAPER's action list.
**Tools:** `snapshot_save`, `snapshot_restore`, `snapshot_list`.
**Learn more:** the project README, section on snapshots.

## Rendering

**What it is:** writing the mix (or stems, or regions) to audio files. REAPER plays the project faster than real time
and saves the result.
**By hand:** File → Render.
**Tools:** `get_render_settings`, `set_render_settings`, `render_project`, `render_versions`.
**Learn more:** search the User Guide for `render`. Workflow: `workflows/delivery.md`.

## Loudness: LUFS, dBFS and true peak

**What it is:** dBFS is the signal level against digital full scale (0 dBFS is the ceiling; above it, clipping).
LUFS is loudness as the ear hears it, the unit streaming services normalize to (about −14 LUFS on Spotify). True
peak is the highest level after conversion back to analog; keep it under about −1 dBTP for delivery.
**By hand:** REAPER's master meter (right-click it for LUFS), or a loudness plugin such as JS: Loudness Meter.
**Tools:** `read_track_lufs`, `measure_tracks`, `analyze_track_offline`.
**Learn more:** search the User Guide for `loudness`. Reference: `reference/metering.md`, `reference/perceived-loudness.md`.

## Perceived balance (LU and kDb)

**What it is:** the ear hears 2–5 kHz far louder than 100 Hz at the same meter level, so this project judges balance
in LU (loudness against the mix) and tone in kDb (frequency bands weighted like the ear), never raw dB.
**By hand:** no single REAPER control; compare tracks with a LUFS meter at the same point in the song.
**Tools:** `read_track_spectrum` (`kDb`), `measure_tracks`.
**Learn more:** `reference/perceived-loudness.md` (this project's own reference).

## Stereo width and correlation

**What it is:** correlation says how alike the left and right channels are: +1 is mono, 0 is very wide, below 0
means parts cancel when the mix is played in mono (a phone speaker). Keep the low end near mono.
**By hand:** a correlation meter plugin such as JS: Goniometer.
**Tools:** `read_track_correlation`, `analyze_stereo_bands`.
**Learn more:** search the User Guide for `goniometer`. Reference: `reference/metering.md`.

## Actions

**What it is:** every REAPER command (about 6,000) is an action with a name, an id and optional shortcuts. The
action list is how you find, run and rebind them.
**By hand:** Actions menu → Show action list; type to search; the Shortcut column shows the keys.
**Tools:** `search_actions`, `get_action`, `run_action`.
**Learn more:** search the User Guide for `action list`.
