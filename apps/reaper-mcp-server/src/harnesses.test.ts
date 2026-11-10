import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { connectHarness, detectHarnesses, isStale, manualCommand, onPath, parseHarnessFlag, quoteForCmd, registeredServer, skillsHomes, type HarnessEnv, type Runner } from './harnesses.js';
import { installClaudeAssets } from './claude-assets.js';

describe('harnesses', () => {
  let tmp: string;
  let env: HarnessEnv;
  const installedBinaries = new Set<string>();
  const NODE = '/usr/bin/node';

  beforeEach(() => {
    tmp = join(tmpdir(), `reaper-mcp-harness-${randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
    installedBinaries.clear();
    env = { home: tmp, hasBinary: (name) => installedBinaries.has(name) };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // A harness's own `mcp add` command writes its config; this stands in for that command
  const cliThatWrites = (writes: Record<string, () => void>): Runner => (bin, args) => {
    if (args[1] === 'add') writes[bin]();
  };

  describe('detecting what is installed', () => {
    it('lists the harnesses whose command is on the machine, and Cursor by its config folder', () => {
      installedBinaries.add('codex');
      mkdirSync(join(tmp, '.cursor'));
      expect(detectHarnesses(env).map((h) => h.id)).toEqual(['codex', 'cursor']);
    });

    it('finds nothing on a machine with no harness', () => {
      expect(detectHarnesses(env)).toEqual([]);
    });

    it('finds a command in a PATH folder', () => {
      const bin = join(tmp, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'gemini'), '#!/bin/sh\n');
      chmodSync(join(bin, 'gemini'), 0o755);
      expect(onPath('gemini', bin, false)).toBe(true);
      expect(onPath('codex', bin, false)).toBe(false);
    });
  });

  describe('reading what a harness has registered', () => {
    it('reads the reaper server from Claude Code, Gemini CLI and Cursor JSON configs', () => {
      const entry = { mcpServers: { reaper: { command: NODE, args: ['/m/main.js', 'serve'] }, other: { command: 'x' } } };
      writeFileSync(join(tmp, '.claude.json'), JSON.stringify(entry));
      mkdirSync(join(tmp, '.gemini'));
      writeFileSync(join(tmp, '.gemini', 'settings.json'), JSON.stringify(entry));
      mkdirSync(join(tmp, '.cursor'));
      writeFileSync(join(tmp, '.cursor', 'mcp.json'), JSON.stringify(entry));
      for (const id of ['claude', 'gemini', 'cursor'] as const) {
        expect(registeredServer(id, env)).toEqual({ command: NODE, args: ['/m/main.js', 'serve'] });
      }
    });

    it("reads the reaper server from Codex's config.toml and ignores other servers", () => {
      mkdirSync(join(tmp, '.codex'));
      writeFileSync(
        join(tmp, '.codex', 'config.toml'),
        ['[mcp_servers.argent]', 'command = "argent"', 'args = ["mcp"]', '', '[mcp_servers.reaper]', `command = "${NODE}"`, 'args = ["/m/main.js", "serve"]', '', '[mcp_servers.reaper.tools.x]', 'approval_mode = "approve"', ''].join('\n'),
      );
      expect(registeredServer('codex', env)).toEqual({ command: NODE, args: ['/m/main.js', 'serve'] });
    });

    it('follows CODEX_HOME for Codex', () => {
      const elsewhere = join(tmp, 'codex-home');
      mkdirSync(elsewhere);
      writeFileSync(join(elsewhere, 'config.toml'), `[mcp_servers.reaper]\ncommand = "${NODE}"\nargs = ["/m/main.js", "serve"]\n`);
      expect(registeredServer('codex', { ...env, codexHome: elsewhere })?.args[0]).toBe('/m/main.js');
      expect(registeredServer('codex', env)).toBeNull();
    });

    it('is null when nothing is registered or the file is unreadable', () => {
      writeFileSync(join(tmp, '.claude.json'), '{ not json');
      expect(registeredServer('claude', env)).toBeNull();
      expect(registeredServer('gemini', env)).toBeNull();
    });

    it('calls an entry stale only when an absolute path in it is gone', () => {
      const real = join(tmp, 'main.js');
      writeFileSync(real, '');
      expect(isStale({ command: 'node', args: [real, 'serve'] })).toBe(false);
      expect(isStale({ command: 'node', args: [join(tmp, 'gone.js'), 'serve'] })).toBe(true);
      expect(isStale({ command: join(tmp, 'old-node'), args: [real] })).toBe(true);
    });
  });

  describe('connecting a harness', () => {
    it('registers Codex through its own command and reports it connected', () => {
      const run = cliThatWrites({
        codex: () => {
          mkdirSync(join(tmp, '.codex'), { recursive: true });
          writeFileSync(join(tmp, '.codex', 'config.toml'), `[mcp_servers.reaper]\ncommand = "${NODE}"\nargs = ["/m/main.js", "serve"]\n`);
        },
      });
      expect(connectHarness('codex', NODE, '/m/main.js', env, run)).toEqual({ id: 'codex', status: 'connected' });
      expect(registeredServer('codex', env)).not.toBeNull();
    });

    it('leaves a working registration alone', () => {
      const main = join(tmp, 'main.js');
      writeFileSync(main, '');
      mkdirSync(join(tmp, '.gemini'));
      writeFileSync(join(tmp, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { reaper: { command: process.execPath, args: [main, 'serve'] } } }));
      const run: Runner = () => {
        throw new Error('must not run');
      };
      expect(connectHarness('gemini', NODE, main, env, run).status).toBe('already');
    });

    it('replaces an entry whose files are gone', () => {
      writeFileSync(join(tmp, '.claude.json'), JSON.stringify({ mcpServers: { reaper: { command: NODE, args: [join(tmp, 'moved.js'), 'serve'] } } }));
      const main = join(tmp, 'main.js');
      writeFileSync(main, '');
      const run = cliThatWrites({
        claude: () => writeFileSync(join(tmp, '.claude.json'), JSON.stringify({ mcpServers: { reaper: { command: process.execPath, args: [main, 'serve'] } } })),
      });
      expect(connectHarness('claude', process.execPath, main, env, run).status).toBe('replaced');
      expect(isStale(registeredServer('claude', env)!)).toBe(false);
    });

    it('writes Cursor\'s mcp.json and keeps the servers already in it', () => {
      mkdirSync(join(tmp, '.cursor'));
      writeFileSync(join(tmp, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { figma: { url: 'https://example.test/mcp' } }, other: 1 }));
      expect(connectHarness('cursor', NODE, '/m/main.js', env).status).toBe('connected');
      const written = JSON.parse(readFileSync(join(tmp, '.cursor', 'mcp.json'), 'utf-8'));
      expect(written.mcpServers.figma).toEqual({ url: 'https://example.test/mcp' });
      expect(written.mcpServers.reaper).toEqual({ command: NODE, args: ['/m/main.js', 'serve'] });
      expect(written.other).toBe(1);
    });

    it('creates Cursor\'s config folder when it is missing', () => {
      expect(connectHarness('cursor', NODE, '/m/main.js', env).status).toBe('connected');
      expect(existsSync(join(tmp, '.cursor', 'mcp.json'))).toBe(true);
    });

    it('reports a harness that is not installed with the line to type, and does not throw', () => {
      const run: Runner = () => {
        throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      };
      const r = connectHarness('codex', NODE, '/m/main.js', env, run);
      expect(r.status).toBe('failed');
      expect(r.detail).toContain('not found');
      expect(r.manual).toBe(`codex mcp add reaper -- ${NODE} /m/main.js serve`);
    });

    it('tells how to connect each harness by hand', () => {
      expect(manualCommand('claude', NODE, '/m/main.js', env)).toBe(`claude mcp add --scope user reaper -- ${NODE} /m/main.js serve`);
      expect(manualCommand('gemini', NODE, '/m/main.js', env)).toBe(`gemini mcp add --scope user reaper ${NODE} /m/main.js serve`);
      expect(manualCommand('cursor', NODE, '/m/main.js', env)).toContain(join(tmp, '.cursor', 'mcp.json'));
    });
  });

  describe('choosing harnesses on the command line', () => {
    it('uses what is installed when no flag is given', () => {
      expect(parseHarnessFlag(['node', 'main.js', 'init'])).toBeNull();
    });

    it('takes a comma list, in either spelling, without repeats', () => {
      expect(parseHarnessFlag(['init', '--harness', 'claude,codex'])).toEqual(['claude', 'codex']);
      expect(parseHarnessFlag(['init', '--harness=Gemini,gemini'])).toEqual(['gemini']);
    });

    it('--all means every supported harness', () => {
      expect(parseHarnessFlag(['init', '--all'])).toEqual(['claude', 'codex', 'gemini', 'cursor']);
    });

    it('refuses a harness it does not know and names the valid ones', () => {
      expect(() => parseHarnessFlag(['init', '--harness', 'codex,vim'])).toThrow(/Unknown harness: vim.*claude, codex, gemini, cursor/);
      expect(() => parseHarnessFlag(['init', '--harness'])).toThrow(/none given/);
    });
  });

  describe('where skills go', () => {
    it('keeps Claude Code in ~/.claude and the others in the shared ~/.agents', () => {
      expect(skillsHomes(['claude'])).toEqual({ claude: true, agents: false });
      expect(skillsHomes(['codex', 'gemini'])).toEqual({ claude: false, agents: true });
      expect(skillsHomes(['claude', 'cursor'])).toEqual({ claude: true, agents: true });
    });

    it('installs only skills and agents into the shared folder, never the knowledge', () => {
      const pkg = join(tmp, 'pkg');
      mkdirSync(join(pkg, 'skills', 'mixer'), { recursive: true });
      mkdirSync(join(pkg, 'agents'));
      mkdirSync(join(pkg, 'knowledge'));
      writeFileSync(join(pkg, 'skills', 'mixer', 'SKILL.md'), '# mixer');
      writeFileSync(join(pkg, 'agents', 'plugin-researcher.md'), '# agent');
      writeFileSync(join(pkg, 'knowledge', 'notes.md'), '# notes');
      const shared = join(tmp, '.agents');
      const r = installClaudeAssets(pkg, shared, { include: ['skills', 'agents'] });
      expect(r.installed.sort()).toEqual([join('agents', 'plugin-researcher.md'), join('skills', 'mixer', 'SKILL.md')]);
      expect(existsSync(join(shared, 'knowledge'))).toBe(false);
    });
  });
});

describe('quoteForCmd', () => {
  it('keeps a path with spaces as one argument for cmd.exe', () => {
    expect(quoteForCmd('C:\\Program Files\\nodejs\\node.exe')).toBe('"C:\\Program Files\\nodejs\\node.exe"');
  });

  it('leaves a plain argument alone and escapes an embedded quote', () => {
    expect(quoteForCmd('serve')).toBe('serve');
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""');
  });
});
