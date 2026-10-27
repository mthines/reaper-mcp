import { describe, expect, it } from 'vitest';
import { renderDoctor, useColor, type Section } from './doctor-report.js';

const core: Section = {
  title: 'Core',
  checks: [
    { label: 'Lua bridge', status: 'fail', detail: 'Not detected', fix: 'reaper-mcp setup' },
    { label: 'Knowledge base', status: 'ok', detail: '~/.claude/knowledge' },
    { label: 'Telemetry', status: 'info', detail: 'On', fix: 'turn off: x' },
    { label: 'Skills', status: 'ok', detail: 'Found', fix: 'never shown when ok' },
  ],
};

describe('renderDoctor', () => {
  it('aligns labels, shows the fix under a failure, and sums up the problems', () => {
    const out = renderDoctor([core], { version: '1.2.3' });
    expect(out).toContain('REAPER MCP doctor  v1.2.3');
    expect(out).toContain('  ✗ Lua bridge      Not detected\n                    → reaper-mcp setup');
    expect(out).toContain('  ✓ Knowledge base  ~/.claude/knowledge');
    expect(out).toContain('  · Telemetry       On\n                    → turn off: x');
    expect(out).not.toContain('never shown');
    expect(out).toContain('1 problem · fix with: reaper-mcp setup');
  });

  it('shows the section state and says all good without failures', () => {
    const sidecar: Section = { title: 'Python sidecar', note: 'optional', state: { text: 'ready', status: 'ok' }, checks: [{ label: 'Venv', status: 'ok', detail: '~/v' }] };
    const out = renderDoctor([sidecar]);
    expect(out).toContain('Python sidecar  optional  ready');
    expect(out).toContain('All good.');
  });

  it('lists each distinct fix once', () => {
    const s: Section = { title: 'S', checks: ['a', 'b'].map((label) => ({ label, status: 'fail' as const, detail: 'x', fix: 'reaper-mcp setup-sidecar' })) };
    expect(renderDoctor([s])).toContain('2 problems · fix with: reaper-mcp setup-sidecar\n');
  });

  it('colors only when asked', () => {
    expect(renderDoctor([core])).not.toContain('\x1b[');
    expect(renderDoctor([core], { color: true })).toContain('\x1b[31m✗\x1b[0m');
  });
});

describe('useColor', () => {
  it('follows the TTY, NO_COLOR and FORCE_COLOR', () => {
    expect(useColor({ isTTY: true }, {})).toBe(true);
    expect(useColor({ isTTY: false }, {})).toBe(false);
    expect(useColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
    expect(useColor({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
  });
});
