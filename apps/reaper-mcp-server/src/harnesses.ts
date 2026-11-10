import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { homedir, platform } from 'node:os';

/**
 * The agent harnesses (the app you talk to that runs the MCP server) `reaper-mcp init` can connect.
 *
 * Every harness is told about the server the way it expects: Claude Code, Codex CLI and Gemini CLI through their
 * own `mcp add` command (so their config format stays theirs), Cursor through its mcp.json. All of them run the
 * same `node <main.js> serve` by absolute path, so nothing has to be on PATH.
 */

export type HarnessId = 'claude' | 'codex' | 'gemini' | 'cursor';

export interface Harness {
  id: HarnessId;
  name: string;
  /** The command that starts it; found on PATH to tell it is installed. Null when only a config folder tells (Cursor). */
  binary: string | null;
  /** What to do when it is not installed */
  installHint: string;
  /** Where its skills live: Claude Code reads ~/.claude, the others the shared ~/.agents */
  skillsHome: 'claude' | 'agents';
}

export const HARNESSES: Harness[] = [
  { id: 'claude', name: 'Claude Code', binary: 'claude', installHint: 'https://claude.com/claude-code', skillsHome: 'claude' },
  { id: 'codex', name: 'Codex CLI', binary: 'codex', installHint: 'npm install -g @openai/codex  (or: brew install codex)', skillsHome: 'agents' },
  { id: 'gemini', name: 'Gemini CLI', binary: 'gemini', installHint: 'npm install -g @google/gemini-cli', skillsHome: 'agents' },
  { id: 'cursor', name: 'Cursor', binary: null, installHint: 'https://cursor.com', skillsHome: 'agents' },
];

export const SERVER_NAME = 'reaper';

export interface HarnessEnv {
  home: string;
  /** Codex keeps its config in $CODEX_HOME when that is set */
  codexHome?: string;
  hasBinary(name: string): boolean;
}

/** True when `name` is an executable file in one of the PATH folders */
export function onPath(name: string, pathVar = process.env.PATH ?? '', win = platform() === 'win32'): boolean {
  const exts = win ? ['', '.exe', '.cmd', '.bat'] : [''];
  return pathVar
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((ext) => existsSync(join(dir, name + ext))));
}

export function realEnv(): HarnessEnv {
  return { home: homedir(), codexHome: process.env.CODEX_HOME || undefined, hasBinary: (name) => onPath(name) };
}

const configPath = (id: HarnessId, env: HarnessEnv): string =>
  ({
    claude: join(env.home, '.claude.json'),
    codex: join(env.codexHome ?? join(env.home, '.codex'), 'config.toml'),
    gemini: join(env.home, '.gemini', 'settings.json'),
    cursor: join(env.home, '.cursor', 'mcp.json'),
  })[id];

/** Harnesses that are installed on this machine, in the order above */
export function detectHarnesses(env: HarnessEnv = realEnv()): Harness[] {
  return HARNESSES.filter((h) => (h.binary ? env.hasBinary(h.binary) : existsSync(join(env.home, '.cursor'))));
}

export interface ServerEntry {
  command: string;
  args: string[];
}

/** The `reaper` server a harness has registered, or null */
export function registeredServer(id: HarnessId, env: HarnessEnv = realEnv()): ServerEntry | null {
  let text: string;
  try {
    text = readFileSync(configPath(id, env), 'utf-8');
  } catch {
    return null;
  }
  if (id === 'codex') return codexServer(text);
  try {
    const server = JSON.parse(text)?.mcpServers?.[SERVER_NAME];
    if (!server || typeof server.command !== 'string') return null;
    return { command: server.command, args: Array.isArray(server.args) ? server.args.filter((a: unknown): a is string => typeof a === 'string') : [] };
  } catch {
    return null;
  }
}

/** Reads `[mcp_servers.reaper]` out of Codex's config.toml (only the command and args, which `codex mcp add` writes as plain strings) */
function codexServer(toml: string): ServerEntry | null {
  const header = new RegExp(`^\\[mcp_servers\\.(?:${SERVER_NAME}|"${SERVER_NAME}")\\]\\s*$`, 'm').exec(toml);
  if (!header) return null;
  const rest = toml.slice(header.index + header[0].length);
  const next = /^\[/m.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  const command = /^command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(section)?.[1];
  if (!command) return null;
  const args = /^args\s*=\s*\[([^\]]*)\]/m.exec(section)?.[1] ?? '';
  const strings = (s: string) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2]));
  return { command: strings(command)[0], args: strings(args) };
}

/**
 * True when the registered server points at a node binary or script that no longer exists
 * (an nvm or Homebrew Node switch, a moved global package). Entries without absolute paths are never stale.
 */
