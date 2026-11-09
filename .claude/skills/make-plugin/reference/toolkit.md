# The UI toolkit (`reaper/mcp_ui.jsfx-inc`)

`write_jsfx` pastes the toolkit into your plugin's `@init`. You only call it. Every name starts
with `ui_`. Sliders must be **unnamed** and numbered 1..32.

## The plugin's side

```
@init     ...your setup...      ui_boot(animated);   // 1 when the UI has a meter, else 0
@slider   update();
@block    ui_changed() ? update();                  // a knob moved by dragging in @gfx
@gfx 380 250                                         // the window's starting size
  ui_begin(core_rows, adv_rows) ? (                  // 0 = nothing changed, skip drawing
    ui_row(4);                                       // a row of 4 equal cells
    ui_knob(1, "Mix", 2); ui_knob(2, "Size", 2); ...
    ui_section("Advanced") ? (                       // the drawer; 1 while visible
      ui_row(3); ui_knob(5, "Seed", 5); ...
    );
    ui_end();
  );
```

`core_rows` is how many `ui_row`s the core view has, `adv_rows` how many sit in the Advanced
drawer (0 when there is none). The core view fills the window and keeps its layout: the Advanced
drawer is a bar along the bottom that slides up **over** the core view when clicked (the core dims
behind it and does not react until it closes; click the bar or anywhere above the drawer to close).
Every widget is one block, label above, control, value below, sized the same across a row.

## Widgets

| Call | Draws | Slider |
|---|---|---|
| `ui_knob(idx, "Label", fmt)` | knob, label above, value below | any range |
| `ui_toggle(idx, "Label")` | on/off pill | `<0,1,1>` |
| `ui_choice(idx, "Label")` | box showing the option, click = next, right-click = previous | `<0,N-1,1{A,B,C}>`, at most 8 options (lint `too-many-options`) |
| `ui_meter(level, "Label")` | vertical peak meter, -60..+6 dB, holds and falls 30 dB/s | none: pass the peak you kept with `max()` in `@sample`, then set it back to 0 |
| `ui_section("Label")` | the Advanced drawer (bar when closed, panel over the core when open); returns 1 while visible | none |

### Graph widgets (toolkit 1.3)

