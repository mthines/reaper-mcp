// The look of every command-line message `reaper-mcp` prints: one palette, one set of marks and headings, and the
// logo banner. Pure (no IO, nothing global is read unless asked) so the layout is unit-tested, and colour is a
// rendering detail: strip the escape codes from any helper's output and you get exactly its plain text, which is what a
// pipe, a log file, NO_COLOR or CI sees. Reuse it instead of writing `\x1b[` by hand:
//
//   const ui = createUi();                       // from this terminal: colour level, width, tty
//   console.log(ui.banner('Connect your AI harness'));
//   console.log(`${ui.mark('ok')} ${ui.bold('Codex CLI')} ${ui.dim('connected')}`);
//   console.log(`  ${ui.cmd('reaper-mcp setup')}   ${ui.dim('# Lua bridge + JSFX → REAPER')}`);

export type Status = 'ok' | 'fail' | 'warn' | 'info';

/** 0 none · 1 the 16 basic colours · 2 256 colours · 3 truecolor */
export type ColorLevel = 0 | 1 | 2 | 3;

type Rgb = [number, number, number];

/** How much colour a stream can show. NO_COLOR wins, then FORCE_COLOR (1/2/3 pick a level), then what the terminal says. */
export function colorLevel(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): ColorLevel {
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return 0;
  const force = env['FORCE_COLOR'];
  if (force === '0' || force === 'false') return 0;
  const forced = force !== undefined && force !== '';
  if (!forced && !stream.isTTY) return 0;
  if (!forced && env['TERM'] === 'dumb') return 0;
  if (force === '1' || force === '2' || force === '3') return Number(force) as ColorLevel;
  const colorterm = (env['COLORTERM'] ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 3;
  if (/256color/.test(env['TERM'] ?? '') || env['TERM_PROGRAM'] === 'Apple_Terminal') return 2;
  return 1;
}

/** Kept for callers that only need a yes or no */
export function useColor(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  return colorLevel(stream, env) > 0;
}

/** The brand: green through cyan to violet, left to right across the logo */
export const BRAND: Rgb[] = [
  [134, 239, 172],
  [34, 211, 238],
  [129, 140, 248],
];

const STATUS_CODE: Record<Status, string> = { ok: '32', fail: '31', warn: '33', info: '2' };
const STATUS_MARK: Record<Status, string> = { ok: '✓', fail: '✗', warn: '!', info: '·' };

function lerp(stops: Rgb[], t: number): Rgb {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as Rgb;
}

function rgbTo256([r, g, b]: Rgb): number {
  const cube = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * cube(r) + 6 * cube(g) + cube(b);
}

// --- the wordmark: "REAPER MCP" in the ANSI Shadow face, composed from glyphs so the rows always line up ---

const GLYPHS: Record<string, string[]> = {
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  ' ': ['  ', '  ', '  ', '  ', '  ', '  '],
};

function wordmark(text: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((row) => [...text].map((ch) => GLYPHS[ch][row]).join(''));
}

/** The widest the big logo gets: REAPER MCP is 77 columns, so it needs an 80-column terminal */
export const LOGO_WIDTH = wordmark('REAPER MCP')[0].length;

/** Labelled row of a waveform, drawn under the logo: the one image that says "audio" at a glance */
const WAVE = '▁▂▃▄▅▆▇█▇▆▅▄▃▂▁▂▃▅▇█▇▅▃▂▁▂▄▆█▆▄▂▁';

export interface Ui {
  level: ColorLevel;
  columns: number;
  /** True on an interactive terminal */
  tty: boolean;
  /** True when the big logo is drawn: an interactive terminal at least 80 columns wide */
  fancy: boolean;
  bold(s: string): string;
  dim(s: string): string;
  underline(s: string): string;
  /** The brand colour (the green end of the gradient) */
  brand(s: string): string;
  /** A command to type: cyan */
  cmd(s: string): string;
  /** A link: cyan and underlined */
  link(s: string): string;
  ok(s: string): string;
  warn(s: string): string;
  fail(s: string): string;
  /** `text` painted in the colour of a status (info is dim) */
  status(status: Status, text: string): string;
  /** ✓ ✗ ! · in the status colour */
  mark(status: Status): string;
  /** Colours each character along the brand gradient (plain text without colour support) */
  gradient(s: string): string;
  /** A bold section heading, e.g. "Connect"  */
  heading(text: string, note?: string): string;
  /** The title of a step that prints a few lines under it: bold, with a blank line before ("Installing Lua scripts...") */
  section(title: string): string;
  /** One line under a section: `  ✓ text`, two spaces in, the mark in the status colour */
  item(status: Status, text: string): string;
  /**
   * The start of a command's output. On an interactive terminal: the logo, a waveform and the subtitle.
   * Anywhere else (a pipe, CI, a narrow window): one line, `REAPER MCP — <subtitle>`.
   */
  banner(subtitle: string, version?: string): string;
}

export function createUi(opts: { level?: ColorLevel; columns?: number; tty?: boolean } = {}): Ui {
  const level = opts.level ?? colorLevel();
  const tty = opts.tty ?? Boolean(process.stdout.isTTY);
  const columns = opts.columns ?? process.stdout.columns ?? 80;
  const sgr = (codes: string, s: string) => (level > 0 && s ? `\x1b[${codes}m${s}\x1b[0m` : s);
  const rgb = (c: Rgb): string => (level >= 3 ? `38;2;${c[0]};${c[1]};${c[2]}` : level === 2 ? `38;5;${rgbTo256(c)}` : '92');

  /** Paints `s` char by char across the gradient, `from` to `to` being the share of the gradient this string spans */
  const spread = (s: string, from = 0, to = 1): string => {
    if (level === 0) return s;
    if (level === 1) return sgr('92', s);
    const chars = [...s];
    return chars
      .map((ch, i) => (ch === ' ' ? ch : `\x1b[${rgb(lerp(BRAND, from + ((to - from) * i) / Math.max(chars.length - 1, 1)))}m${ch}`))
      .join('') + '\x1b[0m';
  };

  const fancy = tty && columns >= LOGO_WIDTH + 2;
  const ui: Ui = {
    level,
    columns,
    tty,
    fancy,
    bold: (s) => sgr('1', s),
    dim: (s) => sgr('2', s),
    underline: (s) => sgr('4', s),
    brand: (s) => sgr(level >= 2 ? rgb(BRAND[0]) : '92', s),
    cmd: (s) => sgr('36', s),
    link: (s) => sgr('4;36', s),
    ok: (s) => sgr(STATUS_CODE.ok, s),
    warn: (s) => sgr(STATUS_CODE.warn, s),
    fail: (s) => sgr(STATUS_CODE.fail, s),
    status: (status, text) => sgr(STATUS_CODE[status], text),
    mark: (status) => sgr(STATUS_CODE[status], STATUS_MARK[status]),
    gradient: (s) => spread(s),
    heading: (text, note) => `${sgr('1', text)}${note ? sgr('2', `  ${note}`) : ''}`,
    section: (title) => `\n${sgr('1', title)}`,
    item: (status, text) => `  ${sgr(STATUS_CODE[status], STATUS_MARK[status])} ${text}`,
    banner: (subtitle, version) => {
      const plain = `REAPER MCP — ${subtitle}`;
      if (!fancy) return plain + '\n';
      const logo = wordmark('REAPER MCP').map((line) => `  ${spread(line)}`);
      const wave = `  ${spread(WAVE)}  ${sgr('1', subtitle)}${version ? sgr('2', `  v${version}`) : ''}`;
      return ['', ...logo, '', wave, ''].join('\n');
    },
  };
  return ui;
}

/** The text without its colour codes: what `ui` output looks like where colour is off */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
