// Rendering for `reaper-mcp doctor`: sections of aligned check rows, a fix line under each
// failure, and a one-line verdict. Pure (no IO) so the layout is unit-tested; color only on a TTY.

export type CheckStatus = 'ok' | 'fail' | 'warn' | 'info';

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

const ICON: Record<CheckStatus, string> = { ok: '✓', fail: '✗', warn: '!', info: '·' };
const CODE: Record<CheckStatus, string> = { ok: '32', fail: '31', warn: '33', info: '2' };

export function useColor(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['FORCE_COLOR'] && env['FORCE_COLOR'] !== '0') return true;
  return Boolean(stream.isTTY);
}

export function renderDoctor(sections: Section[], opts: { version?: string; color?: boolean } = {}): string {
  const paint = (code: string, s: string) => (opts.color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const bold = (s: string) => paint('1', s);
  const dim = (s: string) => paint('2', s);
  const width = Math.max(...sections.flatMap((s) => s.checks.map((c) => c.label.length)));

  const out = ['', `  ${bold('REAPER MCP')} ${dim('doctor')}${opts.version ? dim(`  v${opts.version}`) : ''}`];
  for (const section of sections) {
    const state = section.state ? `  ${paint(CODE[section.state.status], section.state.text)}` : '';
    out.push('', `  ${bold(section.title)}${section.note ? dim(`  ${section.note}`) : ''}${state}`);
    for (const c of section.checks) {
      out.push(`  ${paint(CODE[c.status], ICON[c.status])} ${c.label.padEnd(width)}  ${c.status === 'info' ? dim(c.detail) : c.detail}`);
      if (c.fix && c.status !== 'ok') out.push(`      ${' '.repeat(width)}${dim('→')} ${c.fix}`);
    }
  }

  const problems = sections.flatMap((s) => s.checks).filter((c) => c.status === 'fail');
  out.push('');
  if (problems.length) {
    const fixes = [...new Set(problems.map((c) => c.fix).filter((f): f is string => Boolean(f)))];
    out.push(`  ${paint(CODE.fail, `${problems.length} problem${problems.length === 1 ? '' : 's'}`)}${fixes.length ? dim(` · fix with: ${fixes.join(', then ')}`) : ''}`);
  } else {
    out.push(`  ${paint(CODE.ok, 'All good.')}`);
  }
  out.push('');
  return out.join('\n');
}
