import { describe, it, expect } from 'vitest';
import { lintJsfx, errorsOf, warningsOf, widgetCounts, LINT_RULES } from './lint.js';

/** The smallest source that passes: one knob, a boot, a changed hook. */
const OK = `desc:Gain
slider1:0<-24,12,0.1>Gain
@init
update() ( gain = 10 ^ (slider1 / 20); );
update(); ui_boot(0);
@block
ui_changed() ? update();
@sample
spl0 *= gain; spl1 *= gain;
@gfx 200 120
ui_begin(1, 0) ? ( ui_row(1); ui_knob(1, "Gain", 1); ui_end(); );
`;
const rules = (src: string) => lintJsfx(src).map((f) => f.rule);
const without = (src: string, line: string) => src.replace(line, '');

describe('lintJsfx', () => {
  it('counts the sliders a band knob and the threshold lines cover as drawn, and refuses one that is not declared', () => {
    const base = `desc:Bands
slider1:200<40,800,1>Low crossover
slider2:-18<-60,0,0.1>Low threshold
slider3:-18<-60,0,0.1>High threshold
slider4:3<1,20,0.1>Low ratio
slider5:3<1,20,0.1>High ratio
slider6:0<-12,12,0.1>Low gain
slider7:0<-12,12,0.1>High gain
@init
ui_boot(2);
@block
ui_changed();
@gfx 300 200
ui_begin(2, 0) ? ( ui_tall(2); ui_row(1); ui_freqgraph("Bands"); ui_fhandle(1, "X"); ui_fthresh(2, 4, 6, 2);
  ui_row(2); ui_bandknob(2, 2, "Threshold", 1); ui_bandknob(4, 2, "Ratio", 0); ui_bandknob(6, 2, "Gain", 1); ui_end(); );
`;
    expect(rules(base)).not.toContain('slider-without-widget');
    expect(rules(base.replace('ui_bandknob(6, 2,', 'ui_bandknob(6, 4,'))).toContain('widget-unknown-slider');
    expect(rules(base.replace('ui_fthresh(2, 4, 6, 2);', ''))).not.toContain('slider-without-widget'); // the band knobs still cover them
  });

  it('per-band levels: ui_fband covers one slider a band and refuses ones that are not declared', () => {
    const src = `desc:Split
slider1:300<40,8000,1>Crossover
slider2:0<-12,12,0.1>Low level
slider3:0<-12,12,0.1>High level
@init
ui_boot(2);
@block
ui_changed();
@gfx 300 200
ui_begin(2, 0) ? ( ui_tall(2); ui_row(1); ui_freqgraph("Split"); ui_fhandle(1, "X"); ui_fband(2, 2, 1);
  ui_row(1); ui_bandknob(2, 2, "Level", 1); ui_end(); );
`;
    expect(rules(src)).not.toContain('slider-without-widget');
    expect(rules(src.replace('ui_fband(2, 2, 1)', 'ui_fband(2, 3, 1)'))).toContain('widget-unknown-slider');
  });

  it('warns about a buffer placed inside the toolkit graph data (below 2048)', () => {
    expect(rules(OK.replace('update(); ui_boot(0);', 'update(); buf = 1200; ui_boot(0);'))).toContain('low-memory-index');
    expect(rules(OK.replace('update(); ui_boot(0);', 'update(); buf = 2048; ui_boot(0);'))).not.toContain('low-memory-index');
  });

  it('passes the smallest valid plugin without findings', () => {
    expect(lintJsfx(OK)).toEqual([]);
  });

  it('refuses scientific notation, which makes EEL2 drop the whole plugin', () => {
    const f = lintJsfx(OK.replace('spl0 *= gain;', 'spl0 *= gain + 1e-9;'));
    expect(errorsOf(f).map((x) => x.rule)).toContain('science-literal');
    expect(f.find((x) => x.rule === 'science-literal')?.line).toBe(9);
  });

  it('refuses a while loop whose body is not in parentheses, which REAPER cannot compile', () => {
    const bare = OK.replace('spl0 *= gain;', 'while (gain < 0) gain += 1; spl0 *= gain;');
    expect(errorsOf(lintJsfx(bare)).map((x) => x.rule)).toContain('while-no-body');
    const ok = OK.replace('spl0 *= gain;', 'while (gain < 0) ( gain += 1; ); spl0 *= gain;');
    expect(errorsOf(lintJsfx(ok)).map((x) => x.rule)).not.toContain('while-no-body');
  });

  it('refuses max/min with three arguments, which REAPER cannot compile', () => {
    const f = lintJsfx(OK.replace('spl0 *= gain;', 'spl0 *= max(gain, abs(spl0), 0.5);'));
    expect(errorsOf(f).map((x) => x.rule)).toContain('two-arg-minmax');
    expect(rules(OK.replace('spl0 *= gain;', 'spl0 *= max(max(gain, abs(spl0)), 0.5);'))).toEqual([]);
  });

  it('ignores a literal that only appears in a comment', () => {
    expect(rules(OK.replace('@sample', '// was 1e-9\n@sample'))).toEqual([]);
  });

  it('refuses a named slider, because the toolkit reads sliders by number', () => {
    expect(rules(OK.replace('slider1:0<', 'slider1:g=0<'))).toContain('named-slider');
  });

  it('refuses a slider that has no widget unless its label is hidden with a dash', () => {
    const two = OK.replace('slider1:0<-24,12,0.1>Gain', 'slider1:0<-24,12,0.1>Gain\nslider2:0<0,1,0.01>Extra');
    expect(rules(two)).toContain('slider-without-widget');
    expect(rules(two.replace('>Extra', '>-Extra'))).not.toContain('slider-without-widget');
  });

  it('refuses a choice with more than 8 options, because the toolkit has 8 label slots per slider', () => {
    const many = (n: number) => OK.replace('slider1:0<-24,12,0.1>Gain', `slider1:0<0,${n - 1},1{${Array.from({ length: n }, (_, i) => `O${i}`).join(',')}}>Gain`);
    expect(rules(many(9))).toContain('too-many-options');
    expect(rules(many(8))).not.toContain('too-many-options');
  });

  it('refuses a widget that points at a slider nobody declared', () => {
    expect(rules(OK.replace('ui_knob(1,', 'ui_knob(7,'))).toContain('widget-unknown-slider');
  });

  it('keeps the core view small: six widgets before the first section is refused', () => {
    const sliders = [1, 2, 3, 4, 5, 6].map((i) => `slider${i}:0<0,1,0.01>S${i}`).join('\n');
    const knobs = [1, 2, 3, 4, 5, 6].map((i) => `ui_knob(${i}, "S${i}", 0);`).join(' ');
    const six = `desc:Six\n${sliders}\n@init\nui_boot(0);\n@block\nui_changed() ? 0;\n@gfx 300 200\nui_begin(1,0) ? ( ui_row(6); ${knobs} ui_end(); );\n`;
    expect(errorsOf(lintJsfx(six)).map((x) => x.rule)).toContain('core-overflow');
    const split = six.replace('ui_knob(4,', 'ui_section("Advanced") ? ( ui_row(3); ui_knob(4,').replace('ui_end();', ' ); ui_end();');
    expect(rules(split)).not.toContain('core-overflow');
  });

  it('counts core and advanced widgets for the plugin shape', () => {
    const src = OK.replace('ui_end();', 'ui_section("Advanced") ? ( ui_knob(1, "a", 0); ui_toggle(1, "b"); ); ui_end();');
    expect(widgetCounts(src)).toEqual({ core: 1, advanced: 2 });
  });

  it('refuses a plugin that never boots the toolkit or never hears the knobs', () => {
    expect(rules(without(OK, 'update(); ui_boot(0);'))).toContain('no-ui-boot');
    expect(rules(without(OK, 'ui_changed() ? update();'))).toContain('no-changed');
  });

  it('refuses gmem: a generated plugin must not depend on the bridge', () => {
    expect(rules(OK.replace('slider1', 'options:gmem=Foo\nslider1'))).toContain('gmem');
  });

  it('refuses local() at the top level of @sample', () => {
    expect(rules(OK.replace('spl0 *= gain;', 'local(a); spl0 *= gain;'))).toContain('local-top-level');
  });

  it('refuses a slider past slider32 (the toolkit passes slider masks, and 32 is plenty)', () => {
    expect(rules(OK.replace('@init', 'slider33:0<0,1,1>-x\n@init'))).toContain('slider-limit');
  });

  it('warns, without refusing, about work per sample', () => {
    const f = lintJsfx(OK.replace('spl0 *= gain;', 'loop(4, spl0 *= gain;); spl1 /= srate;'));
    expect(errorsOf(f)).toEqual([]);
    expect(warningsOf(f).map((x) => x.rule).sort()).toEqual(['sample-divide-srate', 'sample-loop']);
  });

  it('warns when the plugin sets ui_adv_open, which would close the drawer every time Play re-runs @init', () => {
    const f = lintJsfx(OK.replace('update(); ui_boot(0);', 'update(); ui_adv_open = 0; ui_boot(0);'));
    expect(errorsOf(f)).toEqual([]);
    expect(warningsOf(f).map((x) => x.rule)).toEqual(['ui-state-reset']);
    expect(rules(OK.replace('ui_end();', 'ui_adv_open == 1 ? 0; ui_end();'))).not.toContain('ui-state-reset');
  });

  it('does not flag the one-argument while (stmt; cond); or a while ( inside a string', () => {
    expect(rules(OK.replace('update(); ui_boot(0);', 'update(); while (i += 1; i < 4); ui_boot(0);'))).not.toContain('while-no-body');
    expect(rules(OK.replace('update(); ui_boot(0);', 'update(); sprintf(#s, "while (x) y"); ui_boot(0);'))).not.toContain('while-no-body');
  });

  it('allows closing the drawer right after @serialize loaded a state (REAPER\'s undo loads state back mid-session)', () => {
    const guarded = OK.replace('update(); ui_boot(0);', 'update(); file_avail(0) >= 0 ? ui_adv_open = 0; ui_boot(0);');
    expect(rules(guarded)).not.toContain('ui-state-reset');
  });

  it('warns when the plugin sets its own accent, which write_jsfx owns', () => {
    const f = lintJsfx(OK.replace('update(); ui_boot(0);', 'update(); ui_cAccent = $xff8800; ui_boot(0);'));
    expect(errorsOf(f)).toEqual([]);
    expect(warningsOf(f).map((x) => x.rule)).toEqual(['accent-assign']);
    expect(rules(OK.replace('update(); ui_boot(0);', 'update(); ui_theme($xff8800); ui_boot(0);'))).toContain('accent-assign');
    expect(rules(OK)).not.toContain('accent-assign');
  });

  it('warns when the plugin reads the keyboard, which the value box needs', () => {
    expect(rules(OK.replace('ui_end();', 'c = gfx_getchar(); ui_end();'))).toContain('own-key-handling');
  });

  it('unknown-ui-call: refuses a misspelled toolkit function, which EEL2 would compile to nothing', () => {
    const f = lintJsfx(OK.replace('ui_knob(1, "Gain", 1);', 'ui_knbo(1, "Gain", 1);'));
    expect(errorsOf(f).map((x) => x.rule)).toContain('unknown-ui-call');
    expect(f.find((x) => x.rule === 'unknown-ui-call')?.line).toBe(11);
    expect(rules(OK.replace('ui_end();', 'function ui_mine(a) ( a; ); ui_mine(1); ui_end();'))).not.toContain('unknown-ui-call');
  });

  it('ui-arity: refuses a toolkit call with the wrong number of arguments, but not a comma inside a label', () => {
    expect(rules(OK.replace('ui_knob(1, "Gain", 1);', 'ui_knob(1, "Gain");'))).toContain('ui-arity');
    expect(rules(OK.replace('ui_knob(1, "Gain", 1);', 'ui_knob(1, "Gain", 1, 2);'))).toContain('ui-arity');
    expect(rules(OK.replace('ui_knob(1, "Gain", 1);', 'ui_knob(1, "Gain, in dB", 1);'))).toEqual([]);
    expect(rules(OK.replace('ui_end();', 'ui_end(1);'))).toContain('ui-arity');
  });

  it('counts a graph as one widget and binds band handles and the transfer curve to their sliders', () => {
    const sliders = [1, 2, 3, 4].map((i) => `slider${i}:100<20,2000,1>S${i}`).join('\n');
    const src = `desc:G\n${sliders}\n@init\nui_boot(2);\n@block\nui_changed() ? 0;\n@gfx 300 200\nui_begin(2,0) ? ( ui_row(1); ui_freqgraph("X"); ui_fhandle(1, "a"); ui_fhandle(2, "b"); ui_row(1); ui_transfer(3, 4, 6); ui_end(); );\n`;
    expect(lintJsfx(src)).toEqual([]);
    expect(widgetCounts(src)).toEqual({ core: 2, advanced: 0 });
    expect(rules(src.replace('ui_transfer(3, 4, 6)', 'ui_transfer(3, 9, 6)'))).toContain('widget-unknown-slider');
    expect(rules(src.replace('ui_fhandle(2, "b");', ''))).toContain('slider-without-widget');
  });

  it('only ever reports rules from the closed list (they become a metric attribute)', () => {
    const messy = OK.replace('slider1:0<', 'slider1:g=9<').replace('@init', 'options:gmem=x\n@init');
    for (const f of lintJsfx(messy)) expect(LINT_RULES).toContain(f.rule);
  });
});
