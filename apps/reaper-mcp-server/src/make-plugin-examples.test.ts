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
  it('ships the three v1 examples', () => {
    expect(files.sort()).toEqual(['mutate-verb.jsfx', 'tape-sat.jsfx', 'width-bass-mono.jsfx']);
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

describe('the toolkit itself', () => {
  const toolkit = loadToolkit();
  const top = toolkit.replace(/\/\/[^\n]*/g, '');

  it('is version 1.2.0: same widget API as 1.0, so earlier plugins re-inline without changes', async () => {
    const { toolkitVersion } = await import('./jsfx/inline.js');
    expect(toolkitVersion(toolkit)).toBe('1.2.0');
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
