import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Resolve asset path — checks sibling (npm published) then parent (dev build) */
export function resolveAssetDir(baseDir: string, name: string): string {
  const sibling = join(baseDir, name);
  if (existsSync(sibling)) return sibling;
  return join(baseDir, '..', name);
}

/** Recursively copy a directory, returns file count */
export function copyDirSync(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/** Copy a single file if it exists, returns success */
export function installFile(src: string, dest: string): boolean {
  if (existsSync(src)) {
    copyFileSync(src, dest);
    return true;
  }
  return false;
}

/** Create .mcp.json with reaper server config */
export function createMcpJson(targetPath: string): boolean {
  if (existsSync(targetPath)) return false;
  const config = JSON.stringify({
    mcpServers: {
      reaper: {
        command: 'npx',
        args: ['@mthines/reaper-mcp', 'serve'],
      },
    },
  }, null, 2);
  writeFileSync(targetPath, config + '\n', 'utf-8');
  return true;
}

/** Expected REAPER asset files that must be in the package */
export const REAPER_ASSETS = [
  'mcp_bridge.lua',
  'mcp_analyzer.jsfx',
  'mcp_lufs_meter.jsfx',
  'mcp_correlation_meter.jsfx',
  'mcp_crest_factor.jsfx',
] as const;

/** Expected knowledge subdirectories */
export const KNOWLEDGE_DIRS = ['genres', 'plugins', 'workflows', 'reference'] as const;
