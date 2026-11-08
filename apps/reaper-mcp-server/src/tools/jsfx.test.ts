import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from '@opentelemetry/api';
import { tracing, node } from '@opentelemetry/sdk-node';
import { AnonymizingSpanExporter } from '../telemetry-consent.js';

vi.mock('../tool-log.js', () => ({ logToolResult: vi.fn() }));
vi.mock('../bridge.js', async (orig) => ({ ...(await orig<typeof import('../bridge.js')>()), getReaperEffectsPath: () => join(process.env.REAPER_RESOURCE_PATH as string, 'Effects') }));

import { registerJsfxTools } from './jsfx.js';
import { decodePresetValues, encodePreset, formatPresetFile, parsePresetFile } from '../jsfx/presets.js';
import { writeFileSync } from 'node:fs';

const SRC = (extra = '') => `desc:Secret Name
slider1:0<-24,12,0.1>Gain
${extra}@init
update() ( gain = 10 ^ (slider1 / 20); );
update(); ui_boot(0);
@block
ui_changed() ? update();
@sample
spl0 *= gain; spl1 *= gain;
@gfx 200 120
ui_begin(1, 0) ? ( ui_row(1); ui_knob(1, "Gain", 1); ui_end(); );
`;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
let call: Handler;
let root: string;
const exporter = new tracing.InMemorySpanExporter();

beforeAll(() => {
  const provider = new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(exporter))] });
  provider.register();
  const handlers: Record<string, Handler> = {};
  registerJsfxTools({ tool: (name: string, _d: string, _s: unknown, cb: Handler) => { handlers[name] = cb; } } as never);
  call = (args) => trace.getTracer('test').startActiveSpan('tools/call write_jsfx', async (span) => {
    try { return await handlers.write_jsfx(args); } finally { span.end(); }
  });
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jsfx-'));
  process.env.REAPER_RESOURCE_PATH = root;
  process.env.REAPER_MCP_CONFIG_DIR = join(root, 'config');
  exporter.reset();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = (slug: string) => join(root, 'Effects', 'reaper-mcp-generated', `${slug}.jsfx`);
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const attrs = () => exporter.getFinishedSpans().at(-1)?.attributes ?? {};

describe('write_jsfx', () => {
  it('writes one self-contained plugin and says how to load it', async () => {
    const r = await call({ name: 'Secret Name!', source: SRC() });
    expect(r.isError).toBeUndefined();
    const out = body(r);
    expect(out).toMatchObject({ fxName: 'reaper-mcp-generated/secret-name', version: 1 });
    expect(out.sliders).toEqual([{ index: 1, name: 'Gain', min: -24, max: 12, default: 0, hidden: false }]);
    const written = readFileSync(file('secret-name'), 'utf8');
    expect(written).toContain('ui_ver');
    expect(written).not.toMatch(/^\s*import\s/m);
  });

  it('refuses a plugin that fails the lint and writes nothing, naming each problem', async () => {
    const r = await call({ name: 'Bad', source: SRC().replace('spl0 *= gain;', 'spl0 *= gain + 1e-9;') });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('science-literal');
    expect(existsSync(file('bad'))).toBe(false);
  });

  it('will not replace an existing plugin without overwrite', async () => {
    await call({ name: 'Twice', source: SRC() });
    const r = await call({ name: 'Twice', source: SRC() });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('overwrite');
  });

  it('bumps the version on overwrite and keeps the old file outside Effects/', async () => {
    await call({ name: 'Keep', source: SRC() });
    const r = await call({ name: 'Keep', source: SRC('slider2:0<0,1,0.01>Extra\n').replace('ui_end();', 'ui_knob(2, "Extra", 0); ui_end();'), overwrite: true });
    expect(body(r).version).toBe(2);
    expect(readdirSync(join(root, 'config', 'jsfx-history', 'keep'))).toHaveLength(1);
    expect(readdirSync(join(root, 'Effects', 'reaper-mcp-generated'))).toEqual(['keep.jsfx']);
  });

  it('accepts its own output back as the source of an edit', async () => {
    await call({ name: 'Round', source: SRC() });
    const edited = readFileSync(file('round'), 'utf8').replace('Gain"', 'Level"');
    const r = await call({ name: 'Round', source: edited, overwrite: true });
    expect(r.isError).toBeUndefined();
    expect(readFileSync(file('round'), 'utf8').match(/\/\/ ---- mcp_ui /g)).toHaveLength(1);
  });

  it('refuses to renumber or re-range a slider unless breaking is set, because saved automation would break', async () => {
    await call({ name: 'Auto', source: SRC() });
    const changed = SRC().replace('<-24,12,0.1>', '<-48,12,0.1>');
    const refused = await call({ name: 'Auto', source: changed, overwrite: true });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('slider1');
    expect(readFileSync(file('auto'), 'utf8')).toContain('-24, 12');
    const allowed = await call({ name: 'Auto', source: changed, overwrite: true, breaking: true });
    expect(allowed.isError).toBeUndefined();
  });

  it('refuses reordered choice options unless breaking is set, because saved values would select another option', async () => {
    const choice = SRC('slider2:0<0,1,1{Off,On}>Mode\n').replace('ui_end();', 'ui_choice(2, "Mode"); ui_end();');
    await call({ name: 'Order', source: choice });
    const reordered = choice.replace('{Off,On}', '{On,Off}');
    expect((await call({ name: 'Order', source: reordered, overwrite: true })).isError).toBe(true);
    expect((await call({ name: 'Order', source: reordered, overwrite: true, breaking: true })).isError).toBeUndefined();
  });

  it('allows fixing the spelling of a choice option, since saved values store its position', async () => {
    const choice = SRC('slider2:0<0,1,1{Of,On}>Mode\n').replace('ui_end();', 'ui_choice(2, "Mode"); ui_end();');
    await call({ name: 'Typo', source: choice });
    const r = await call({ name: 'Typo', source: choice.replace('{Of,On}', '{Off,On}'), overwrite: true });
    expect(r.isError).toBeUndefined();
  });

  it('does not call an unchanged slider breaking when its option labels repeat', async () => {
    const choice = SRC('slider2:0<0,3,1{Off,,On,}>Mode\n').replace('ui_end();', 'ui_choice(2, "Mode"); ui_end();');
    await call({ name: 'Repeat', source: choice });
    expect((await call({ name: 'Repeat', source: choice, overwrite: true })).isError).toBeUndefined();
  });

  it('refuses a name with no letters or digits', async () => {
    expect((await call({ name: '!!!', source: SRC() })).isError).toBe(true);
  });
});

