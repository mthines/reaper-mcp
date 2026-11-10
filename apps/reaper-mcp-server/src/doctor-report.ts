// Rendering for `reaper-mcp doctor`: sections of aligned check rows, a fix line under each
// failure, and a one-line verdict. Pure (no IO) so the layout is unit-tested; color only on a TTY.

import { createUi, type Status } from './terminal-ui.js';

export type CheckStatus = Status;

export interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
  /** Shown under the row unless it passed: the step that fixes it, or for info a next step. */
  fix?: string;
}

export interface Section {
  title: string;
  /** Dim text after the title, e.g. "optional". */
  note?: string;
  /** Right-hand state of the whole section, e.g. "ready". */
  state?: { text: string; status: CheckStatus };
  checks: Check[];
}

export { useColor } from './terminal-ui.js';

export function renderDoctor(sections: Section[], opts: { version?: string; color?: boolean; /** false when a banner above already names the report */ header?: boolean } = {}): string {
  const ui = createUi({ level: opts.color ? 1 : 0, tty: false });
  const { bold, dim } = ui;
  const width = Math.max(...sections.flatMap((s) => s.checks.map((c) => c.label.length)));

  const out = opts.header === false ? [] : ['', `  ${bold('REAPER MCP')} ${dim('doctor')}${opts.version ? dim(`  v${opts.version}`) : ''}`];
  for (const section of sections) {
    const state = section.state ? `  ${ui.status(section.state.status, section.state.text)}` : '';
    out.push('', `  ${bold(section.title)}${section.note ? dim(`  ${section.note}`) : ''}${state}`);
    for (const c of section.checks) {
      out.push(`  ${ui.mark(c.status)} ${c.label.padEnd(width)}  ${c.status === 'info' ? dim(c.detail) : c.detail}`);
      if (c.fix && c.status !== 'ok') out.push(`      ${' '.repeat(width)}${dim('→')} ${c.fix}`);
    }
  }

  const problems = sections.flatMap((s) => s.checks).filter((c) => c.status === 'fail');
  out.push('');
  if (problems.length) {
    const fixes = [...new Set(problems.map((c) => c.fix).filter((f): f is string => Boolean(f)))];
    out.push(`  ${ui.fail(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)}${fixes.length ? dim(` · fix with: ${fixes.join(', then ')}`) : ''}`);
  } else {
    out.push(`  ${ui.ok('All good.')}`);
  }
  out.push('');
  return out.join('\n');
}