| Call | Draws | Feed / slider |
|---|---|---|
| `ui_freqgraph("Label")` | log frequency graph, 20 Hz-20 kHz, gridlines and labels, the fed trace, the selected band; a click between handles selects a band | trace: `ui_gfeed(buf, n)` with `n` FFT magnitudes (linear, low to high) from `@block`, or `ui_gset(i, db)` for a curve point (`i` 0..95) |
| `ui_gshow(on)` / `ui_gfeed2(buf, n)` | before / after: with `ui_gshow(slider)` on, the graph also draws the input as a second, lighter line labelled Input / Output; feed it with `ui_gfeed2` only while shown (a second FFT costs). Put a `ui_toggle` for it in Advanced | a `<0,1,1{Off,On}>` slider |
| `ui_fhandle(idx, "Label")` | a draggable band edge on the graph, bound to slider `idx` in Hz; drag, wheel, double-click for a value box, modifier-click resets; stays between its neighbours; automates like a knob | a Hz slider, e.g. `<40,800,1>`; call it after `ui_freqgraph`, in left-to-right order |
| `ui_fthresh(thr_first, ratio_first, gain_first, n)` | a threshold line across each of `n` bands (the handles + 1) on the graph; hover a band and drag up/down to move its threshold, **Shift**-drag its gain, wheel = its ratio, click selects it | `n` threshold sliders from `thr_first` (dB, -60..0), `n` ratio sliders from `ratio_first`, `n` gain sliders from `gain_first`; call it after the handles |
| `ui_bandknob(first_idx, n, "Label", fmt)` | a knob on the selected band's slider (`first_idx + ui_fsel`), labelled with the band (Low / Mid / High, else Band N) | `n` sliders from `first_idx`; counts as one widget |
| `ui_grmeter(n, "Label")` | `n` (1-8) gain-reduction bars hanging from the top, amber from 6 dB, red from 12; a click selects the band | `ui_gr(k, db)` per band from `@block` (db 0 or more) |
| `ui_transfer(thr_idx, ratio_idx, knee_db)` | a compressor transfer curve that follows the threshold and ratio sliders (the selected band's, `thr_idx + ui_fsel`, with a graph), with a live level dot | `ui_glevel(db)` from `@block` |
| `ui_keyboard(lo, hi, "Label")` | piano keys `lo`..`hi` (MIDI notes), lit while held | `ui_kkey(note, vel)` on note on, `ui_kkey(note, 0)` on note off |
| `ui_tall(span)` | the next `ui_row` is `span` times as tall (a graph needs height); knobs in it keep their size | none |

Use `ui_boot(2)` in a plugin with these feeds: it redraws only when a feed, a control or the window
changed, so silence costs nothing (`ui_boot(1)` redraws every frame, `ui_boot(0)` only on change).
Feeds are rounded to a visible step before they count as change. A graph widget counts as one
widget for the core limit. The selected band is `ui_fsel` (0-based), which the plugin may read.
Memory map: 0..1023 core, 1024+ graph data (`ui_fg` trace, `ui_ge` band edges, `ui_grm`, `ui_kb`),
`ui_mem` (2048) is where your buffers start. `examples/multiband-compressor.jsfx` uses them all.

`fmt` for knobs: `0` number (`0.00`), `1` dB, `2` percent of 0..1, `3` Hz or kHz, `4` ms, `5` integer.

Interaction (all automatic, the FabFilter/Serum convention): drag up/down (200 px = the full
range, **Shift**-drag = 10x finer), mouse wheel (Shift = finer), **double-click** opens a small
value box next to the knob (type the value in the knob's units: dB, %, Hz with an optional `k`,
ms, integers; Enter sets it, clamped and snapped like a drag; a click outside cancels;
Backspace works), **Cmd-click / Ctrl-click / Alt-click** resets to the default. Toggles and
choices: click; a modifier-click resets them too. Never handle the mouse or keyboard in plugin
code (lint `own-key-handling` warns on `gfx_getchar`).

Esc: REAPER closes a floating FX window on Esc before the plugin sees it (probed in 7.40). Only
when the user turns on the FX window's **+ > Send all keyboard input to plug-in** does Esc reach
the plugin; then it closes the value box, the About dialog, then the drawer (and the window
closes with its close button, as every key now goes to the plugin).

**Header knobs.** A plugin with a Mix and/or an Output slider calls `ui_header(mix_idx, out_idx)` in `@gfx` before `ui_begin` (0 for one it does not have): two small knobs in the top right, Output rightmost, with the usual gestures, the value shown while hovered. Do not draw those sliders as widgets too (they leave the core view and its widget count). The plugin name and the first row get a clear gap below the name, a little more with header knobs.

Every plugin also gets, with no code of its own: its name in small spaced capitals at the top-left
(hidden in a very narrow window), and a small "reaper-mcp" credit at the bottom right
(in the drawer bar, or the bottom padding when there is no drawer; hidden in a narrow window).
A click opens the **About** dialog drawn in the plugin: what reaper-mcp is, the repository
address as plain text (JSFX cannot open a browser or write the clipboard), and this plugin's
name, version, toolkit version, accent, control count and the day it was written (filled in by
`write_jsfx`; never the user's request). Set `ui_credit = 0;` in the toolkit to hide it.

**Accent.** Each plugin has its own accent colour (knob arcs, hover, the Advanced title, the
toggle's on state, the footer hover, a faint tint in the background), set by `write_jsfx`:
by default derived from the plugin's name, or `accent: "orange"` / `"#rrggbb"`. Never set
`ui_cAccent` or call `ui_theme()` in plugin code (lint `accent-assign`). Meters keep their green,
amber and red. **Background**: a very subtle vertical gradient with fine grain (`ui_texture = 0`
in the toolkit makes it flat), rendered once into an offscreen image and blitted, rebuilt only on
a resize or an accent change. The toolkit also hides REAPER's slider panel
above the UI (`ui_hide_sliders`): the sliders stay real parameters (automation, MIDI learn, the
Param menu, presets).

## State and @init

REAPER re-runs `@init` whenever playback starts. The toolkit sets its UI state once (guarded by
`ui_ready`), so pressing Play never closes the drawer. Do the same in plugin code: never assign
`ui_adv_open` (the lint warns, `ui-state-reset`); `@serialize`'s `file_var(0, ui_adv_open)`
restores it with the project.

## Rules the lint enforces

- At most **5** widgets before the first `ui_section` (a meter counts); at most 8 after it (a warning).
- Every visible slider needs a widget (hide one on purpose with a leading `-` in its label).
- `@init` calls `ui_boot`, `@block` calls `ui_changed`, `@gfx` calls `ui_begin`.
- No `gmem`, no named sliders, no scientific-notation literals, no `slider33` and up.
- `max()`/`min()` with exactly two arguments; no `local()` at the top of `@sample`/`@block`.
- A warning when the plugin assigns `ui_adv_open`.
- `unknown-ui-call` (a `ui_` function the toolkit does not define) and `ui-arity` (wrong argument
  count) are errors: EEL2 would otherwise fail silently.

## Memory

Memory below `ui_mem` belongs to the toolkit. Allocate your buffers from it (the examples
use a tiny `alloc(n)`).
