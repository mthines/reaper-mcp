import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { EXTENSION_API_VERSION, MANIFEST_FILE, validateManifest, type ExtensionManifest } from '@reaper-mcp/extension-api';
import { discoverExtensions, getExtensionsDir } from './extensions.js';
import { findCloneRoot } from './cli.js';

const run = promisify(execFile);

const NAME = /^[a-z][a-z0-9-]{1,31}$/;

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Read and check the manifest of an extension folder. */
export async function readManifest(dir: string): Promise<Outcome<{ manifest: ExtensionManifest }>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
  } catch (err) {
    return fail((err as NodeJS.ErrnoException).code === 'ENOENT' ? `${dir} has no ${MANIFEST_FILE}` : `${MANIFEST_FILE} in ${dir} is not valid JSON`);
  }
  const r = validateManifest(raw);
  return r.ok ? { ok: true, manifest: r.manifest } : fail(`${MANIFEST_FILE}: ${r.errors.join('; ')}`);
}

/** Install the extension folder `src` into `root` as a copy (shipped as is) or a symlink (a working copy that stays live). */
export async function installExtension(
  src: string,
  opts: { root?: string; mode: 'copy' | 'link'; force?: boolean },
): Promise<Outcome<{ name: string; dir: string; manifest: ExtensionManifest }>> {
  const root = opts.root ?? getExtensionsDir();
  const from = resolve(src);
  if (!(await stat(from).catch(() => null))?.isDirectory()) return fail(`${from} is not a folder`);
  const m = await readManifest(from);
  if (!m.ok) return m;
  const dest = join(root, m.manifest.name);
  const existing = await lstat(dest).catch(() => null);
  if (existing && !opts.force) return fail(`extension "${m.manifest.name}" is already installed at ${dest} (use --force to replace it)`);
  await mkdir(root, { recursive: true });
  if (existing) await removeInstalled(dest);
  if (opts.mode === 'link') {
    await symlink(from, dest, 'dir');
  } else {
    await cp(from, dest, { recursive: true, filter: (p) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p) });
  }
  return { ok: true, name: m.manifest.name, dir: dest, manifest: m.manifest };
}

/** Delete an installed folder; a symlink is only unlinked, never followed (a linked working copy must survive). */
async function removeInstalled(path: string): Promise<void> {
  const st = await lstat(path);
  if (st.isSymbolicLink()) await unlink(path);
  else await rm(path, { recursive: true, force: true });
}

export async function removeExtension(name: string, root: string = getExtensionsDir()): Promise<Outcome<{ wasLink: boolean }>> {
  if (!NAME.test(name)) return fail(`"${name}" is not a valid extension name`);
  const dest = join(root, name);
  const st = await lstat(dest).catch(() => null);
  if (!st) return fail(`extension "${name}" is not installed`);
  await removeInstalled(dest);
  return { ok: true, wasLink: st.isSymbolicLink() };
}

/** Write a starting point for a new extension into `<parent>/<name>/` (plain ES module, nothing to build). */
export async function scaffoldExtension(name: string, parent: string): Promise<Outcome<{ dir: string }>> {
  if (!NAME.test(name)) return fail('the name must be 2-32 characters: lowercase letters, digits and dashes, starting with a letter');
  const dir = join(resolve(parent), name);
  if (existsSync(dir) && (await readdir(dir)).length > 0) return fail(`${dir} already exists and is not empty`);
  await mkdir(dir, { recursive: true });
  const tool = name.replace(/-/g, '_');
  await writeFile(
    join(dir, MANIFEST_FILE),
    JSON.stringify({ name, version: '0.1.0', apiVersion: EXTENSION_API_VERSION, description: `The ${name} extension`, main: 'index.mjs' }, null, 2) + '\n',
  );
  await writeFile(
    join(dir, 'index.mjs'),
    `// ${name}: a reaper-mcp extension. Its tools appear as ${tool}_<tool name>.
// Everything it may touch is on \`api\` (see libs/extension-api in the reaper-mcp repo).

export default {
  register(api) {
    const { z } = api;

    api.tool('hello', 'Say hello, and read the project tempo to prove the bridge works', { name: z.string().optional() }, async ({ name }) => {
      const info = await api.bridge('get_project_info');
      if (!info.success) return api.error(info.error ?? 'could not read the project');
      return api.json({ greeting: \`Hello \${name ?? 'world'}\`, project: info.data });
    });

    api.describeCategory('What the ${name} tools do, in one sentence');
  },
};
`,
  );
  await writeFile(join(dir, 'README.md'), `# ${name}\n\nA reaper-mcp extension.\n\n\`\`\`bash\nreaper-mcp extension link .   # use this working copy; restart the MCP server to reload\n\`\`\`\n`);
  return { ok: true, dir };
}

export type Source = { kind: 'git'; url: string } | { kind: 'path'; path: string } | { kind: 'clone'; path: string } | { kind: 'unknown'; arg: string };

/** What `extension add <arg>` means: a git URL, a folder, or the name of an extension in this clone's `extensions/`. */
export function classifySource(arg: string, cloneRoot: string | null): Source {
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(arg) || /\.git$/.test(arg)) return { kind: 'git', url: arg };
  if (existsSync(arg) && existsSync(join(arg, MANIFEST_FILE))) return { kind: 'path', path: resolve(arg) };
  if (NAME.test(arg) && cloneRoot && existsSync(join(cloneRoot, 'extensions', arg, MANIFEST_FILE))) {
    return { kind: 'clone', path: join(cloneRoot, 'extensions', arg) };
  }
  return { kind: 'unknown', arg };
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

