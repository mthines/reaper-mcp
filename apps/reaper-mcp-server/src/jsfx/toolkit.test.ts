/**
 * The @gfx toolkit (`reaper/mcp_ui.jsfx-inc`) cannot run outside REAPER, so these tests read what a plugin
 * author and the user can observe from its source: what a function takes and reads, which sliders it moves,
 * where its data lives, and what makes it redraw. Real behaviour is proven live (see the verify folder).
 */
import { describe, it, expect } from 'vitest';
import { loadToolkit } from '../tools/jsfx.js';
import { inlineToolkit } from './inline.js';
import { UI_API } from './lint.js';

const toolkit = loadToolkit();
const code = toolkit.replace(/\/\/[^\n]*/g, '');

/** The text between a function's outer parentheses. */
function body(name: string): string {
  const at = code.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(`function ${name} not found`);
  let i = code.indexOf(')', at) + 1; // past the parameters
  const local = code.slice(i).match(/^\s*local\(/);
  if (local) i = code.indexOf(')', i) + 1; // past local(...)
  i = code.indexOf('(', i) + 1;
  const start = i;
  let depth = 1;
  let inString = false;
  for (; i < code.length && depth > 0; i++) {
    const ch = code[i];
    if (inString) inString = ch !== '"';
    else if (ch === '"') inString = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  return code.slice(start, i - 1);
}
const number = (variable: string): number => Number(code.match(new RegExp(`\\b${variable}\\s*=\\s*(\\d+)\\s*;`))?.[1]);

describe('toolkit 1.3: the plugin name header', () => {
  it('name header: every plugin shows its name in spaced capitals at the top-left, above the first row', () => {
    const draw = body('ui_namedraw');
    expect(body('ui_begin')).toContain('ui_namedraw()');
    expect(draw).toContain('ui_caps(#ui_name)');
    expect(draw).toMatch(/x = ui_pad;/);
    expect(draw).toMatch(/y = 15 \* ui_s - ui_th \/ 2;/); // centred on the header band's line, level with the bars
    expect(draw).toMatch(/\+ 1\.6 \* ui_s/); // letter spacing
    expect(body('ui_begin')).toMatch(/ui_y = ui_ytop;/);
    expect(body('ui_begin')).toMatch(/ui_ytop = 25 \* ui_s;/); // the band is centred on y = 15, so the gap above and below it is equal, with or without Mix / Output
  });

  it('name header: hides in a very narrow window instead of colliding with the controls', () => {
    expect(body('ui_namedraw')).toMatch(/gfx_w >= 150 \* ui_s/);
    expect(body('ui_namedraw')).toMatch(/x < ui_nlim/);
    expect(body('ui_begin')).toMatch(/ui_nlim = gfx_w - ui_pad - \(\(ui_hm > 0\) \+ \(ui_ho > 0\)\) \* 118 \* ui_s/); // the name stops before the header bars
  });

  it('name header: the plugin name that write_jsfx inlines is the desc without the developer suffix', () => {
    const out = inlineToolkit('desc:Warm Tape\nslider1:0<0,1,0.01>Mix\n@init\nui_boot(0);\n@gfx 100 100\nui_begin(1,0) ? ( ui_end(); );\n', { toolkit, version: 1 });
    expect(out).toContain('strcpy(#ui_name, "Warm Tape");');
    expect(out).toContain('desc:Warm Tape (reaper-mcp)');
  });
});

describe('toolkit 1.3: the header bars', () => {
  it('header bars: Output is the rightmost, Mix to its left, drawn only when the plugin has them and the window is wide enough', () => {
    const begin = body('ui_begin');
    expect(begin).toMatch(/\(ui_hm \|\| ui_ho\) && gfx_w >= 280 \* ui_s/);
    expect(begin.indexOf('ui_hbar(ui_ho')).toBeLessThan(begin.indexOf('ui_hbar(ui_hm'));
    expect(body('ui_header')).toContain('ui_hm = max(0, floor(m))');
  });

  it('header bars: they have the knob gestures (drag, wheel, double-click, reset) and show the value while hovered', () => {
    const bar = body('ui_hbar');
    expect(bar).toContain('ui_reset(idx)');
    expect(bar).toContain('ui_edopen(idx, fmt, label');
    expect(bar).toContain('mouse_wheel');
    expect(bar).toMatch(/\(mouse_x - ui_lx\)/); // a horizontal drag, like Vital's bar
    expect(bar).toMatch(/hot \? ui_fmtv\(fmt, slider\(idx\)\) : ui_caps\(label\)/);
  });

  it('header bars: every function is defined before the one that calls it (EEL2 fails silently otherwise)', () => {
    const at = (n: string) => code.indexOf(`function ${n}(`);
    for (const [fn, dep] of [['ui_hbar', 'ui_reset'], ['ui_hbar', 'ui_fmtv'], ['ui_hbar', 'ui_edopen'], ['ui_begin', 'ui_hbar'], ['ui_begin', 'ui_namedraw']]) {
      expect(at(dep), `${dep} before ${fn}`).toBeLessThan(at(fn));
    }
  });
});

describe('toolkit 1.3: the frequency graph', () => {
  it('frequency graph: maps 20 Hz to 20 kHz on a log axis, both ways', () => {
    const decades = Math.log(1000).toFixed(6);
    expect(body('ui_fxof')).toContain(`log(max(f, 20) / 20) / ${decades}`);
    expect(body('ui_fof')).toContain(`exp(min(1, max(0, (x - ui_gx) / ui_gw)) * ${decades})`);
    expect(body('ui_gfeed')).toContain(`exp(p / ui_gn * ${decades})`);
  });

  it('frequency graph: draws gridlines and labels at the usual frequencies, and the fed trace', () => {
    const draw = body('ui_freqgraph');
    for (const label of ['100', '1000', '10000']) expect(draw).toContain(label);
    expect(draw).toContain('ui_fg[i]');
    expect(draw).toContain('gfx_line'); // the trace line over its filled columns
    expect(draw).toContain('ui_fsel');
  });

  it('frequency graph: a spectrum feed turns FFT magnitudes into dB points across the whole axis', () => {
    const feed = body('ui_gfeed');
    expect(feed).toContain('20 * log10(max(m, 0.000001))');
    expect(feed).toContain('loop(ui_gn');
    expect(number('ui_gn')).toBeLessThanOrEqual(128);
  });

  it('frequency graph: a band is picked by a click between handles, not by one on a handle', () => {
    const draw = body('ui_freqgraph');
    expect(draw).toMatch(/hot && ui_press && !near/);
    expect(draw).toMatch(/abs\(mouse_x - ex\) < 9 \* ui_s/);
  });
});

describe('toolkit 1.3: band handles', () => {
  const handle = body('ui_fhandle');

  it('band handle drag: moves the bound slider within its range and snaps it like a knob', () => {
    expect(handle).toMatch(/ui_set\(idx, ui_q\(idx, min\(hi, max\(lo, nf\)\)\)\)/);
    expect(body('ui_q')).toContain('min(hi, max(lo, v))'); // the slider's own range
  });

  it('band handle drag: sends an automation touch on release, so a drag records like a knob', () => {
    expect(handle).toMatch(/ui_active == idx && ui_rel \? \( slider_automate\(2 \^ \(idx - 1\), 1\)/);
    expect(body('ui_set')).toContain('slider_automate(2 ^ (idx - 1))');
  });

  it('band handle drag: stays between its neighbours so two crossovers never swap', () => {
    expect(handle).toContain('slider(ui_ge[k - 1]) * 1.1');
    expect(handle).toContain('slider(ui_ge[k + 1]) / 1.1');
  });

  it('band handle drag: keeps the knob gestures: double-click types a Hz value, a modifier-click resets', () => {
    expect(handle).toContain('ui_edopen(idx, 3,');
    expect(handle).toContain('ui_reset(idx)');
    expect(handle).toMatch(/mouse_wheel != 0/);
  });
});

describe('toolkit 1.3: gain reduction and the transfer curve', () => {
  it('gain reduction and transfer: the bars hang from the top, amber from 6 dB and red from 12', () => {
    const meter = body('ui_grmeter');
    expect(meter).toContain('v >= 12 ? ui_cBad : (v >= 6 ? ui_cWarn : ui_cAccent)');
    expect(meter).toContain('ui_grm[k]');
    expect(body('ui_gr')).toContain('min(48, max(0, db))');
  });

  it('gain reduction and transfer: a click on a bar selects its band like a click on the graph', () => {
    expect(body('ui_grmeter')).toMatch(/hit && ui_press \? \( ui_fsel = k;/);
  });

  it('gain reduction and transfer: the curve follows threshold, ratio and knee and marks the live level', () => {
    const curve = body('ui_tcurve');
    expect(curve).toContain('x + (1 / r - 1) * (d + w / 2) * (d + w / 2) / (2 * w)'); // inside the knee
    expect(curve).toContain('t + d / r'); // above it
    const transfer = body('ui_transfer');
    expect(transfer).toContain('slider(thr_idx + k)');
    expect(transfer).toContain('max(1, slider(ratio_idx + k))');
    expect(transfer).toContain('ui_glv');
  });
});

describe('toolkit 1.3: per-band thresholds', () => {
  it('band threshold: hovering a band and dragging up or down moves that band\'s threshold slider, kept in its range', () => {
    const draw = body('ui_fthresh');
    expect(draw).toContain('mouse_x >= a && mouse_x < b'); // anywhere inside the band
    expect(draw).toMatch(/ui_acc - \(mouse_y - ui_ly\) \* 72 \/ ui_gh/); // up = higher
    expect(draw).toMatch(/ui_set\(idx, ui_q\(idx, ui_acc\)\)/);
    expect(draw).toMatch(/slider_automate\(2 \^ \(idx - 1\), 1\)/);
    expect(draw).toContain('ui_gany = 2'); // vertical resize cursor
  });

  it('only runs a drag it started, so a band knob on the same slider drags at its own rate', () => {
    const draw = body('ui_fthresh');
    expect(draw).toMatch(/ui_ftd = 1/); // set when the press is the graph's
    expect(draw).toMatch(/ui_ftd && ui_active == idx && ui_down/);
    expect(draw).toMatch(/ui_ftd && ui_active == gdx && ui_down/);
  });

  it('band gain: Shift-drag moves the band\'s gain slider instead, 0.15 dB a pixel, and says so in the label', () => {
    const draw = body('ui_fthresh');
    expect(draw).toContain('ui_active = sh ? gdx : idx');
    expect(draw).toMatch(/ui_acc - \(mouse_y - ui_ly\) \* 0\.15/);
    expect(draw).toContain('dB gain');
    expect(draw).toMatch(/slider_automate\(2 \^ \(gdx - 1\), 1\)/);
  });

  it('band threshold: the wheel changes that band\'s ratio and a click selects the band', () => {
    const draw = body('ui_fthresh');
    expect(draw).toMatch(/ui_set\(rdx, ui_q\(rdx, slider\(rdx\)/);
    expect(draw).toContain('ui_fsel = k');
  });

  it('band threshold: a press on a handle never starts a threshold drag', () => {
    expect(body('ui_fthresh')).toMatch(/abs\(mouse_x - ui_fxof\(slider\(ui_ge\[i\]\)\)\) < 9 \* ui_s/);
  });

  it('selected band: the knob and the transfer curve follow the selected band', () => {
    expect(body('ui_bandknob')).toContain('ui_knob(first_idx + k, #ui_bl, fmt)');
    expect(body('ui_bandknob')).toContain('min(floor(ui_fsel), n - 1)');
    expect(body('ui_transfer')).toContain('slider(thr_idx + k)');
    expect(body('ui_transfer')).toContain('slider(ratio_idx + k)');
  });
});

describe('toolkit 1.3: before and after', () => {
  it('compare: the input trace is its own line over the output, labelled, and only drawn while it is switched on', () => {
    const draw = body('ui_freqgraph');
    expect(draw).toMatch(/ui_fcmp \? \(/);
    expect(draw).toContain('ui_fi[i]');
    expect(draw).toContain('ui_caps("Input")');
    expect(draw).toContain('ui_caps("Output")');
    expect(body('ui_gshow')).toContain('ui_fcmp = on > 0.5');
  });

  it('compare: the input feed writes its own trace and hands the output back, and a toggle redraws', () => {
    const feed = body('ui_gfeed2');
    expect(feed).toContain('ui_gt = ui_fi');
    expect(feed).toContain('ui_gt = ui_fg');
    expect(body('ui_begin')).toMatch(/ui_fcmp \* 67/);
  });
});

describe('toolkit 1.3: the MIDI keyboard', () => {
  it('midi keyboard: black keys sit on the five sharp pitch classes', () => {
    const mask = Number(body('ui_keyboard').match(/& (\d+)\)/)?.[1]);
    const pitchClasses = [...Array(12).keys()].filter((pc) => mask & (1 << pc));
    expect(pitchClasses).toEqual([1, 3, 6, 8, 10]);
  });

  it('midi keyboard: lights the notes the plugin feeds, and a note off clears it', () => {
    const keyboard = body('ui_keyboard');
    expect(keyboard).toContain('ui_kb[n] > 0');
    expect(keyboard).toContain('ui_c(ui_cAccent, 1)');
    const feed = body('ui_kkey');
    expect(feed).toContain('min(127, max(0, floor(note)))');
    expect(feed).toContain('ui_kb[n] = q1 ? min(127, max(1, vel)) : 0');
  });
});

describe('toolkit 1.3: per-band levels', () => {
  it('band level: hover a band and drag up or down for its level across the graph height, Shift = fine, wheel = a step', () => {
    const draw = body('ui_fband');
    expect(draw).toContain('mouse_x >= a && mouse_x < b');
    expect(draw).toMatch(/ui_acc - \(mouse_y - ui_ly\) \* \(mx - mn\) \/ ui_gh/);
    expect(draw).toMatch(/\(mouse_cap & 8\) \? 0\.2 : 1/);
    expect(draw).toMatch(/mouse_wheel != 0/);
    expect(draw).toMatch(/slider_automate\(2 \^ \(idx - 1\), 1\)/);
    expect(draw).toContain('ui_fsel = k'); // a click selects the band, which ui_bandknob follows
  });

  it('band level: only runs a drag it started', () => {
    expect(body('ui_fband')).toMatch(/ui_ftd && ui_active == idx && ui_down/);
  });
});

describe('toolkit 1.3: playing the keyboard', () => {
  it('playable keys: a press on a key queues a note on, a drag across keys moves it, and a release queues the note off', () => {
    const keyboard = body('ui_keyboard');
    expect(keyboard).toMatch(/ui_active = 64; ui_kheld = hn \+ 1; ui_kput\(hn, vel\)/);
    expect(keyboard).toMatch(/hn \+ 1 != ui_kheld/); // glissando
    expect(keyboard).toMatch(/ui_active == 64 && !ui_down/); // release, even outside the window
    expect(keyboard).toMatch(/hn < 0 \? hn = hw/); // a black key wins over the white key under it
  });

  it('playable keys: the plugin reads the queue in @block with ui_kpoll, which ends when the queue is empty', () => {
    const poll = body('ui_kpoll');
    expect(poll).toContain('ui_kq[32] != ui_kq[33]');
    expect(poll).toMatch(/ui_kn = /);
    expect(poll).toMatch(/ui_kv = /);
  });

  it('playable keys: the queue sits above the graph regions and below the plugin memory', () => {
    const t = toolkit;
    const kq = Number(t.match(/ui_kq = (\d+)/)?.[1]);
    const fi = Number(t.match(/ui_fi = (\d+)/)?.[1]);
    const mem = Number(t.match(/ui_mem = (\d+)/)?.[1]);
    expect(kq).toBeGreaterThanOrEqual(fi + 128); // ui_fi holds 128 points
    expect(kq + 34).toBeLessThanOrEqual(mem);
  });
});

describe('toolkit 1.4: drum pads', () => {
  it('pads: a press strikes the pad under the mouse, a drag moves the hit, a release lets go, even outside the window', () => {
    const pads = body('ui_pads');
    expect(pads).toMatch(/ui_active = 65; ui_pheld = hot \+ 1; ui_padon\(hot, vel\)/);
    expect(pads).toMatch(/hot \+ 1 != ui_pheld/);
    expect(pads).toMatch(/ui_active == 65 && !ui_down/);
    expect(pads).toMatch(/\(mouse_y - y\) \/ ph/); // lower on the pad = harder
  });

  it('pads: a struck pad reaches the plugin through the same queue as the keyboard and lights like a note from MIDI', () => {
    expect(body('ui_padon')).toContain('ui_kput(n, vel); ui_kkey(n, vel)');
    expect(body('ui_padoff')).toContain('ui_kput(n, 0); ui_kkey(n, 0)');
    expect(body('ui_pads')).toContain('ui_kb[ui_pn + i]');
  });

  it('pads: at most 16 pads on notes that stay inside 0-127', () => {
    const pads = body('ui_pads');
    expect(pads).toMatch(/while \(ui_pcols \* ui_prows > 16\)/);
    expect(pads).toMatch(/ui_pn = min\(127 - ui_pcols \* ui_prows \+ 1, max\(0, floor\(first\)\)\)/);
  });

  it('pads: the typed keys are a 4 x 4 block, bottom row first, that a smaller grid cuts down; Shift hits hard', () => {
    expect(toolkit).toContain('strcpy(#ui_pkeys, "zxcvasdfqwer1234")');
    expect(body('ui_padkey')).toMatch(/col < ui_pcols && row < ui_prows/);
    const keys = body('ui_keys');
    expect(keys).toMatch(/vel = \(c >= 65 && c <= 90\) \? 127 : 100/);
    expect(keys).toMatch(/ui_pd\[i\] = now \+ 0\.12/); // a drum is a one-shot
  });

  it('pads: keys are read every frame, not only when the UI redraws, and never while a value box or the drawer owns the keyboard', () => {
    expect(body('ui_begin')).toContain('ui_keys()');
    expect(body('ui_keys')).toMatch(/\(ui_ed \|\| ui_about\) \? \(/);
  });

  it('pads: their release times sit above the key queue and below the plugin memory', () => {
    expect(number('ui_pd')).toBeGreaterThanOrEqual(number('ui_kq') + 34);
    expect(number('ui_pd') + 16).toBeLessThanOrEqual(number('ui_mem'));
  });
});

describe('toolkit 1.4: pads while the drawer is open', () => {
  it('pad keys still strike while Advanced is open, so a mapped note can be heard; Esc still closes the drawer', () => {
    const keys = body('ui_keys');
    expect(keys).toMatch(/\(ui_adv_open \|\| ui_pc > 0 \|\| ui_sqon > 0\) \? \(/);
    expect(keys).toMatch(/c == 27 \? \( ui_adv_open = 0;/);
    expect(keys).toContain('ui_padon(i, vel)');
  });

  it('the pad map lights the cell of a pad that is sounding', () => {
    expect(body('ui_padmap')).toContain('ui_kb[ui_pn + i] > 0');
  });
});

describe('toolkit 1.4: the pad map', () => {
  it('pad map: names the note (middle C = C4, so 36 is C2) and draws sharps with a #', () => {
    expect(body('ui_notename')).toContain('floor(n / 12) - 1');
    expect(body('ui_notename')).toContain('1354'); // the same sharp mask as the keyboard
    expect(toolkit).toContain('"C C#D D#E F F#G G#A A#B "');
  });

  it('pad map: one slider per pad, in the grid of the pads, edited by drag, scroll, a typed value and a reset', () => {
    const map = body('ui_padmap');
    expect(map).toMatch(/idx = first_idx \+ i/);
    expect(map).toMatch(/row = floor\(i \/ cols\)/);
    expect(map).toMatch(/\(mouse_cap & 52\) \? ui_reset\(idx\)/);
    expect(map).toMatch(/ui_edopen\(idx, 5,/);
    expect(map).toMatch(/\(ui_ly - mouse_y\)/);
    expect(map).toMatch(/\(mouse_cap & 8\) \? 12 : 1/); // Shift-scroll = an octave
    expect(map).toMatch(/ui_active == idx && ui_rel/);
    expect(map).toMatch(/slider_automate\(2 \^ \(idx - 1\), 1\)/);
  });

  it('pad map: hovering or dragging a cell shows an up and a down arrow, and the gestures in a hint on the label line', () => {
    const map = body('ui_padmap');
    expect(map).toMatch(/hov \|\| on \? \(\s*hint = 1;/);
    expect(map.match(/ui_chev\(/g)).toHaveLength(2); // one up, one down
    expect(map).toContain('DRAG OR SCROLL  /  DOUBLE-CLICK TO TYPE');
    expect(map).toMatch(/hint = 0;/); // gone again when the mouse leaves
  });
});

describe('toolkit 1.3: the memory map', () => {
  it('memory map: graph data starts at 1024 or above, in regions that never overlap', () => {
    const regions = [
      { name: 'ui_fg', size: number('ui_gn') }, // one point per trace slot
      { name: 'ui_ge', size: 16 },
      { name: 'ui_grm', size: 8 },
      { name: 'ui_kb', size: 128 },
      { name: 'ui_fi', size: number('ui_gn') }, // the input trace of the before/after view
    ].map((r) => ({ ...r, start: number(r.name) }));
    for (const r of regions) expect(r.start, r.name).toBeGreaterThanOrEqual(1024);
    for (let i = 1; i < regions.length; i++) expect(regions[i].start).toBeGreaterThanOrEqual(regions[i - 1].start + regions[i - 1].size);
    expect(number('ui_mem')).toBeGreaterThanOrEqual(regions[regions.length - 1].start + 128);
    expect(number('ui_mem')).toBeGreaterThanOrEqual(number('ui_fi') + 128);
  });

  it('memory map: the core keeps its reserved range below 1024', () => {
    expect(number('ui_min')).toBe(0);
    expect(number('ui_mtr')).toBeLessThan(1024);
    expect(toolkit).toMatch(/Memory map/);
    expect(toolkit).toMatch(/1024\.\.1151\s+ui_fg/);
  });

  it('memory map: every function the lint knows is defined by the toolkit with the same arguments, and no other', () => {
    const defined = Object.fromEntries(
      [...code.matchAll(/function\s+(ui_\w+)\s*\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(',').filter((a) => a.trim()).length]),
    );
    expect(UI_API).toEqual(defined);
  });
});

describe('toolkit 1.3: idle redraw', () => {
  it('idle redraw: a static plugin (ui_boot 0) and an activity-driven one (ui_boot 2) draw only when something changed', () => {
    const begin = body('ui_begin');
    expect(begin).toMatch(/ui_dirty = ui_animated == 1 \|\|/); // only mode 1 redraws every frame
    for (const hash of ['ui_fh', 'ui_fh2', 'ui_fh3', 'ui_fh4', 'ui_fsel']) expect(begin).toMatch(new RegExp(`\\b${hash} \\*`));
  });

  it('idle redraw: each feed hashes its values rounded to a visible step, so silence settles and stops redrawing', () => {
    expect(body('ui_gput')).toContain('/ 1.5');
    expect(body('ui_gput')).toMatch(/ui_fh \+= \(q1 - q0\)/);
    expect(body('ui_gr')).toContain('/ 0.5');
    expect(body('ui_gr')).toMatch(/ui_fh2 \+= \(q1 - q0\)/);
    expect(body('ui_kkey')).toMatch(/ui_fh3 \+= \(q1 - q0\)/);
    expect(body('ui_glevel')).toContain('ui_fh4 = floor(');
  });

  it('idle redraw: drawing never allocates: the graph widgets keep their data in the fixed memory map', () => {
    for (const fn of ['ui_freqgraph', 'ui_fhandle', 'ui_grmeter', 'ui_transfer', 'ui_keyboard']) {
      expect(body(fn), fn).not.toMatch(/\b(memset|memcpy|alloc|gfx_setimgdim)\s*\(/);
    }
  });
});

describe('toolkit 1.3: the About dialog documents the controls', () => {
  it('lists the gestures every control shares, and drops them last in a window too short for them', () => {
    const about = body('ui_aboutdraw');
    for (const line of ['"Drag"', '"Shift-drag"', '"Wheel"', '"Dbl-click"', '"Cmd-click"']) expect(about).toContain(line);
    expect(about).toContain('"CONTROLS"');
    expect(about).toMatch(/kb = av >= /); // shown only while the dialog fits the window
    expect(about).toMatch(/h = .*kb \* 91 \* ui_s/); // and the dialog grows by exactly its height
  });
});

describe('toolkit 1.3: the key queue', () => {
  it('keeps room for the note-off of every queued note-on', () => {
    const put = body('ui_kput');
    expect(put).toMatch(/f >= \(vel > 0 \? 2 : 1\)/);
  });
});

describe('toolkit 1.4: the step sequencer', () => {
  it('keys 1-4 pick the brush length and q / w / e its feel, while a sequencer is drawn', () => {
    const k = body('ui_sqkey');
    expect(k).toMatch(/c >= 49 && c <= 52 \? \( ui_sqbl = c - 49;/);
    expect(k).toContain('c == 113 ? ( ui_sqbf = 0;');
    expect(k).toContain('c == 119 ? ( ui_sqbf = 1;');
    expect(k).toContain('c == 101 ? ( ui_sqbf = 2;');
    expect(body('ui_keys')).toContain('ui_sqon > 0 ? ui_sqkey(c)');
  });

  it('Shift and Alt never change the feel (only the brush does), and Cmd/Ctrl places off the grid', () => {
    const seq = body('ui_seq');
    expect(seq).toContain('fe = ui_sqbf;');
    expect(seq).not.toContain('f2 = (mouse_cap & 16)');
    expect(seq).toContain('(mouse_cap & 4) ? min(lt - 1, max(0, floor(t + 0.5))) : ui_sqcell(t, st)');
  });

  it('follows the MIDI editor: drag selects, Shift-drag paints at the brush length, Delete removes the selection', () => {
    const seq = body('ui_seq');
    expect(seq).toContain('ui_sqmode = 7; ui_sqpcm ? 0 : ui_sqdesel();');   // a plain drag becomes a marquee
    expect(seq).toContain('ui_sqpsh ? (');                                  // Shift-drag paints
    expect(seq).toContain('ui_sqadd(ui_sqln, s, ui_sqcode, 100)');
    expect(seq).not.toContain('ui_sqbl = floor(k[1] / 3)');                 // a drag never changes the brush length
    expect(body('ui_sqkey')).toContain('c == 6579564 || c == 8');           // Delete, Backspace
    expect(body('ui_sqkey')).toContain('ui_sqdelsel()');
    expect(seq).toContain('ui_sqdelsel()');                                 // the DELETE button, for when keys are not sent
  });

  it('Alt (Option)-drag erases the notes the pointer crosses, one fresh lookup per frame', () => {
    const seq = body('ui_seq');
    expect(seq).toContain('(mouse_cap & 16) ? (\n      ui_press = 0; ui_active = 66; ui_sqmode = 8;');
    expect(seq).toContain('ui_sqmode == 8 && hov ? (');
    expect(seq).toContain('i = ui_sqfind(ln, t, 6 * ui_s / gw * lt); i >= 0 ? ( ui_sqpush1(); ui_sqdel(ln, i); );');
  });

  it('a click on the ruler sets where Play starts (header slot 2); the same spot again clears it', () => {
    const seq = body('ui_seq');
    expect(seq).toContain('ui_sqb[2] = (s == ui_sqb[2]) ? 0 : s;');
    expect(body('ui_sqclear')).toContain('ui_sqb[2] = 0;');
  });

  it('a new note lands in the cell under the pointer, and sounds its lane when added', () => {
    const seq = body('ui_seq');
    expect(body('ui_sqcell')).toContain('floor(t / st) * st');
    expect(seq).toContain('ui_sqcell(ui_sqpt, st)');
    expect(seq).toContain('ui_kput(slider(note_idx + ui_sqln), 100)');
  });

  it('a plain drag on a note moves it, Shift-drag changes its velocity', () => {
    const seq = body('ui_seq');
    expect(seq).toContain('ui_sqpsh && abs(dy) >= 4 * ui_s ? (');
    expect(seq).toContain('!ui_sqpsh && (abs(dx) >= 4 * ui_s || abs(dy) >= 4 * ui_s) ? (');
  });

  it('dragging a note up or down moves the selection to another lane, only when every note fits', () => {
    expect(body('ui_sqlanes')).toContain('t < 0 || t >= ui_sqnl ? ok = 0');
    expect(body('ui_sqlanes')).toContain('q[0] - ui_sqlsel(t) + ui_sqlsel(l) > 32 ? ok = 0');
    expect(body('ui_seq')).toContain('ui_sqlanes(i) ? (');
  });

  it('velocity, length and scroll adjustments act on the whole selection', () => {
    const seq = body('ui_seq');
    expect(seq).toContain('ui_sqvel(floor(0 - dy / ui_s * 1.5 + 0.5))');
    expect(seq).toContain('ui_sqsetlen(ns)');
    expect(seq).toContain('ui_sqadj(ln, hi, d,');
    expect(body('ui_sqadj')).toContain('all = ui_sqsl[ln * 32 + hi];');
  });

  it('keeps 100 steps of undo and redo in the plugin, reachable by Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and the footer buttons', () => {
    expect(body('ui_sqpush')).toContain('% 100');
    expect(body('ui_sqpush')).toContain('memcpy(ui_squbase(0, ui_squh) + 1, ui_sqb + 1, 791)');   // the loop length (slot 0) is a slider's
    expect(body('ui_sqkey')).toContain('c == 26 ? ( (mouse_cap & 8) ? ui_sqredo() : ui_squndo();');
    const seq = body('ui_seq');
    expect(seq).toContain('"UNDO"');
    expect(seq).toContain('"REDO"');
    expect(body('ui_sqdelsel')).toContain('n > 0 ? ui_sqpush1();');   // deleting is undoable
  });

  it('a knob can carry a tooltip (ui_help), shown after the mouse rests on it', () => {
    expect(body('ui_help')).toContain('strcpy(900 + idx, text)');
    expect(body('ui_knob')).toContain('ui_tipf = idx;');
    expect(body('ui_end')).toContain('ui_tipdraw();');
    expect(body('ui_tipdraw')).toContain('time_precise() - ui_tipt > 0.5');
  });

  it('hovering UNDO / REDO says how many steps there are and what the keyboard needs', () => {
    expect(body('ui_seq')).toContain('SEND ALL KEYBOARD INPUT');
  });

  it('moving notes snaps to the brush grid (its length and feel), not the note\'s own', () => {
    expect(body('ui_seq')).toContain('ui_sqlen(ui_sqbl * 3 + ui_sqbf)');
    expect(body('ui_seq')).not.toContain('ui_sqlen(k[1]));\n        ui_sqshift');
  });

  it('a deleted note takes its selection flag with it, and a note added later starts unselected', () => {
    expect(body('ui_sqdel')).toContain('ui_sqsl[l * 32 + i] = ui_sqsl[l * 32 + k];');
    expect(body('ui_sqadd')).toContain('ui_sqsl[l * 32 + n] = 0;');
    expect(body('ui_sqclear')).toContain('ui_sqdesel()');
  });

  it('shows the four brush lengths as buttons, then straight / triplet / dotted', () => {
    const seq = body('ui_seq');
    expect(seq).toMatch(/loop\(4,\s*ui_sqname\(i \* 3 \+ 0\);/);
    expect(seq).toContain('"STR"');
    expect(seq).toContain('"TRI"');
    expect(seq).toContain('"DOT"');
  });

  it('keeps the buffer pointer and brush across the @init rerun on Play, like the pattern in them', () => {
    const ready = toolkit.slice(toolkit.indexOf('ui_ready ? ( ui_hash = -1; ) : ('));
    expect(ready.slice(0, ready.indexOf('ui_ready = 1;'))).toContain('ui_sqb = 0;');
    expect(ready.slice(0, ready.indexOf('ui_ready = 1;'))).toContain('ui_sqbl = 2;');
  });

  it('a note length is a code (value * 3 + feel): 1/4 1/8 1/16 1/32, straight, triplet, dotted', () => {
    const len = (c: number) => {
      const v = Math.floor(c / 3);
      const f = c - v * 3;
      return Math.floor((96 / 2 ** v) * (f === 1 ? 2 / 3 : f === 2 ? 1.5 : 1) + 0.5);
    };
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(len)).toEqual([96, 64, 144, 48, 32, 72, 24, 16, 36, 12, 8, 18]);
    expect(body('ui_sqlen')).toContain('96 / (2 ^ v)');
  });
});
