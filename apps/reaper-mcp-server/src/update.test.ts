import { describe, it, expect } from 'vitest';
import { runUpdate, type UpdateDeps } from './update.js';

function setup(over: Partial<UpdateDeps> & { exit?: Record<string, number> } = {}) {
  const lines: string[] = [];
  const ran: string[] = [];
  const deps: UpdateDeps = {
    current: '0.83.0',
    latest: async () => '0.84.0',
    run: async (command, args) => {
      ran.push([command, ...args].join(' '));
      return over.exit?.[args[0]] ?? 0;
    },
    npm: 'npm',
    node: 'node',
    cli: '/pkg/main.js',
    log: (l) => lines.push(l),
    ...over,
  };
  return { deps, lines, ran, text: () => lines.join('\n') };
}

describe('reaper-mcp update', () => {
  it('installs the newer release and then puts it into REAPER', async () => {
    const t = setup();
    expect(await runUpdate(t.deps)).toBe(0);
    expect(t.ran).toEqual(['npm install -g @mthines/reaper-mcp@0.84.0', 'node /pkg/main.js setup --yes']);
    expect(t.text()).toContain('Updated to v0.84.0');
  });

  it('does nothing when npm has nothing newer', async () => {
    const t = setup({ latest: async () => '0.83.0' });
    expect(await runUpdate(t.deps)).toBe(0);
    expect(t.ran).toEqual([]);
    expect(t.text()).toContain('Already on the latest version');
  });

  it('exits 3 for nothing newer when the bridge runs it, so the page can tell it from an install', async () => {
    const t = setup({ latest: async () => '0.83.0', bridge: true });
    expect(await runUpdate(t.deps)).toBe(3);
  });

  it('reinstalls the same version with force', async () => {
    const t = setup({ latest: async () => '0.83.0', force: true });
    expect(await runUpdate(t.deps)).toBe(0);
    expect(t.ran).toHaveLength(2);
  });

  it('fails without touching anything when npm cannot be reached', async () => {
    const t = setup({ latest: async () => undefined });
    expect(await runUpdate(t.deps)).toBe(1);
    expect(t.ran).toEqual([]);
    expect(t.text()).toContain('internet connection');
  });

  it('stops and names the command to run by hand when the download fails', async () => {
    const t = setup({ exit: { install: 1 } });
    expect(await runUpdate(t.deps)).toBe(1);
    expect(t.ran).toHaveLength(1);
    expect(t.text()).toContain('npm install -g @mthines/reaper-mcp@latest');
  });

  it('reports a failed install into REAPER after a good download', async () => {
    const t = setup({ exit: { '/pkg/main.js': 1 } });
    expect(await runUpdate(t.deps)).toBe(2);
    expect(t.text()).toContain('reaper-mcp setup');
  });

  it('fails and says why when GitHub has a release npm cannot offer, instead of reporting nothing newer', async () => {
    const t = setup({ latest: async () => '0.83.0', released: async () => '0.91.1', bridge: true });
    expect(await runUpdate(t.deps)).toBe(1);
    expect(t.ran).toEqual([]);
    expect(t.text()).toContain('v0.91.1 is released');
    expect(t.text()).toContain('Aikido');
  });

  it('stays quiet about GitHub when it cannot be reached', async () => {
    const t = setup({ latest: async () => '0.83.0', released: async () => undefined, bridge: true });
    expect(await runUpdate(t.deps)).toBe(3);
  });

  it('fails when npm reports success but the old version is still installed', async () => {
    const t = setup({ installed: () => '0.83.0' });
    expect(await runUpdate(t.deps)).toBe(1);
    expect(t.ran).toEqual(['npm install -g @mthines/reaper-mcp@0.84.0']);
    expect(t.text()).toContain('v0.83.0 is still the installed version');
  });

  it('goes on to setup when the installed version is the new one', async () => {
    const t = setup({ installed: () => '0.84.0' });
    expect(await runUpdate(t.deps)).toBe(0);
  });

  it('installs what npm offers and says so when GitHub has an even newer release npm hides', async () => {
    const t = setup({ latest: async () => '0.90.0', released: async () => '0.91.1', bridge: true });
    expect(await runUpdate(t.deps)).toBe(0);
    expect(t.ran).toEqual(['npm install -g @mthines/reaper-mcp@0.90.0', 'node /pkg/main.js setup --yes']);
    expect(t.text()).toContain('Updated to v0.90.0');
    expect(t.text()).toContain('v0.91.1 is released too');
  });
});
