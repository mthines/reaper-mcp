import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accentOf, inlineToolkit, parseSliders, readVersion, toolkitVersion } from './inline.js';
import { loadToolkit } from '../tools/jsfx.js';

const SRC = `desc:Gain
import mcp_ui.jsfx-inc
slider1:0<-24,12,0.1>Gain
slider2:1<0,1,1{Slow,Fast}>Speed
@init
ui_boot(0);
@gfx 200 120
ui_begin(1,0) ? ( ui_end(); );
`;
const opts = { toolkit: '// toolkit, v1.2.3\nui_ver = 1;\n', version: 1 };
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('inlineToolkit', () => {
  const out = inlineToolkit(SRC, opts);

  it('produces one file with no import line and exactly one toolkit block', () => {
    expect(out).not.toMatch(/^\s*import\s/m);
    expect(count(out, '// ---- mcp_ui ')).toBe(1);
    expect(out).toContain('ui_ver = 1;');
  });

  it('puts the toolkit before the plugin\'s own @init code, inside @init', () => {
    const init = out.indexOf('@init');
    expect(out.indexOf('ui_ver = 1;')).toBeGreaterThan(init);
    expect(out.indexOf('ui_ver = 1;')).toBeLessThan(out.indexOf('ui_boot(0);'));
  });

  it('hands the slider ranges, defaults and option names to the toolkit', () => {
    expect(out).toContain('ui_meta(1, -24, 12, 0, 0.1);');
    expect(out).toContain('ui_meta(2, 0, 1, 1, 1);');
    expect(out).toContain('strcpy(16, "Slow");');
    expect(out).toContain('strcpy(17, "Fast");');
  });

  it('adds the tags line, the header and a @serialize', () => {
    expect(out).toContain('tags:reaper-mcp-generated');
    expect(out).toContain('// version: 1');
    expect(out).toContain('// toolkit: mcp_ui 1.2.3');
    expect(out).toContain('@serialize\nfile_var(0, ui_adv_open);');
  });

  it('keeps desc on the first line', () => {
    expect(out.split('\n')[0]).toBe('desc:Gain (reaper-mcp)');
  });

  it('is idempotent: feeding its own output back in changes nothing but the version', () => {
    const again = inlineToolkit(out, { ...opts, version: 2 });
    expect(again.replace('// version: 2', '// version: 1').replace('ui_pver = 2;', 'ui_pver = 1;')).toBe(out);
    expect(readVersion(again)).toBe(2);
  });

  it('replaces an older toolkit block with the current one when a plugin is edited', () => {
    const old = inlineToolkit(SRC, { ...opts, toolkit: '// toolkit, v0.9.0\nui_ver = 0;\n' });
    const fresh = inlineToolkit(old, opts);
    expect(fresh).toContain('ui_ver = 1;');
    expect(fresh).not.toContain('ui_ver = 0;');
    expect(count(fresh, 'tags:reaper-mcp-generated')).toBe(1);
  });

  it('writes a number the way EEL2 reads it, never in scientific notation', () => {
    const tiny = inlineToolkit(SRC.replace('0<-24,12,0.1>', '0<-24,12,0.0000001>'), opts);
    expect(tiny).not.toMatch(/\d[eE][+-]?\d/);
  });

  it('puts a one-line request in the header as a comment, flattened', () => {
    expect(inlineToolkit(SRC, { ...opts, request: 'make it\nsound wide' })).toContain('// request: make it sound wide');
  });
});

describe('parseSliders', () => {
  it('reads range, step, default, options and the hidden flag', () => {
    const { sliders, bad } = parseSliders(SRC + '\n');
    expect(bad).toEqual([]);
    expect(sliders[0]).toMatchObject({ index: 1, min: -24, max: 12, step: 0.1, default: 0, name: 'Gain', hidden: false });
    expect(sliders[1].options).toEqual(['Slow', 'Fast']);
    expect(parseSliders('slider3:0<0,1,1>-ok\n').sliders[0]).toMatchObject({ hidden: true, name: 'ok' });
  });

  it('reports a slider line it cannot read instead of skipping it', () => {
    expect(parseSliders('slider1:oops\n').bad).toEqual([{ line: 1, text: 'slider1:oops' }]);
  });
});

