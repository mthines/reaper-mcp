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
    expect(draw).toMatch(/y = 4 \* ui_s;/); // inside the padding: the first row still starts at ui_pad
    expect(draw).toMatch(/\+ 1\.6 \* ui_s/); // letter spacing
    expect(body('ui_begin')).toMatch(/ui_y = ui_pad;/);
  });

  it('name header: hides in a very narrow window instead of colliding with the controls', () => {
    expect(body('ui_namedraw')).toMatch(/gfx_w >= 150 \* ui_s/);
    expect(body('ui_namedraw')).toMatch(/x < gfx_w - ui_pad/);
  });

  it('name header: the plugin name that write_jsfx inlines is the desc without the developer suffix', () => {
    const out = inlineToolkit('desc:Warm Tape\nslider1:0<0,1,0.01>Mix\n@init\nui_boot(0);\n@gfx 100 100\nui_begin(1,0) ? ( ui_end(); );\n', { toolkit, version: 1 });
    expect(out).toContain('strcpy(#ui_name, "Warm Tape");');
    expect(out).toContain('desc:Warm Tape (reaper-mcp)');
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

describe('toolkit 1.3: the memory map', () => {
  it('memory map: graph data starts at 1024 or above, in regions that never overlap', () => {
    const regions = [
      { name: 'ui_fg', size: number('ui_gn') }, // one point per trace slot
      { name: 'ui_ge', size: 16 },
      { name: 'ui_grm', size: 8 },
      { name: 'ui_kb', size: 128 },
    ].map((r) => ({ ...r, start: number(r.name) }));
    for (const r of regions) expect(r.start, r.name).toBeGreaterThanOrEqual(1024);
    for (let i = 1; i < regions.length; i++) expect(regions[i].start).toBeGreaterThanOrEqual(regions[i - 1].start + regions[i - 1].size);
    expect(number('ui_mem')).toBeGreaterThanOrEqual(regions[regions.length - 1].start + 128);
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
