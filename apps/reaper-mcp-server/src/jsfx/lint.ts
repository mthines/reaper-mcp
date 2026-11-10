/**
 * Static checks for a generated plugin's source (before the toolkit is inlined). JSFX cannot be
 * compiled outside REAPER, so these catch what is known to break a plugin or its UI, and enforce the
 * skill's principles: a small core view, advanced controls behind a section, nothing wasteful in @sample.
 *
 * Errors stop write_jsfx; warnings come back with the result. The rule ids are a CLOSED list: they are
 * also the `rule` attribute of the `reaper.jsfx.lint.findings` metric, so never build one from input.
 */
import { MAX_USER_SLIDERS, parseSliders } from './inline.js';

/** The toolkit keeps 8 label slots per slider (`ui_meta` strings at index*8+k), also read by `ui_choice`. */
const MAX_CHOICE_OPTIONS = 8;

export const LINT_RULES = [
  'no-desc', 'bad-slider', 'named-slider', 'slider-limit', 'duplicate-slider', 'default-out-of-range',
  'science-literal', 'local-top-level', 'gmem', 'no-gfx', 'no-ui-begin', 'no-ui-boot', 'no-changed',
  'widget-unknown-slider', 'slider-without-widget', 'core-overflow', 'no-serialize',
  'advanced-overflow', 'sample-loop', 'sample-memset', 'sample-divide-srate', 'file-size', 'low-memory-index', 'two-arg-minmax', 'ui-state-reset', 'accent-assign', 'own-key-handling', 'too-many-options',
  'unknown-ui-call', 'ui-arity', 'while-no-body',
] as const;
export type LintRule = (typeof LINT_RULES)[number];

