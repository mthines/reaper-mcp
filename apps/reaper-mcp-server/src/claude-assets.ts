import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Installs the mix skills, subagents and knowledge that ship inside the npm package into ~/.claude.
 *
 * A clone symlinks them instead (scripts/sync-symlinks.sh), so edits in the repo are live. An npm install
 * copies, since a global package path moves with Node versions and upgrades. The rules:
 *
 *  - A path that is a symlink (the clone's links) is never touched.
 *  - The package owns what it installed, tracked by hash in a manifest: an unchanged file is updated on a
 *    later run, a file the user edited is left alone and reported.
 *  - A file that exists without a manifest entry is the user's own and is left alone (unless identical).
 *  - Nothing is ever deleted, and files the user added (learned plugins, lessons) are never read or replaced.
 */

export const CLAUDE_MANIFEST = '.reaper-mcp-installed.json';

export interface ClaudeAssetsResult {
  installed: string[];
  updated: string[];
  unchanged: number;
  /** Left alone because the user edited them, own them, or a symlink points elsewhere */
  skipped: { path: string; reason: 'edited' | 'not-ours' | 'symlink' | 'broken-symlink' }[];
}

type Manifest = { version: 1; files: Record<string, string> };

const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function readManifest(path: string): Manifest {
  try {
    const m = JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
    if (m && m.version === 1 && m.files && typeof m.files === 'object') return m;
  } catch {
    /* none yet, or unreadable: start fresh (every existing file then counts as the user's) */
  }
  return { version: 1, files: {} };
}

/**
 * @param packageClaudeDir the package's `claude/` folder (skills/, agents/, knowledge/)
 * @param claudeDir        the user's ~/.claude
 */
export function installClaudeAssets(packageClaudeDir: string, claudeDir: string, opts: { dryRun?: boolean } = {}): ClaudeAssetsResult {
  const result: ClaudeAssetsResult = { installed: [], updated: [], unchanged: 0, skipped: [] };
  const manifestPath = join(claudeDir, CLAUDE_MANIFEST);
  const manifest = readManifest(manifestPath);

  // [source file, destination file, the top-level path whose symlink status decides]
  const plan: [string, string, string][] = [];
  const skillsSrc = join(packageClaudeDir, 'skills');
  if (existsSync(skillsSrc)) {
    for (const f of listFiles(skillsSrc)) {
      const rel = relative(skillsSrc, f);
      // A maintainer skill (.repo-only) belongs to the repo, never to a user's ~/.claude
      if (existsSync(join(skillsSrc, rel.split(/[\\/]/)[0], '.repo-only'))) continue;
      plan.push([f, join(claudeDir, 'skills', rel), join(claudeDir, 'skills', rel.split(/[\\/]/)[0])]);
    }
  }
  const agentsSrc = join(packageClaudeDir, 'agents');
  if (existsSync(agentsSrc)) {
    for (const f of listFiles(agentsSrc)) {
      const dest = join(claudeDir, 'agents', relative(agentsSrc, f));
      plan.push([f, dest, dest]);
    }
  }
  const knowledgeSrc = join(packageClaudeDir, 'knowledge');
  if (existsSync(knowledgeSrc)) {
    for (const f of listFiles(knowledgeSrc)) {
      plan.push([f, join(claudeDir, 'knowledge', relative(knowledgeSrc, f)), join(claudeDir, 'knowledge')]);
    }
  }

  const skippedSymlinks = new Set<string>();
  for (const [src, dest, linkRoot] of plan) {
    if (isSymlink(linkRoot)) {
      if (!skippedSymlinks.has(linkRoot)) {
        skippedSymlinks.add(linkRoot);
        // A link whose target is gone (a deleted clone) is never repaired for the user, but it must be named
        result.skipped.push({ path: linkRoot, reason: existsSync(linkRoot) ? 'symlink' : 'broken-symlink' });
      }
      continue;
    }
    const key = relative(claudeDir, dest);
    const content = readFileSync(src);
    const hash = sha(content);

    if (!existsSync(dest)) {
      if (!opts.dryRun) {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, content);
        manifest.files[key] = hash;
      }
      result.installed.push(key);
      continue;
    }

    const current = sha(readFileSync(dest));
    if (current === hash) {
      if (!opts.dryRun) manifest.files[key] = hash;
      result.unchanged++;
    } else if (manifest.files[key] === current) {
      // Ours and untouched since we wrote it: take the newer version
      if (!opts.dryRun) {
        writeFileSync(dest, content);
        manifest.files[key] = hash;
      }
      result.updated.push(key);
    } else {
      result.skipped.push({ path: key, reason: key in manifest.files ? 'edited' : 'not-ours' });
    }
  }

  if (!opts.dryRun && (result.installed.length || result.updated.length || result.unchanged)) {
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  return result;
}