const out = (...a: unknown[]) => console.log(...a);

async function list(json: boolean): Promise<number> {
  const found = await discoverExtensions();
  if (json) {
    out(JSON.stringify(found.map((f) => ({ name: f.folder, version: f.manifest?.version, ok: f.errors.length === 0, errors: f.errors, dir: f.dir })), null, 2));
    return 0;
  }
  if (found.length === 0) {
    out(`No extensions installed (${getExtensionsDir()}).\nAdd one: reaper-mcp extension add <name | folder | git-url>`);
    return 0;
  }
  for (const f of found) {
    out(f.manifest ? `${f.folder} ${f.manifest.version}  ${f.manifest.description ?? ''}`.trimEnd() : `${f.folder}  NOT LOADABLE: ${f.errors.join('; ')}`);
  }
  return found.some((f) => f.errors.length > 0) ? 1 : 0;
}

async function add(args: string[]): Promise<number> {
  const force = args.includes('--force');
  const yes = args.includes('--yes') || args.includes('-y');
  const arg = args.find((a) => !a.startsWith('-'));
  if (!arg) {
    console.error('Usage: reaper-mcp extension add <name | folder | git-url> [--force] [--yes]');
    return 2;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const source = classifySource(arg, findCloneRoot(process.cwd()) ?? findCloneRoot(here));
  if (source.kind === 'unknown') {
    console.error(`"${arg}" is not an extension folder, a git URL, or the name of an extension in this clone's extensions/ folder.`);
    return 1;
  }

  let from: string;
  let tmp: string | undefined;
  let mode: 'copy' | 'link' = 'copy';
  try {
    if (source.kind === 'git') {
      tmp = await mkdtemp(join(tmpdir(), 'reaper-mcp-ext-'));
      from = join(tmp, 'src');
      await run('git', ['clone', '--depth', '1', source.url, from]);
    } else {
      from = source.path;
      if (source.kind === 'clone') mode = 'link';
    }

    const m = await readManifest(from);
    if (!m.ok) {
      console.error(m.error);
      return 1;
    }
    if (source.kind === 'git') {
      // Third-party code: it runs with your user's rights inside the MCP server (and Lua inside REAPER).
      out(`About to install "${m.manifest.name}" ${m.manifest.version} from ${source.url}`);
      out(`It runs as code on this machine${m.manifest.lua ? ', including Lua inside REAPER' : ''}. Read it first: ${from}`);
      if (!yes && !(await confirm('Install it?'))) {
        console.error('Not installed. Re-run with --yes to skip this question.');
        return 1;
      }
    }
    const r = await installExtension(from, { mode, force });
    if (!r.ok) {
      console.error(r.error);
      return 1;
    }
    out(`${mode === 'link' ? 'Linked' : 'Installed'} ${r.name} ${r.manifest.version} -> ${r.dir}`);
    if (!existsSync(join(from, r.manifest.main))) {
      out(`Note: ${r.manifest.main} does not exist yet. Build it (pnpm nx build ${r.name}), then restart the MCP server.`);
    } else {
      out('Restart the MCP server (or your Claude Code session) to load it.');
    }
    return 0;
  } catch (err) {
    console.error(`Could not install: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

/** `reaper-mcp extension <list|add|link|remove|new>`. Returns the exit code. */
export async function extensionCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case 'list':
      return list(rest.includes('--json'));
    case 'add':
      return add(rest);
    case 'link': {
      const dir = rest.find((a) => !a.startsWith('-'));
      if (!dir) {
        console.error('Usage: reaper-mcp extension link <folder> [--force]');
        return 2;
      }
      const r = await installExtension(dir, { mode: 'link', force: rest.includes('--force') });
      if (!r.ok) {
        console.error(r.error);
        return 1;
      }
      out(`Linked ${r.name} -> ${resolve(dir)}\nRestart the MCP server to load it.`);
      return 0;
    }
    case 'remove': {
      const name = rest.find((a) => !a.startsWith('-'));
      if (!name) {
        console.error('Usage: reaper-mcp extension remove <name>');
        return 2;
      }
      const r = await removeExtension(name);
      if (!r.ok) {
        console.error(r.error);
        return 1;
      }
      out(`Removed ${name}${r.wasLink ? ' (the linked folder was left alone)' : ''}.`);
      return 0;
    }
    case 'new': {
      const name = rest.find((a) => !a.startsWith('-'));
      if (!name) {
        console.error('Usage: reaper-mcp extension new <name> [--dir <parent folder>]');
        return 2;
      }
      const at = rest.indexOf('--dir');
      const r = await scaffoldExtension(name, at >= 0 && rest[at + 1] ? rest[at + 1] : '.');
      if (!r.ok) {
        console.error(r.error);
        return 1;
      }
      out(`Created ${r.dir}\nTry it: reaper-mcp extension link ${basename(r.dir)}`);
      return 0;
    }
    default:
      console.error('Usage: reaper-mcp extension <list | add <name|folder|git-url> | link <folder> | remove <name> | new <name>>');
      return 2;
  }
}