const PRESET_SRC = SRC('slider2:1<0,2,1{Soft,Hard,Fold}>Mode\n').replace('ui_end();', 'ui_choice(2, "Mode"); ui_end();');
const presetFile = (slug: string) => join(root, 'presets', `js-reaper-mcp-generated_${slug}_jsfx.ini`);
const presetsIn = (slug: string) => parsePresetFile(readFileSync(presetFile(slug), 'utf8'));

describe('write_jsfx presets', () => {
  it('writes suggested presets into the file REAPER lists in the plugin\'s preset dropdown', async () => {
    const r = await call({ name: 'Crush', source: PRESET_SRC, presets: [
      { name: 'Warm bus', values: { Gain: -3 } },
      { name: 'Broken tape', values: { 1: 6, slider2: 2 } },
    ] });
    expect(r.isError).toBeUndefined();
    expect(body(r).presets.written).toEqual(['Warm bus', 'Broken tape']);
    const saved = presetsIn('crush');
    expect(saved.map((p) => p.name)).toEqual(['Warm bus', 'Broken tape']);
    // a slider the preset leaves out takes its default; sliders the plugin lacks stay unset
    expect([...decodePresetValues(saved[0].data)]).toEqual([[1, -3], [2, 1]]);
    expect([...decodePresetValues(saved[1].data)]).toEqual([[1, 6], [2, 2]]);
    // byte-for-byte what REAPER itself writes for these values
    expect(saved[1]).toEqual(encodePreset('Broken tape', new Map([[1, 6], [2, 2]])));
  });

  it('refuses the whole call on one bad value and writes neither the plugin nor a preset', async () => {
    const r = await call({ name: 'Crush', source: PRESET_SRC, presets: [
      { name: 'Fine', values: { Gain: 0 } },
      { name: 'Too hot', values: { Gain: 40 } },
      { name: 'Off grid', values: { Mode: 1.5 } },
      { name: 'Ghost', values: { Nope: 1 } },
    ] });
    expect(r.isError).toBe(true);
    for (const bit of ['Too hot', 'outside -24..12', 'Off grid', 'step', 'no slider "Nope"']) expect(r.content[0].text).toContain(bit);
    expect(existsSync(file('crush'))).toBe(false);
    expect(existsSync(presetFile('crush'))).toBe(false);
  });

  it('replaces only its own presets: one the user saved in REAPER, or one of ours they changed, stays', async () => {
    await call({ name: 'Crush', source: PRESET_SRC, presets: [{ name: 'Warm bus', values: { Gain: -3 } }, { name: 'Loud', values: { Gain: 6 } }] });
    const mine = encodePreset('My drums', new Map([[1, 2], [2, 0]]));
    const edited = { ...encodePreset('Loud', new Map([[1, 9], [2, 1]])) };
    const before = presetsIn('crush').map((p) => (p.name === 'Loud' ? edited : p));
    writeFileSync(presetFile('crush'), formatPresetFile([...before, mine]));

    const r = await call({ name: 'Crush', source: PRESET_SRC, overwrite: true, presets: [{ name: 'Warm bus', values: { Gain: -6 } }, { name: 'Loud', values: { Gain: 3 } }] });
    expect(body(r).presets).toMatchObject({ written: ['Warm bus'], keptUserEdits: ['Loud'], skipped: ['Loud'] });
    const after = presetsIn('crush');
    expect(after.map((p) => p.name).sort()).toEqual(['Loud', 'My drums', 'Warm bus']);
    expect(decodePresetValues(after.find((p) => p.name === 'Warm bus')?.data ?? '').get(1)).toBe(-6);
    expect(decodePresetValues(after.find((p) => p.name === 'Loud')?.data ?? '').get(1)).toBe(9);
    expect(readdirSync(join(root, 'config', 'jsfx-history', 'crush'))).toContain('1.presets.json');
  });

  it('removes its old presets when a breaking change gives the sliders new meaning', async () => {
    await call({ name: 'Crush', source: PRESET_SRC, presets: [{ name: 'Warm bus', values: { Gain: -3 } }] });
    const r = await call({ name: 'Crush', source: PRESET_SRC.replace('<-24,12,0.1>', '<-48,0,0.1>'), overwrite: true, breaking: true });
    expect(body(r).presets.removed).toContain('breaking');
    expect(presetsIn('crush')).toEqual([]);
  });

  it('leaves the preset file alone when an edit passes no presets', async () => {
    await call({ name: 'Crush', source: PRESET_SRC, presets: [{ name: 'Warm bus', values: { Gain: -3 } }] });
    const r = await call({ name: 'Crush', source: PRESET_SRC, overwrite: true });
    expect(body(r).presets).toBeUndefined();
    expect(presetsIn('crush').map((p) => p.name)).toEqual(['Warm bus']);
  });
});

