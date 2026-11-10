import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, colorLevel, createUi, stripAnsi, useColor, type ColorLevel, type Ui } from './terminal-ui.js';
import { renderDoctor } from './doctor-report.js';

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe('how much colour a terminal gets', () => {
  it('none for a pipe or a file, whatever the terminal variables say', () => {
    expect(colorLevel(pipe, { TERM: 'xterm-256color', COLORTERM: 'truecolor' })).toBe(0);
  });

  it('none when NO_COLOR is set, even if FORCE_COLOR is too', () => {
    expect(colorLevel(tty, { NO_COLOR: '1', FORCE_COLOR: '3' })).toBe(0);
    expect(colorLevel(tty, { TERM: 'dumb' })).toBe(0);
  });

  it('reads the level off the terminal: truecolor, 256 colours, or the basic 16', () => {
    expect(colorLevel(tty, { COLORTERM: 'truecolor' })).toBe(3);
    expect(colorLevel(tty, { COLORTERM: '24bit' })).toBe(3);
    expect(colorLevel(tty, { TERM: 'xterm-256color' })).toBe(2);
    expect(colorLevel(tty, { TERM: 'xterm' })).toBe(1);
  });

  it('FORCE_COLOR turns colour on for a pipe, and 1/2/3 pick the level', () => {
    expect(colorLevel(pipe, { FORCE_COLOR: '1' })).toBe(1);
    expect(colorLevel(pipe, { FORCE_COLOR: '3' })).toBe(3);
    expect(colorLevel(tty, { FORCE_COLOR: '0' })).toBe(0);
    expect(useColor(pipe, {})).toBe(false);
    expect(useColor(tty, { TERM: 'xterm' })).toBe(true);
  });
});

describe('colour never changes the words', () => {
  const sample = (ui: Ui) =>
    [
      ui.heading('Connect', 'optional'),
      `${ui.mark('ok')} ${ui.bold('Codex CLI')} ${ui.dim('connected')}`,
      `${ui.mark('fail')} ${ui.fail('broken')} ${ui.mark('warn')} ${ui.warn('careful')} ${ui.mark('info')}`,
      `${ui.cmd('reaper-mcp setup')} ${ui.link('https://lorekit.io')} ${ui.brand('REAPER')} ${ui.underline('x')}`,
      ui.gradient('a gradient line'),
      ui.status('ok', 'fine'),
    ].join('\n');

  const plain = sample(createUi({ level: 0, tty: false }));

  it.each([1, 2, 3] as ColorLevel[])('at colour level %i the text is the plain text plus escape codes', (level) => {
    const coloured = sample(createUi({ level, tty: false }));
    expect(coloured).not.toBe(plain);
    expect(stripAnsi(coloured)).toBe(plain);
  });

  it('paints nothing at level 0', () => {
    expect(plain).not.toContain('\x1b');
  });

  it('colours statuses differently, and leaves an empty string empty', () => {
    const ui = createUi({ level: 1, tty: false });
    expect(ui.ok('x')).not.toBe(ui.fail('x'));
    expect(ui.bold('')).toBe('');
  });

  it('uses truecolor only at level 3, the 256-colour palette at 2, and basic green at 1', () => {
    expect(createUi({ level: 3, tty: false }).gradient('abc')).toContain('38;2;');
    expect(createUi({ level: 2, tty: false }).gradient('abc')).toContain('38;5;');
    const basic = createUi({ level: 1, tty: false }).gradient('abc');
    expect(basic).not.toContain('38;');
    expect(basic).toContain('92m');
  });

  it('gives the doctor report the same text with or without colour', () => {
    const sections = [{ title: 'Core', checks: [{ label: 'Bridge', status: 'fail' as const, detail: 'not running', fix: 'start REAPER' }] }];
    expect(stripAnsi(renderDoctor(sections, { color: true }))).toBe(renderDoctor(sections, { color: false }));
  });
});

describe('the banner', () => {
  it('is one plain line anywhere that is not an interactive terminal', () => {
    expect(createUi({ level: 3, tty: false, columns: 200 }).banner('Setup')).toBe('REAPER MCP — Setup\n');
    expect(createUi({ level: 0, tty: false }).banner('Connect your AI harness', '1.2.3')).toBe('REAPER MCP — Connect your AI harness\n');
  });

  it('is one plain line in a window too narrow for the logo', () => {
    expect(createUi({ level: 3, tty: true, columns: LOGO_WIDTH }).banner('Setup')).toBe('REAPER MCP — Setup\n');
  });

  it('draws the logo, a waveform and the subtitle with its version on a wide terminal', () => {
    const banner = stripAnsi(createUi({ level: 3, tty: true, columns: 100 }).banner('Doctor', '9.9.9'));
    expect(banner).toContain('██████╗');
    expect(banner).toMatch(/▁▂▃.*Doctor {2}v9\.9\.9/);
  });

  it('fits the terminal it is drawn for, and every logo row is as wide as the others', () => {
    const lines = stripAnsi(createUi({ level: 0, tty: true, columns: LOGO_WIDTH + 2 }).banner('Setup')).split('\n');
    // a blank line, the six logo rows, a blank line, then the waveform row
    const logo = lines.slice(1, 7);
    expect(logo.every((l) => /[█╗╔╝╚═║]/.test(l))).toBe(true);
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(LOGO_WIDTH + 2);
    expect(new Set(logo.map((l) => [...l].length)).size).toBe(1);
  });

  it('keeps the logo free of colour when there is none (NO_COLOR in a terminal still gets the picture)', () => {
    const banner = createUi({ level: 0, tty: true, columns: 100 }).banner('Setup');
    expect(banner).toContain('██████╗');
    expect(banner).not.toContain('\x1b');
  });
});
