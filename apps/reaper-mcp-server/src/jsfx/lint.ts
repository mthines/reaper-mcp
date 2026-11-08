/**
 * Static checks for a generated plugin's source (before the toolkit is inlined). JSFX cannot be
 * compiled outside REAPER, so these catch what is known to break a plugin or its UI, and enforce the
 * skill's principles: a small core view, advanced controls behind a section, nothing wasteful in @sample.
 *
 * Errors stop write_jsfx; warnings come back with the result. The rule ids are a CLOSED list: they are
 * also the `rule` attribute of the `reaper.jsfx.lint.findings` metric, so never build one from input.
 */
import { MAX_USER_SLIDERS, parseSliders } from './inline.js';

export const LINT_RULES = [
  'no-desc', 'bad-slider', 'named-slider', 'slider-limit', 'duplicate-slider', 'default-out-of-range',
  'science-literal', 'local-top-level', 'gmem', 'no-gfx', 'no-ui-begin', 'no-ui-boot', 'no-changed',
  'widget-unknown-slider', 'slider-without-widget', 'core-overflow', 'no-serialize',
  'advanced-overflow', 'sample-loop', 'sample-memset', 'sample-divide-srate', 'file-size', 'low-memory-index', 'two-arg-minmax', 'ui-state-reset', 'accent-assign', 'own-key-handling',
] as const;
export type LintRule = (typeof LINT_RULES)[number];