describe('write_jsfx telemetry', () => {
  it('reports the outcome and the plugin\'s shape through the default (allow-listed) telemetry', async () => {
    await call({ name: 'Secret Name', source: SRC(), request: 'a wide chorus for my band' });
    expect(attrs()).toMatchObject({
      'reaper.jsfx.outcome': 'written', 'reaper.jsfx.overwrite': false, 'reaper.jsfx.sliders': 1,
      'reaper.jsfx.widgets.core': 1, 'reaper.jsfx.widgets.advanced': 0, 'reaper.jsfx.size': '<8k',
      'reaper.jsfx.version': 1, 'reaper.jsfx.lint.errors': 0,
    });
  });

  it('reports a refusal by its outcome and error count', async () => {
    await call({ name: 'Bad', source: SRC().replace('spl0 *= gain;', 'spl0 *= gain + 1e-9;') });
    expect(attrs()).toMatchObject({ 'reaper.jsfx.outcome': 'refused_lint', 'reaper.jsfx.lint.errors': 1 });
  });

  it('counts the presets written, never their names or values', async () => {
    await call({ name: 'Secret Name', source: PRESET_SRC, presets: [{ name: 'Ghost tails', values: { Gain: -7.3 } }, { name: 'Private Mood', values: { Gain: 1 } }] });
    expect(attrs()).toMatchObject({ 'reaper.jsfx.outcome': 'written', 'reaper.jsfx.presets': 2 });
    await call({ name: 'Other', source: PRESET_SRC, presets: [{ name: 'Ghost tails', values: { Gain: 99 } }] });
    expect(attrs()).toMatchObject({ 'reaper.jsfx.outcome': 'refused_presets' });
    const everything = JSON.stringify(exporter.getFinishedSpans().map((s) => [s.name, s.attributes, s.events]));
    for (const secret of ['Ghost', 'Private Mood', '-7.3', 'Soft', 'Fold']) expect(everything).not.toContain(secret);
  });

  it('never sends the plugin\'s name, its request, its source or a control label', async () => {
    await call({ name: 'Secret Name', source: SRC(), request: 'a wide chorus for my band' });
    await call({ name: 'Secret Name', source: SRC('slider2:0<0,1,0.01>Private Label\n'), overwrite: true });
    const everything = JSON.stringify(exporter.getFinishedSpans().map((s) => [s.name, s.attributes, s.events]));
    for (const secret of ['Secret', 'secret-name', 'chorus', 'band', 'Private Label', 'Gain', 'spl0']) expect(everything).not.toContain(secret);
  });
});