export function isStale(server: ServerEntry): boolean {
  return [server.command, ...server.args].filter(isAbsolute).some((p) => !existsSync(p));
}

/** The harness's own command that registers the server (null: written to a file instead) */
export function addCommand(id: HarnessId, node: string, mainJs: string): { bin: string; args: string[] } | null {
  switch (id) {
    case 'claude':
      return { bin: 'claude', args: ['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', node, mainJs, 'serve'] };
    case 'codex':
      return { bin: 'codex', args: ['mcp', 'add', SERVER_NAME, '--', node, mainJs, 'serve'] };
    case 'gemini':
      return { bin: 'gemini', args: ['mcp', 'add', '--scope', 'user', SERVER_NAME, node, mainJs, 'serve'] };
    case 'cursor':
      return null;
  }
}

function removeCommand(id: HarnessId): { bin: string; args: string[] } | null {
  switch (id) {
    case 'claude':
      return { bin: 'claude', args: ['mcp', 'remove', '--scope', 'user', SERVER_NAME] };
    case 'codex':
      return { bin: 'codex', args: ['mcp', 'remove', SERVER_NAME] };
    case 'gemini':
      return { bin: 'gemini', args: ['mcp', 'remove', '--scope', 'user', SERVER_NAME] };
    case 'cursor':
      return null;
  }
}

/** The line to type to connect a harness yourself */
export function manualCommand(id: HarnessId, node: string, mainJs: string, env: HarnessEnv = realEnv()): string {
  const add = addCommand(id, node, mainJs);
  if (add) return [add.bin, ...add.args].join(' ');
  return `add "${SERVER_NAME}": { "command": "${node}", "args": ["${mainJs}", "serve"] } under "mcpServers" in ${configPath(id, env)}`;
}

export type ConnectStatus = 'connected' | 'replaced' | 'already' | 'failed';

export interface ConnectResult {
  id: HarnessId;
  status: ConnectStatus;
  /** For a failure: why, and how to do it by hand */
  detail?: string;
  manual?: string;
}

export type Runner = (bin: string, args: string[]) => void;

const realRunner: Runner = (bin, args) => {
  execFileSync(bin, args, { stdio: 'pipe' });
};

/** Writes the `reaper` entry into a harness's JSON config, keeping everything else in the file */
function writeJsonServer(path: string, node: string, mainJs: string): void {
  let config: Record<string, unknown> = {};
  if (existsSync(path)) config = JSON.parse(readFileSync(path, 'utf-8'));
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}) as Record<string, unknown>;
  servers[SERVER_NAME] = { command: node, args: [mainJs, 'serve'] };
  config.mcpServers = servers;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Register the server in one harness. A working registration is left alone; one whose node or main.js is gone is
 * replaced. A failure never throws: it comes back with the line to type instead.
 */
export function connectHarness(id: HarnessId, node: string, mainJs: string, env: HarnessEnv = realEnv(), run: Runner = realRunner): ConnectResult {
  const existing = registeredServer(id, env);
  if (existing && !isStale(existing)) return { id, status: 'already' };
  const manual = manualCommand(id, node, mainJs, env);
  try {
    const add = addCommand(id, node, mainJs);
    if (!add) {
      writeJsonServer(configPath(id, env), node, mainJs);
    } else {
      const remove = removeCommand(id);
      if (existing && remove) run(remove.bin, remove.args);
      run(add.bin, add.args);
    }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    const first = String((err as Error).message).split('\n')[0];
    return { id, status: 'failed', detail: missing ? 'its command was not found' : first, manual };
  }
  return { id, status: existing ? 'replaced' : 'connected' };
}

/** Parse `--harness claude,codex` / `--harness=codex` / `--all`. `null` means no flag: use what is installed. */
export function parseHarnessFlag(argv: string[]): HarnessId[] | null {
  if (argv.includes('--all')) return HARNESSES.map((h) => h.id);
  const i = argv.findIndex((a) => a === '--harness' || a.startsWith('--harness='));
  if (i < 0) return null;
  const value = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  const ids = (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const known = HARNESSES.map((h) => h.id as string);
  const bad = ids.filter((s) => !known.includes(s));
  if (!ids.length || bad.length) {
    throw new Error(`Unknown harness${bad.length > 1 ? 'es' : ''}: ${bad.join(', ') || '(none given)'}. Use one or more of: ${known.join(', ')}, or --all.`);
  }
  return [...new Set(ids)] as HarnessId[];
}

/** Which of the chosen harnesses keep their skills in ~/.claude and which in ~/.agents */
export function skillsHomes(ids: HarnessId[]): { claude: boolean; agents: boolean } {
  const chosen = HARNESSES.filter((h) => ids.includes(h.id));
  return { claude: chosen.some((h) => h.skillsHome === 'claude'), agents: chosen.some((h) => h.skillsHome === 'agents') };
}
