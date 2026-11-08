import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineToolkit } from './jsfx/inline.js';
import { errorsOf, lintJsfx, widgetCounts, MAX_CORE_WIDGETS, MAX_ADVANCED_WIDGETS } from './jsfx/lint.js';
import { loadToolkit } from './tools/jsfx.js';
import { parseSliders } from './jsfx/inline.js';
import { resolvePresets } from './jsfx/presets.js';

const dir = join(__dirname, '..', '..', '..', '.claude', 'skills', 'make-plugin', 'examples');
const files = readdirSync(dir).filter((f) => f.endsWith('.jsfx'));

describe('the /make-plugin examples', () => {
  it('ships the three v1 examples and the multiband compressor', () => {
    expect(files.sort()).toEqual(['multiband-compressor.jsfx', 'mutate-verb.jsfx', 'tape-sat.jsfx', 'width-bass-mono.jsfx']);
  });

  for (const file of files) {
    describe(file, () => {
      const source = readFileSync(join(dir, file), 'utf8');

      it('lints clean: nothing to refuse, nothing to warn about', () => {
        expect(lintJsfx(source)).toEqual([]);
      });

      it('keeps to its own principles: a small core view and a bounded Advanced section', () => {
        const { core, advanced } = widgetCounts(source);
        expect(core).toBeGreaterThan(0);
        expect(core).toBeLessThanOrEqual(MAX_CORE_WIDGETS);
        expect(advanced).toBeLessThanOrEqual(MAX_ADVANCED_WIDGETS);
      });

      it('ships 3-5 suggested presets whose every value fits its slider', () => {
        const presets = JSON.parse(readFileSync(join(dir, file.replace(/\.jsfx$/, '.presets.json')), 'utf8'));
        expect(presets.length).toBeGreaterThanOrEqual(3);
        expect(presets.length).toBeLessThanOrEqual(5);
        expect(resolvePresets(presets, parseSliders(source).sliders).errors).toEqual([]);
      });

      it('inlines into a single self-contained file that still lints for the toolkit hooks', () => {
        const out = inlineToolkit(source, { toolkit: loadToolkit(), version: 1 });
        expect(out).not.toMatch(/^\s*import\s/m);
        expect(out).not.toMatch(/options:[^\n]*gmem/);
        expect(errorsOf(lintJsfx(out))).toEqual([]);
      });
    });
  }
});

describe('the toolkit and the shipped examples', () => {
  it('call max and min with exactly two arguments (EEL2 refuses the whole plugin otherwise)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '../../..');
    const files = [
      join(root, 'reaper/mcp_ui.jsfx-inc'),
      ...readdirSync(join(root, '.claude/skills/make-plugin/examples')).filter((f) => f.endsWith('.jsfx')).map((f) => join(root, '.claude/skills/make-plugin/examples', f)),
    ];
    const bad: string[] = [];
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '');
      for (const m of code.matchAll(/\b(?:max|min)\s*\(/g)) {
        let depth = 1, count = 1;
        for (let i = (m.index ?? 0) + m[0].length; i < code.length && depth > 0; i++) {
          if (code[i] === '(') depth++; else if (code[i] === ')') depth--; else if (code[i] === ',' && depth === 1) count++;
        }
        if (count !== 2) bad.push(`${f}: ${code.slice(m.index, (m.index ?? 0) + 40)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the multiband compressor example', () => {
  const source = readFileSync(join(dir, 'multiband-compressor.jsfx'), 'utf8');

  it('multiband: shows the graph, its two crossover handles, the reduction bars and the transfer curve, within the widget limits', () => {
    expect(source).toMatch(/ui_freqgraph\(/);
    expect(source.match(/ui_fhandle\(/g)).toHaveLength(2);
    expect(source).toMatch(/ui_grmeter\(3,/);
    expect(source).toMatch(/ui_transfer\(3, 4,/);
    const { core, advanced } = widgetCounts(source);
    expect(core).toBe(5);
    expect(advanced).toBeLessThanOrEqual(MAX_ADVANCED_WIDGETS);
  });

  it('multiband: feeds the graph from the audio thread and keeps the redraw activity-driven', () => {
    expect(source).toMatch(/ui_boot\(2\)/);
    for (const feed of ['ui_gfeed(', 'ui_gr(', 'ui_glevel(']) expect(source).toContain(feed);
  });

  it('multiband: carries an accent line and 3-5 presets that fit its sliders', () => {
    expect(source).toMatch(/^\/\/ accent: \S+/m);
    const presets = JSON.parse(readFileSync(join(dir, 'multiband-compressor.presets.json'), 'utf8'));
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(resolvePresets(presets, parseSliders(source).sliders).errors).toEqual([]);
  });

  it('multiband: installs with the other examples when setup runs', async () => {
    const { mkdtempSync, rmSync, readFileSync: read, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { installExamplePlugins } = await import('./jsfx/examples.js');
    const out = mkdtempSync(join(tmpdir(), 'mbc-'));
    try {
      const result = installExamplePlugins(dir, join(out, 'Effects', 'reaper-mcp-generated', 'examples'), loadToolkit(), join(out, 'presets'));
      expect(result.installed).toContain('multiband-compressor.jsfx');
      expect(result.presetErrors).toEqual([]);
      expect(result.presets['multiband-compressor.jsfx'].length).toBeGreaterThanOrEqual(3);
      const installed = join(out, 'Effects', 'reaper-mcp-generated', 'examples', 'multiband-compressor.jsfx');
      expect(existsSync(installed)).toBe(true);
      expect(read(installed, 'utf8')).toContain('function ui_freqgraph(');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('the toolkit itself', () => {
  const toolkit = loadToolkit();
  const top = toolkit.replace(/\/\/[^\n]*/g, '');

  it('is version 1.3.0: the 1.0 widget API unchanged, so earlier plugins re-inline without changes', async () => {
    const { toolkitVersion } = await import('./jsfx/inline.js');
    expect(toolkitVersion(toolkit)).toBe('1.3.0');
  });

  it('sets the drawer state once, so REAPER re-running @init on Play never closes the Advanced drawer', () => {
    const guard = top.indexOf('ui_ready ?');
    const guardEnd = top.indexOf('ui_ready = 1;');
    expect(guard).toBeGreaterThan(-1);
    const firstFunction = top.indexOf('function ');
    // every top-level (not inside a function) assignment of the drawer state sits inside the once-only guard
    for (const m of top.slice(0, firstFunction).matchAll(/\bui_(adv_open|p)\s*=(?!=)/g)) {
      expect(m.index).toBeGreaterThan(guard);
      expect(m.index).toBeLessThan(guardEnd);
    }
  });

  it('credits reaper-mcp in a footer that one constant hides', () => {
    expect(toolkit).toContain('github.com/mthines/reaper-mcp');
    expect(top).toMatch(/^ui_credit = 1;/m);
  });

  it('a plugin built with it keeps no hand-written drawer state (the lint warns about ui_adv_open)', () => {
    for (const file of files) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(lintJsfx(src).map((f) => f.rule)).not.toContain('ui-state-reset');
    }
  });
});