describe('write_jsfx accent', () => {
  // the last ui_theme() in the file (the metadata block's) wins over the toolkit's default
  const theme = (slug: string) => [...readFileSync(file(slug), 'utf8').matchAll(/ui_theme\(\$x([0-9a-f]{6})\);/g)].at(-1)?.[1];

  it('gives a plugin the same colour every time from its name when no accent is given', async () => {
    const r = await call({ name: 'Secret Name', source: SRC() });
    expect(body(r).accent.kind).toBe('auto');
    const first = theme('secret-name');
    await call({ name: 'Secret Name', source: SRC(), overwrite: true });
    expect(theme('secret-name')).toBe(first);
    expect(`#${first}`).toBe(body(r).accent.color);
  });

  it('gives a new plugin its own colour even when the source carries the example\'s accent line', async () => {
    const r = await call({ name: 'Bit Crusher', source: `// accent: orange\n${SRC()}` });
    expect(body(r).accent.kind).toBe('auto');
    expect(readFileSync(file('bit-crusher'), 'utf8')).not.toContain('// accent: orange');
  });

  it('keeps an accent the user picked through a later edit that does not mention it', async () => {
    await call({ name: 'Secret Name', source: SRC(), accent: '#FF8800' });
    expect(theme('secret-name')).toBe('ff8800');
    const edited = readFileSync(file('secret-name'), 'utf8').replace('spl0 *= gain;', 'spl0 *= gain * 1;');
    const r = await call({ name: 'Secret Name', source: edited, overwrite: true });
    expect(body(r).accent).toEqual({ color: '#ff8800', kind: 'custom' });
    // a plain source (no accent line) keeps the plugin's accent too
    const r2 = await call({ name: 'Secret Name', source: SRC(), overwrite: true });
    expect(body(r2).accent).toEqual({ color: '#ff8800', kind: 'custom' });
  });

  it('recolours with a name, and goes back to the name colour with auto', async () => {
    const auto = body(await call({ name: 'Secret Name', source: SRC() })).accent.color;
    expect(body(await call({ name: 'Secret Name', source: SRC(), overwrite: true, accent: 'orange' })).accent.kind).toBe('named');
    expect(readFileSync(file('secret-name'), 'utf8')).toContain('// accent: orange');
    const back = body(await call({ name: 'Secret Name', source: SRC(), overwrite: true, accent: 'auto' }));
    expect(back.accent).toEqual({ color: auto, kind: 'auto' });
    expect(readFileSync(file('secret-name'), 'utf8')).not.toContain('// accent:');
  });

  it.each(['#ff88', 'chartreuse', 'rgb(1,2,3)', '#gg0000'])('refuses accent %s and writes nothing', async (bad) => {
    const r = await call({ name: 'Secret Name', source: SRC(), accent: bad });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/nothing was written/);
    expect(existsSync(file('secret-name'))).toBe(false);
    expect(attrs()).toMatchObject({ 'reaper.jsfx.outcome': 'refused_accent' });
  });

  it('reports only the kind of accent, never the colour', async () => {
    await call({ name: 'Secret Name', source: SRC(), accent: '#abcdef' });
    expect(attrs()).toMatchObject({ 'reaper.jsfx.accent': 'custom' });
    await call({ name: 'Secret Name', source: SRC(), accent: 'violet', overwrite: true });
    expect(attrs()).toMatchObject({ 'reaper.jsfx.accent': 'named' });
    await call({ name: 'Secret Name', source: SRC(), accent: 'auto', overwrite: true });
    expect(attrs()).toMatchObject({ 'reaper.jsfx.accent': 'auto' });
    const everything = JSON.stringify(exporter.getFinishedSpans().map((s) => [s.name, s.attributes, s.events]));
    for (const secret of ['abcdef', '#abcdef', 'violet']) expect(everything).not.toContain(secret);
  });
});

describe('write_jsfx developer suffix', () => {
  it('shows the maker in the FX list but keeps the file name, fxName and preset file as they were', async () => {
    const r = await call({ name: 'Crush', source: PRESET_SRC, presets: [{ name: 'Warm bus', values: { Gain: -3 } }] });
    expect(body(r).fxName).toBe('reaper-mcp-generated/crush');
    const written = readFileSync(file('crush'), 'utf8');
    expect(written.split('\n')[0]).toMatch(/^desc:.* \(reaper-mcp\)$/);
    expect(presetsIn('crush').map((p) => p.name)).toEqual(['Warm bus']);
    // an edit fed back with the suffix keeps one suffix, the same file and the preset
    const again = await call({ name: 'Crush', source: written, overwrite: true });
    expect(body(again).fxName).toBe('reaper-mcp-generated/crush');
    expect(readFileSync(file('crush'), 'utf8').split('\n')[0].match(/\(reaper-mcp\)/g)).toHaveLength(1);
    expect(presetsIn('crush').map((p) => p.name)).toEqual(['Warm bus']);
  });
});