export interface LintFinding {
  rule: LintRule;
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

/**
 * Every function the toolkit defines (`reaper/mcp_ui.jsfx-inc`) and its argument count. EEL2 compiles a
 * call to an undefined function, or one with the wrong argument count, into a plugin that silently loads
 * and does nothing, so a typo like `ui_knbo(...)` has to be caught here. `toolkit.test.ts` keeps this
 * table equal to the toolkit's own definitions.
 */
export const UI_API: Readonly<Record<string, number>> = {
  ui_meta: 5, ui_boot: 1, ui_changed: 0, ui_c: 2, ui_mixc: 3, ui_theme: 1, ui_cm: 3, ui_q: 2, ui_set: 2,
  ui_rrect: 5, ui_ring: 6, ui_caps: 1, ui_ctext: 4, ui_chev: 3, ui_bgbuild: 0, ui_bg: 0, ui_fmted: 2,
  ui_edopen: 5, ui_edcommit: 0, ui_edkey: 1, ui_keys: 0, ui_namedraw: 0, ui_begin: 2, ui_footer: 2,
  ui_float: 4, ui_popover: 0, ui_arow: 5, ui_aboutdraw: 0, ui_end: 0, ui_tall: 1, ui_row: 1, ui_cell: 0, ui_label: 2,
  ui_value: 1, ui_fmtv: 2, ui_reset: 1, ui_ctl: 5, ui_knob: 3, ui_toggle: 2, ui_choice: 2, ui_meter: 2,
  ui_section: 1, ui_gput: 2, ui_gset: 2, ui_gfeed: 2, ui_gr: 2, ui_glevel: 1, ui_kkey: 2, ui_fxof: 1,
  ui_fof: 1, ui_gyof: 1, ui_freqgraph: 1, ui_fpill: 2, ui_fhandle: 2, ui_grmeter: 2, ui_tcurve: 4,
  ui_transfer: 3, ui_keyboard: 3, ui_fthresh: 4, ui_header: 2, ui_hbar: 4, ui_pill: 4, ui_gfeed2: 2, ui_gshow: 1, ui_bandknob: 4, ui_fband: 3, ui_kput: 2, ui_kpoll: 0,
  ui_padon: 2, ui_padoff: 1, ui_padkey: 1, ui_pads: 4, ui_notename: 1, ui_padmap: 4,
  ui_sqkey: 1, ui_sqlen: 1, ui_sqfeel: 1, ui_sqname: 1, ui_sqlane: 1, ui_sqclear: 3, ui_sqat: 2, ui_sqadd: 4, ui_sqdel: 2,
  ui_sqfind: 3, ui_sqnear: 2, ui_sqsnap: 2, ui_sqcell: 2, ui_help: 2, ui_tipdraw: 0, ui_sqlsel: 1, ui_squbase: 2, ui_sqpush: 0, ui_sqpush1: 0, ui_squndo: 0, ui_sqredo: 0, ui_sqvorg: 0, ui_sqvel: 1, ui_sqsetlen: 1, ui_sqadj: 5, ui_sqlanes: 1, ui_sqchip: 6, ui_sqcol: 1, ui_seq: 4,
  ui_sqdesel: 0, ui_sqselall: 0, ui_sqdelsel: 0, ui_sqorg: 0, ui_sqshift: 1, ui_sqmarq: 5, ui_sqcount: 0,
};

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

/** `while (cond)` not followed by a parenthesised body: EEL2 cannot compile it, and the whole section silently does nothing. Offsets. */
function whileWithoutBody(code: string): number[] {
  const out: number[] = [];
  for (const m of code.matchAll(/\bwhile\s*\(/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
    }
    const next = code.slice(i).match(/\S/)?.[0];
    if (next !== undefined && next !== '(') out.push(m.index ?? 0);
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

/** Widgets bound to a slider by its first argument; a band handle counts here (it uses a slider) but not as a widget. */
const WIDGET = /\bui_(knob|toggle|choice|fhandle)\s*\(\s*(\d+)/g;
/** A knob on the selected band's slider: first..first+n-1; the threshold lines use two such ranges (threshold, ratio) of n bands. */
const BANDKNOB = /\bui_bandknob\s*\(\s*(\d+)\s*,\s*(\d+)/g;
const PADMAP = /\bui_padmap\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
const FBAND = /\bui_fband\s*\(\s*(\d+)\s*,\s*(\d+)/g;
const FTHRESH = /\bui_fthresh\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
/** The header bars (Mix, Output in the top right): 0 = none, else a slider the plugin must not draw again. */
const HEADER = /\bui_header\s*\(\s*(\d+)\s*,\s*(\d+)/g;
/** The transfer curve reads two sliders: threshold and ratio. */
const TRANSFER = /\bui_transfer\s*\(\s*(\d+)\s*,\s*(\d+)/g;
/** What counts toward the core and Advanced limits: one per widget the user sees (a graph's handles are part of it). */
const COUNTED = /\bui_(knob|toggle|choice|meter|freqgraph|grmeter|transfer|keyboard|pads|padmap|seq|bandknob)\s*\(/g;
const GRAPHS = /\bui_(freqgraph|grmeter|transfer|keyboard|pads|seq)\s*\(/g;
const countWidgets = (t: string) => [...t.matchAll(COUNTED)].length;

/** Calls of `ui_*` functions with their argument count (strings and nested calls skipped): [name, args, offset]. */
function uiCalls(code: string): { name: string; args: number; at: number }[] {
  const out: { name: string; args: number; at: number }[] = [];
  for (const m of code.matchAll(/\b(ui_\w+)\s*\(/g)) {
    const at = m.index ?? 0;
    if (/\bfunction\s+$/.test(code.slice(Math.max(0, at - 12), at))) continue;
    let depth = 1;
    let args = 0;
    let any = false;
    let inString = false;
    for (let i = at + m[0].length; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (inString) {
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        any = true;
      } else if (ch === '(') {
        depth++;
        any = true;
      } else if (ch === ')') depth--;
      else if (ch === ',' && depth === 1) args++;
      else if (/\S/.test(ch)) any = true;
    }
    out.push({ name: m[1], args: any ? args + 1 : 0, at });
  }
  return out;
}

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
    if (s.options.length > MAX_CHOICE_OPTIONS) add('too-many-options', 'error', `slider${s.index} has ${s.options.length} options: the toolkit shows at most ${MAX_CHOICE_OPTIONS}, and a ninth would show another slider's label. Use a knob or split the choice.`);
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
    if (countWidgets(core) > MAX_CORE_WIDGETS) add('core-overflow', 'error', `${countWidgets(core)} widgets before the first ui_section (max ${MAX_CORE_WIDGETS}): keep the core view to what is changed in most uses and move the rest behind ui_section("Advanced").`, gfx.line);
    if (countWidgets(adv) > MAX_ADVANCED_WIDGETS) add('advanced-overflow', 'warning', `${countWidgets(adv)} advanced widgets (max ${MAX_ADVANCED_WIDGETS}): does every one earn its place?`, gfx.line);

    const byIndex = new Map(sliders.map((s) => [s.index, s]));
    const used = new Set<number>();
    for (const m of gfx.text.matchAll(WIDGET)) {
      const idx = Number(m[2]);
      used.add(idx);
      if (!byIndex.has(idx)) add('widget-unknown-slider', 'error', `ui_${m[1]}(${idx}, ...) points at slider${idx}, which is not declared.`, gfx.line + gfx.text.slice(0, m.index).split('\n').length);
    }
    for (const m of gfx.text.matchAll(TRANSFER)) {
      for (const idx of [Number(m[1]), Number(m[2])]) {
        used.add(idx);
        if (!byIndex.has(idx)) add('widget-unknown-slider', 'error', `ui_transfer(${m[1]}, ${m[2]}, ...) points at slider${idx}, which is not declared.`, gfx.line + gfx.text.slice(0, m.index).split('\n').length);
      }
    }
    const ranges: [string, number, number][] = [];
    for (const m of gfx.text.matchAll(HEADER)) for (const v of [m[1], m[2]]) if (Number(v) > 0) ranges.push(['ui_header', Number(v), 1]);
    for (const m of gfx.text.matchAll(BANDKNOB)) ranges.push(['ui_bandknob', Number(m[1]), Number(m[2])]);
    for (const m of gfx.text.matchAll(PADMAP)) ranges.push(['ui_padmap', Number(m[1]), Math.min(16, Number(m[2]) * Number(m[3]))]);
    for (const m of gfx.text.matchAll(FBAND)) ranges.push(['ui_fband', Number(m[1]), Number(m[2])]);
    for (const m of gfx.text.matchAll(FTHRESH)) ranges.push(['ui_fthresh', Number(m[1]), Number(m[4])], ['ui_fthresh', Number(m[2]), Number(m[4])], ['ui_fthresh', Number(m[3]), Number(m[4])]);
    for (const [fn, first, count] of ranges) {
      for (let idx = first; idx < first + count; idx++) {
        used.add(idx);
        if (!byIndex.has(idx)) add('widget-unknown-slider', 'error', `${fn} covers slider${idx}, which is not declared (it takes ${count} sliders from slider${first}).`, gfx.line);
      }
    }
    for (const s of sliders) {
      if (!s.hidden && !used.has(s.index)) add('slider-without-widget', 'error', `slider${s.index} "${s.name}" has no widget in @gfx. Draw it, or hide it with a leading "-" in its label.`);
    }
  }
  const init = secs.get('init')?.text ?? '';
  if (!/\bui_boot\s*\(/.test(init)) add('no-ui-boot', 'error', '@init must call ui_boot(animated) after the plugin\'s own setup (animated = 1 when the UI has a meter, 2 when it has graph feeds, 0 when static).');
  if (!/\bui_changed\s*\(/.test(secs.get('block')?.text ?? '') && !/\bui_changed\s*\(/.test(secs.get('sample')?.text ?? '')) {
    add('no-changed', 'error', '@block must call ui_changed() ? update(); so a knob moved in @gfx reaches the DSP.');
  }
  const ser = secs.get('serialize');
  if (ser && !/\bfile_var\s*\(\s*0\s*,\s*ui_adv_open\s*\)/.test(ser.text)) add('no-serialize', 'error', 'The @serialize section must start with file_var(0, ui_adv_open); so the Advanced section keeps its state.', ser.line);

  // @init re-runs when playback starts: a plugin that sets ui_adv_open would close the drawer on Play
  // (closing it right after @serialize has loaded a saved state is fine: REAPER's own undo loads state back mid-session)
  const adv = code.replace(/file_avail\s*\(\s*0\s*\)\s*>=\s*0\s*\?\s*ui_adv_open\s*=\s*0/g, (x) => ' '.repeat(x.length));
  for (const m of adv.matchAll(/\bui_adv_open\s*=(?!=)/g)) {
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

  const own = new Set([...code.matchAll(/\bfunction\s+(ui_\w+)/g)].map((m) => m[1]));
  for (const c of uiCalls(code)) {
    const expected = UI_API[c.name];
    if (expected === undefined) {
      if (!own.has(c.name)) add('unknown-ui-call', 'error', `${c.name}() is not a toolkit function: REAPER would compile the call to nothing and the widget would silently not draw. Check the spelling against reference/toolkit.md.`, lineOf(c.at));
    } else if (c.args !== expected) {
      add('ui-arity', 'error', `${c.name}() takes ${expected} argument${expected === 1 ? '' : 's'}, this call has ${c.args}: EEL2 would drop the whole plugin or read the wrong values.`, lineOf(c.at));
    }
  }

  for (const at of whileWithoutBody(code)) {
    add('while-no-body', 'error', 'while (condition) needs its body in parentheses: while (cond) ( statement; ); EEL2 cannot compile a bare statement after it, so the whole section (and the plugin) would silently do nothing.', lineOf(at));
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
    if (Number(m[1]) < 2048) add('low-memory-index', 'warning', `A buffer starts at index ${m[1]}: memory below ui_mem (2048) is reserved for the toolkit. Allocate from ui_mem.`, lineOf(m.index ?? 0));
  }
  return findings;
}

export const errorsOf = (f: LintFinding[]) => f.filter((x) => x.severity === 'error');
export const warningsOf = (f: LintFinding[]) => f.filter((x) => x.severity === 'warning');

/** Widgets in the core view and behind the Advanced section, for the plugin's shape (never its names). */
export function widgetCounts(source: string): { core: number; advanced: number } {
  const gfx = sections(stripComments(source.replace(/\r\n/g, '\n'))).get('gfx')?.text ?? '';
  const at = gfx.search(/\bui_section\s*\(/);
  return { core: countWidgets(at === -1 ? gfx : gfx.slice(0, at)), advanced: at === -1 ? 0 : countWidgets(gfx.slice(at)) };
}

/** How many graph widgets (frequency graph, gain-reduction bars, transfer curve, keyboard) the plugin draws. */
export function graphWidgetCount(source: string): number {
  const gfx = sections(stripComments(source.replace(/\r\n/g, '\n'))).get('gfx')?.text ?? '';
  return [...gfx.matchAll(GRAPHS)].length;
}
