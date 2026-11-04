/**
 * Loading a preset into Helix Native. The plugin's saved state is encrypted, so the only way in is its Import
 * dialog, which is driven by a user-supplied command (see `commandDriver`). What this module owns is the safety
 * around it: back up the library, let the import run, then check on disk that exactly one preset slot changed
 * (and the one that was meant); anything else is rolled back from the backup.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';

export const defaultLibraryDir = (): string =>
  process.env['HELIX_NATIVE_LIBRARY'] ?? join(homedir(), 'Library', 'Application Support', 'Line 6', 'Helix Native', '#PRESET_LIBRARY');

export type Hashes = Map<string, string>;

/** Hash every file under the library, keyed by path relative to it. */
export async function hashLibrary(dir: string): Promise<Hashes> {
  const out: Hashes = new Map();
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.set(relative(dir, full), createHash('sha1').update(await readFile(full)).digest('hex'));
    }
  }
  await walk(dir);
  return out;
}

export function diffHashes(before: Hashes, after: Hashes): { changed: string[]; added: string[]; removed: string[] } {
  const changed: string[] = [];
  const added: string[] = [];
  for (const [f, h] of after) {
    if (!before.has(f)) added.push(f);
    else if (before.get(f) !== h) changed.push(f);
  }
  const removed = [...before.keys()].filter((f) => !after.has(f));
  return { changed, added, removed };
}

/** `#SETLIST2/#PRESET008` -> `{ setlist: 2, preset: 8 }`; the setlist's `.nodes` index and anything else -> undefined. */
export function slotOf(file: string): { setlist: number; preset: number } | undefined {
  const m = /(?:^|[\\/])#SETLIST(\d+)[\\/]#PRESET(\d+)$/.exec(file);
  return m ? { setlist: Number(m[1]), preset: Number(m[2]) } : undefined;
}

export async function backupLibrary(dir: string, backupRoot: string, now = new Date()): Promise<string> {
  const dest = join(backupRoot, now.toISOString().replace(/[:.]/g, '-'));
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const target = join(dest, relative(dir, full));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(full, target);
      }
    }
  }
  await mkdir(dest, { recursive: true });
  await walk(dir);
  return dest;
}

async function restore(backup: string, dir: string, files: string[], added: string[]): Promise<void> {
  for (const f of files) await copyFile(join(backup, f), join(dir, f));
  for (const f of added) await rm(join(dir, f), { force: true });
}

/** Does whatever opens Helix Native's Import and loads one `.hlx`. Resolves once the plugin has been told to import. */
export interface ImportDriver {
  importFile(hlxPath: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Runs `argv` with `{file}` replaced by the `.hlx` path, e.g. an AppleScript that clicks through Import. */
export function commandDriver(argv: string[]): ImportDriver {
  return {
    importFile: (file) =>
      new Promise((resolve) => {
        const [cmd, ...args] = argv.map((a) => a.replaceAll('{file}', file));
        execFile(cmd, args, { timeout: 60_000 }, (err, _out, stderr) => resolve(err ? { ok: false, error: `${err.message} ${stderr}`.trim() } : { ok: true }));
      }),
  };
}

export interface SetOptions {
  hlxPath: string;
  libraryDir: string;
  backupRoot: string;
  driver: ImportDriver;
  /** The slot you mean to overwrite. The import is rolled back if it landed anywhere else. */
  expectSlot: { setlist: number; preset: number };
  /** How long to wait for the library to change after the driver returns (ms). */
  settleMs?: number;
}

export type SetOutcome =
  | { ok: true; slot: { setlist: number; preset: number }; backup: string }
  | { ok: false; error: string; backup?: string; rolledBack?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function setPreset(o: SetOptions): Promise<SetOutcome> {
  try {
    await stat(o.libraryDir);
    await stat(o.hlxPath);
  } catch (e) {
    return { ok: false, error: `missing path: ${e instanceof Error ? e.message : String(e)}` };
  }
  const before = await hashLibrary(o.libraryDir);
  const backup = await backupLibrary(o.libraryDir, o.backupRoot);

  const driven = await o.driver.importFile(o.hlxPath);
  if (!driven.ok) {
    const d = diffHashes(before, await hashLibrary(o.libraryDir));
    const touched = d.changed.length + d.added.length + d.removed.length > 0;
    if (touched) await restore(backup, o.libraryDir, d.changed.concat(d.removed), d.added);
    return { ok: false, error: `import did not run: ${driven.error}`, backup, ...(touched && { rolledBack: true }) };
  }

  const deadline = Date.now() + (o.settleMs ?? 15_000);
  let d = diffHashes(before, await hashLibrary(o.libraryDir));
  while (d.changed.length + d.added.length === 0 && Date.now() < deadline) {
    await sleep(250);
    d = diffHashes(before, await hashLibrary(o.libraryDir));
  }
  await sleep(500); // let the plugin finish writing the slot's index too

  d = diffHashes(before, await hashLibrary(o.libraryDir));
  const slots = [...d.changed, ...d.added].map(slotOf).filter((s): s is { setlist: number; preset: number } => s !== undefined);
  const unexpected = [...d.changed, ...d.added, ...d.removed].filter((f) => !slotOf(f) && !/#SETLIST\d+[\\/]\.nodes$/.test(f));
  const rollback = async (error: string): Promise<SetOutcome> => {
    await restore(backup, o.libraryDir, d.changed.concat(d.removed), d.added);
    return { ok: false, error: `${error}; the library was restored from ${backup}`, backup, rolledBack: true };
  };

  if (slots.length === 0) return { ok: false, error: 'the import changed no preset slot (the dialog may not have opened or confirmed); the library is untouched', backup };
  if (unexpected.length || d.removed.length) return rollback(`the import touched files outside preset slots (${[...unexpected, ...d.removed].join(', ')})`);
  if (slots.length > 1) return rollback(`the import changed ${slots.length} preset slots (${slots.map((s) => `${s.setlist}/${s.preset}`).join(', ')}); exactly one was expected`);
  const got = slots[0];
  if (got.setlist !== o.expectSlot.setlist || got.preset !== o.expectSlot.preset) {
    return rollback(`the import landed in setlist ${got.setlist} preset ${got.preset}, not the expected ${o.expectSlot.setlist}/${o.expectSlot.preset}`);
  }
  return { ok: true, slot: got, backup };
}
