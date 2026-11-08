import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installExamplePlugins } from './examples.js';

const TOOLKIT = '// toolkit, v1.0.0\nui_ver = 1;\n';
const EXAMPLE = (gain: string) => `desc:Demo\nslider1:${gain}<0,1,0.01>Gain\n@init\nui_boot(0);\n@gfx 100 100\nui_begin(1,0) ? ( ui_end(); );\n`;
let root: string;
let src: string;
let out: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'examples-'));
  src = join(root, 'src'); out = join(root, 'out');
  mkdirSync(src);
  writeFileSync(join(src, 'demo.jsfx'), EXAMPLE('0.5'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('installExamplePlugins', () => {
  it('installs each example as a self-contained plugin', () => {
    expect(installExamplePlugins(src, out, TOOLKIT).installed).toEqual(['demo.jsfx']);
    const text = readFileSync(join(out, 'demo.jsfx'), 'utf8');
    expect(text).toContain('ui_ver = 1;');
    expect(text).not.toMatch(/^\s*import\s/m);
  });

  it('updates an example the user never touched when a new version ships', () => {
    installExamplePlugins(src, out, TOOLKIT);
    writeFileSync(join(src, 'demo.jsfx'), EXAMPLE('0.7'));
    expect(installExamplePlugins(src, out, TOOLKIT).installed).toEqual(['demo.jsfx']);
    expect(readFileSync(join(out, 'demo.jsfx'), 'utf8')).toContain('0.7<0,1,0.01>Gain');
  });

  it('never overwrites an example the user edited', () => {
    installExamplePlugins(src, out, TOOLKIT);
    writeFileSync(join(out, 'demo.jsfx'), 'desc:My own version\n');
    writeFileSync(join(src, 'demo.jsfx'), EXAMPLE('0.7'));
    expect(installExamplePlugins(src, out, TOOLKIT)).toMatchObject({ installed: [], kept: ['demo.jsfx'] });
    expect(readFileSync(join(out, 'demo.jsfx'), 'utf8')).toBe('desc:My own version\n');
  });

  it('does nothing, and creates nothing, when the package ships no examples', () => {
    expect(installExamplePlugins(join(root, 'none'), out, TOOLKIT)).toMatchObject({ installed: [], kept: [] });
    expect(() => readdirSync(out)).toThrow();
  });

  it('writes each example\'s suggested presets into REAPER\'s preset file, keeping presets the user saved there', async () => {
    const { parsePresetFile, encodePreset, formatPresetFile } = await import('./presets.js');
    const presets = join(root, 'presets');
    writeFileSync(join(src, 'demo.presets.json'), JSON.stringify([{ name: 'Quiet', values: { Gain: 0.1 } }, { name: 'Loud', values: { Gain: 0.9 } }]));
    expect(installExamplePlugins(src, join(out, 'reaper-mcp-generated', 'examples'), TOOLKIT, presets).presets).toEqual({ 'demo.jsfx': ['Quiet', 'Loud'] });
    const file = join(presets, 'js-reaper-mcp-generated_examples_demo_jsfx.ini');
    expect(parsePresetFile(readFileSync(file, 'utf8')).map((p) => p.name)).toEqual(['Quiet', 'Loud']);

    // the user saves a preset of their own in REAPER, then a new version of the examples ships
    writeFileSync(file, formatPresetFile([...parsePresetFile(readFileSync(file, 'utf8')), encodePreset('Mine', new Map([[1, 0.4]]))]));
    writeFileSync(join(src, 'demo.presets.json'), JSON.stringify([{ name: 'Quiet', values: { Gain: 0.2 } }]));
    installExamplePlugins(src, join(out, 'reaper-mcp-generated', 'examples'), TOOLKIT, presets);
    expect(parsePresetFile(readFileSync(file, 'utf8')).map((p) => p.name).sort()).toEqual(['Mine', 'Quiet']);
  });

  it('skips an example preset file with a bad value instead of writing it', () => {
    writeFileSync(join(src, 'demo.presets.json'), JSON.stringify([{ name: 'Too much', values: { Gain: 5 } }]));
    const r = installExamplePlugins(src, out, TOOLKIT, join(root, 'presets'));
    expect(r.presetErrors.join(' ')).toContain('outside 0..1');
    expect(readdirSync(root)).not.toContain('presets');
  });
});