describe('the shipped toolkit', () => {
  const toolkit = readFileSync(join(__dirname, '..', '..', '..', '..', 'reaper', 'mcp_ui.jsfx-inc'), 'utf8');

  it('has a version the header can report', () => {
    expect(toolkitVersion(toolkit)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(loadToolkit()).toBe(toolkit);
  });

  it('uses no scientific-notation literal (EEL2 drops the whole plugin on one)', () => {
    const code = toolkit.replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/(?<![\w.])\d+(?:\.\d+)?[eE][+-]?\d+(?![\w.])/);
  });

  it('prefixes every global it defines with ui_, so it cannot clash with a plugin', () => {
    for (const m of toolkit.matchAll(/^function\s+(\w+)/gm)) expect(m[1]).toMatch(/^ui_/);
  });
});

describe('the developer suffix', () => {
  const descOf = (src: string) => inlineToolkit(src, opts).split('\n')[0];

  it('adds " (reaper-mcp)" to desc once, also when fed its own output again', () => {
    const once = inlineToolkit(SRC, opts);
    expect(once.split('\n')[0]).toBe('desc:Gain (reaper-mcp)');
    expect(inlineToolkit(inlineToolkit(once, opts), opts).split('\n')[0]).toBe('desc:Gain (reaper-mcp)');
  });

  it('never doubles it when the source already has it', () => {
    expect(descOf(SRC.replace('desc:Gain', 'desc:Gain (reaper-mcp) (reaper-mcp)'))).toBe('desc:Gain (reaper-mcp)');
  });

  it("keeps the plugin's own trailing parenthetical and adds ours after it", () => {
    expect(descOf(SRC.replace('desc:Gain', 'desc:Width (stereo)'))).toBe('desc:Width (stereo) (reaper-mcp)');
  });

  it('shows the plain name in the About dialog', () => {
    expect(inlineToolkit(SRC.replace('desc:Gain', 'desc:Width (stereo)'), opts)).toContain('strcpy(#ui_name, "Width (stereo)");');
  });
});

describe('the accent', () => {
  it('derives the same colour from the same name every time, and a different one for another name', () => {
    const a = inlineToolkit(SRC, opts);
    expect(a).toMatch(/ui_theme\(\$x[0-9a-f]{6}\);/);
    expect(accentOf(a, 'gain')).toEqual(accentOf(inlineToolkit(SRC, opts), 'gain'));
    expect(a).not.toContain('// accent:');
  });

  it('keeps a named accent through an edit that does not mention it', () => {
    const orange = inlineToolkit(SRC, { ...opts, accent: 'orange' });
    expect(orange).toContain('// accent: orange');
    const edited = inlineToolkit(orange.replace('ui_boot(0);', 'ui_boot(1);'), { ...opts, version: 2 });
    expect(edited).toContain('// accent: orange');
    expect(accentOf(edited, 'gain')).toMatchObject({ kind: 'named', token: 'orange' });
  });

  it("drops it again with 'auto'", () => {
    const orange = inlineToolkit(SRC, { ...opts, accent: '#ff8800' });
    const auto = inlineToolkit(orange, { ...opts, accent: 'auto' });
    expect(auto).not.toContain('// accent:');
    expect(accentOf(auto, 'gain').kind).toBe('auto');
  });

  it('re-inlines a plugin written by toolkit 1.1.0 and gives it a colour and the About facts', () => {
    const v110 = readFileSync(join(__dirname, '__fixtures__', 'accent-probe-v1.1.0.jsfx'), 'utf8');
    const out = inlineToolkit(v110, { toolkit: loadToolkit(), version: readVersion(v110) + 1, slug: 'accent-probe', date: '2026-11-08' });
    expect(out.match(/\/\/ ---- mcp_ui /g)).toHaveLength(1);
    expect(out).toContain('// toolkit: mcp_ui 1.2.0');
    expect(out).toMatch(/ui_theme\(\$x[0-9a-f]{6}\);/);
    expect(out).toContain('strcpy(#ui_name, "Accent Probe"); strcpy(#ui_date, "2026-11-08");');
    expect(out.split('\n')[0]).toBe('desc:Accent Probe (reaper-mcp)');
  });
});