export interface LintFinding {
  rule: LintRule;
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

/** At most this many widgets before the first ui_section: the core view stays small. */
export const MAX_CORE_WIDGETS = 5;
export const MAX_ADVANCED_WIDGETS = 8;
export const MAX_FILE_BYTES = 64 * 1024;

/** Replaces comments with spaces so line numbers and columns stay put. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}


/** Calls of max/min with another count than two arguments (EEL2 takes exactly two): [offset, count]. */
function wrongMinMaxCalls(code: string): { at: number; count: number }[] {
  const out: { at: number; count: number }[] = [];
  for (const m of code.matchAll(/\b(?:max|min)\s*\(/g)) {
    let depth = 1;
    let count = 1;
    for (let i = (m.index ?? 0) + m[0].length; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 1) count++;
    }
    if (count !== 2) out.push({ at: m.index ?? 0, count });
  }
  return out;
}

/** Section name → { text, first line number }. The header is "header". */
function sections(code: string): Map<string, { text: string; line: number }> {
  const out = new Map<string, { text: string; line: number }>();
  let name = 'header';
  let line = 1;
  let buf: string[] = [];
  code.split('\n').forEach((l, i) => {
    const m = l.match(/^@(init|slider|block|sample|gfx|serialize)\b/);
    if (m) {
      out.set(name, { text: buf.join('\n'), line });
      name = m[1];
      line = i + 1;
      buf = [];
    } else buf.push(l);
  });
  out.set(name, { text: buf.join('\n'), line });
  return out;
}

const WIDGET = /\bui_(knob|toggle|choice)\s*\(\s*(\d+)/g;
const METER = /\bui_meter\s*\(/g;

export function lintJsfx(source: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (rule: LintRule, severity: 'error' | 'warning', message: string, line?: number) =>
    findings.push({ rule, severity, message, ...(line ? { line } : {}) });

  const code = stripComments(source.replace(/\r\n/g, '\n'));
  const secs = sections(code);
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;

  if (Buffer.byteLength(source) > MAX_FILE_BYTES) add('file-size', 'warning', `The source is over ${MAX_FILE_BYTES / 1024} KB: a generated plugin should be much smaller.`);
  if (!/^desc:\s*\S/m.test(source)) add('no-desc', 'error', 'Missing "desc:Name" line: REAPER lists the plugin by it.');

  // sliders
  const { sliders, bad } = parseSliders(source);
  for (const b of bad) add('bad-slider', 'error', `Slider line does not parse: "${b.text}". Use sliderN:default<min,max,step>Label (or {A,B,C} for options).`, b.line);
  const seen = new Set<number>();
  for (const s of sliders) {
    if (seen.has(s.index)) add('duplicate-slider', 'error', `slider${s.index} is declared twice.`);
    seen.add(s.index);
    if (s.index < 1 || s.index > MAX_USER_SLIDERS) add('slider-limit', 'error', `slider${s.index}: use slider1..slider${MAX_USER_SLIDERS}.`);
    if (s.named) add('named-slider', 'error', `slider${s.index} is named: the toolkit reads sliders by number, and a named slider's sliderN stays 0. Declare it unnamed (slider${s.index}:${s.default}<...>) and read slider${s.index}.`);
    if (s.default < Math.min(s.min, s.max) || s.default > Math.max(s.min, s.max)) add('default-out-of-range', 'error', `slider${s.index}: default ${s.default} is outside ${s.min}..${s.max}.`);
  }

  // things EEL2 or this design rejects
  for (const m of code.matchAll(/(?<![\w.])\d+(?:\.\d+)?[eE][+-]?\d+(?![\w.])/g)) {
    add('science-literal', 'error', `Literal ${m[0]}: EEL2 rejects scientific notation and the whole plugin then fails to compile. Write it out (0.000001).`, lineOf(m.index ?? 0));
  }
  for (const name of ['sample', 'block'] as const) {
    const sec = secs.get(name);
    sec?.text.split('\n').forEach((l, i) => {
      if (/^\s*local\s*\(/i.test(l)) add('local-top-level', 'error', `local() at the top level of @${name} fails to compile: use plain variables, or local() inside a function.`, sec.line + i + 1);
    });
  }
  if (/\boptions:[^\n]*\bgmem\b/.test(code)) add('gmem', 'error', 'No gmem: a generated plugin must not depend on the bridge or on other plugins.');

  // the UI
  const gfx = secs.get('gfx');
  if (!gfx || !/\S/.test(gfx.text)) add('no-gfx', 'error', 'No @gfx section: every generated plugin draws its UI with the toolkit.');
  else {
    if (!/\bui_begin\s*\(/.test(gfx.text)) add('no-ui-begin', 'error', '@gfx must call ui_begin(core_rows, adv_rows) and draw inside it.', gfx.line);
    const at = gfx.text.search(/\bui_section\s*\(/);
    const core = at === -1 ? gfx.text : gfx.text.slice(0, at);
    const adv = at === -1 ? '' : gfx.text.slice(at);
    const widgets = (t: string) => [...t.matchAll(WIDGET)].length + [...t.matchAll(METER)].length;
    if (widgets(core) > MAX_CORE_WIDGETS) add('core-overflow', 'error', `${widgets(core)} widgets before the first ui_section (max ${MAX_CORE_WIDGETS}): keep the core view to what is changed in most uses and move the rest behind ui_section("Advanced").`, gfx.line);
    if (widgets(adv) > MAX_ADVANCED_WIDGETS) add('advanced-overflow', 'warning', `${widgets(adv)} advanced widgets (max ${MAX_ADVANCED_WIDGETS}): does every one earn its place?`, gfx.line);

    const byIndex = new Map(sliders.map((s) => [s.index, s]));
    const used = new Set<number>();
    for (const m of gfx.text.matchAll(WIDGET)) {
      const idx = Number(m[2]);
      used.add(idx);
      if (!byIndex.has(idx)) add('widget-unknown-slider', 'error', `ui_${m[1]}(${idx}, ...) points at slider${idx}, which is not declared.`, gfx.line + gfx.text.slice(0, m.index).split('\n').length);
    }
    for (const s of sliders) {
      if (!s.hidden && !used.has(s.index)) add('slider-without-widget', 'error', `slider${s.index} "${s.name}" has no widget in @gfx. Draw it, or hide it with a leading "-" in its label.`);
    }
  }
  const init = secs.get('init')?.text ?? '';
  if (!/\bui_boot\s*\(/.test(init)) add('no-ui-boot', 'error', '@init must call ui_boot(animated) after the plugin\'s own setup (animated = 1 when the UI has a meter).');
  if (!/\bui_changed\s*\(/.test(secs.get('block')?.text ?? '') && !/\bui_changed\s*\(/.test(secs.get('sample')?.text ?? '')) {
    add('no-changed', 'error', '@block must call ui_changed() ? update(); so a knob moved in @gfx reaches the DSP.');
  }
  const ser = secs.get('serialize');
  if (ser && !/\bfile_var\s*\(\s*0\s*,\s*ui_adv_open\s*\)/.test(ser.text)) add('no-serialize', 'error', 'The @serialize section must start with file_var(0, ui_adv_open); so the Advanced section keeps its state.', ser.line);

  // @init re-runs when playback starts: a plugin that sets ui_adv_open would close the drawer on Play
  for (const m of code.matchAll(/\bui_adv_open\s*=(?!=)/g)) {
    add('ui-state-reset', 'warning', 'The plugin assigns ui_adv_open: REAPER re-runs @init (and this code) when playback starts, so the Advanced drawer would snap shut on Play. Leave it to the toolkit; @serialize restores it with file_var(0, ui_adv_open).', lineOf(m.index ?? 0));
  }

  // the accent is the plugin's own colour, set by write_jsfx (its accent input), never by plugin code
  for (const m of code.matchAll(/\bui_cAccent\s*=(?!=)|\bui_theme\s*\(/g)) {
    add('accent-assign', 'warning', 'The plugin sets the accent itself: write_jsfx sets it (pass accent: "orange" or "#rrggbb" and keep the source as it is). Plugin code that assigns ui_cAccent or calls ui_theme() is overridden on the next write.', lineOf(m.index ?? 0));
  }
  // the toolkit reads the keyboard while its value box is open: a plugin reading it too steals the keys
  for (const m of code.matchAll(/\bgfx_getchar\s*\(/g)) {
    add('own-key-handling', 'warning', 'The plugin reads the keyboard (gfx_getchar): the toolkit does that while a value box is open, so typed values would go missing. Leave keyboard and mouse handling to the toolkit.', lineOf(m.index ?? 0));
  }

  for (const c of wrongMinMaxCalls(code)) {
    add('two-arg-minmax', 'error', `max/min take exactly two arguments, this call has ${c.count}: REAPER would fail to compile the whole plugin and pass the audio through. Nest them: max(max(a, b), c).`, lineOf(c.at));
  }

  // performance in the audio thread
  const sample = secs.get('sample');
  if (sample) {
    if (/\b(while|loop)\s*\(/.test(sample.text)) add('sample-loop', 'warning', 'A loop in @sample runs per sample: move it to @init/@block, or keep it to a few iterations.', sample.line);
    if (/\b(memset|memcpy)\s*\(/.test(sample.text)) add('sample-memset', 'warning', 'memset/memcpy in @sample runs per sample: clear buffers in @init or when a parameter changes.', sample.line);
    if (/\/=?\s*srate\b/.test(sample.text)) add('sample-divide-srate', 'warning', 'Dividing by srate per sample: compute the coefficient in update() once.', sample.line);
  }
  for (const m of code.matchAll(/\b(?:buf|mem|memory)\w*\s*=\s*(\d+)\s*;/g)) {
    if (Number(m[1]) < 1024) add('low-memory-index', 'warning', `A buffer starts at index ${m[1]}: memory below ui_mem (1024) is reserved for the toolkit. Allocate from ui_mem.`, lineOf(m.index ?? 0));
  }
  return findings;
}

export const errorsOf = (f: LintFinding[]) => f.filter((x) => x.severity === 'error');
export const warningsOf = (f: LintFinding[]) => f.filter((x) => x.severity === 'warning');

/** Widgets in the core view and behind the Advanced section, for the plugin's shape (never its names). */
export function widgetCounts(source: string): { core: number; advanced: number } {
  const gfx = sections(stripComments(source.replace(/\r\n/g, '\n'))).get('gfx')?.text ?? '';
  const at = gfx.search(/\bui_section\s*\(/);
  const count = (t: string) => [...t.matchAll(WIDGET)].length + [...t.matchAll(METER)].length;
  return { core: count(at === -1 ? gfx : gfx.slice(0, at)), advanced: at === -1 ? 0 : count(gfx.slice(at)) };
}
