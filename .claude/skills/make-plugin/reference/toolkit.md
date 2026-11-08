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

Every plugin also gets, with no code of its own: a small "reaper-mcp" credit at the bottom right
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

## Memory

Memory below `ui_mem` (1024) belongs to the toolkit. Allocate your buffers from it (the examples
use a tiny `alloc(n)`).
