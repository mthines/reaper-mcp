import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface KnowledgeFile {
  path: string;
  type: 'plugin' | 'genre' | 'workflow' | 'reference';
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Parse simple YAML frontmatter between --- delimiters.
 * Handles: string values, number values, boolean values, and array values.
 * Does not require an external YAML parser.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valuePart = trimmed.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Array value: ["item1", "item2"] or ['item1', 'item2']
    if (valuePart.startsWith('[')) {
      const inner = valuePart.slice(1, valuePart.lastIndexOf(']'));
      if (inner.trim() === '') {
        result[key] = [];
      } else {
        result[key] = inner
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter((s) => s.length > 0);
      }
      continue;
    }

    // Boolean
    if (valuePart === 'true') {
      result[key] = true;
      continue;
    }
    if (valuePart === 'false') {
      result[key] = false;
      continue;
    }

    // Number
    const num = Number(valuePart);
    if (valuePart !== '' && !isNaN(num)) {
      result[key] = num;
      continue;
    }

    // Quoted string
    if (
      (valuePart.startsWith('"') && valuePart.endsWith('"')) ||
      (valuePart.startsWith("'") && valuePart.endsWith("'"))
    ) {
      result[key] = valuePart.slice(1, -1);
      continue;
    }

    // Bare string (may be empty)
    result[key] = valuePart;
  }

  return result;
}

/**
 * Extract frontmatter and body from a markdown file string.
 * Returns { frontmatter, body } where frontmatter is the raw YAML string
 * between the first pair of --- delimiters.
 */
function splitFrontmatter(source: string): { frontmatterRaw: string; body: string } {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatterRaw: '', body: source };
  }

  const closeIdx = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (closeIdx === -1) {
    return { frontmatterRaw: '', body: source };
  }

  const frontmatterRaw = lines.slice(1, closeIdx).join('\n');
  const body = lines.slice(closeIdx + 1).join('\n').trimStart();
  return { frontmatterRaw, body };
}

/**
 * Determine the knowledge type from the file's path relative to knowledgeDir.
 */
function typeFromPath(
  relPath: string,
): 'plugin' | 'genre' | 'workflow' | 'reference' | null {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.startsWith('plugins/')) return 'plugin';
  if (normalized.startsWith('genres/')) return 'genre';
  if (normalized.startsWith('workflows/')) return 'workflow';
  if (normalized.startsWith('reference/')) return 'reference';
  return null;
}

/**
 * Recursively collect all .md file paths under a directory.
 */
async function collectMdFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMdFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Load and parse a single markdown knowledge file.
 * Returns null if the file cannot be typed (e.g. template or unknown path).
 */
async function loadFile(
  filePath: string,
  knowledgeDir: string,
): Promise<KnowledgeFile | null> {
  const source = await readFile(filePath, 'utf-8');
  const { frontmatterRaw, body } = splitFrontmatter(source);
  const frontmatter = parseFrontmatter(frontmatterRaw);

  const relPath = relative(knowledgeDir, filePath).replace(/\\/g, '/');
  const type = typeFromPath(relPath);

  if (!type) return null;

  // Skip template files
  if (relPath.includes('_template')) return null;

  return {
    path: filePath,
    type,
    frontmatter,
    content: body,
  };
}

/**
 * Load all knowledge files from the knowledge directory.
 */
export async function loadKnowledge(knowledgeDir: string): Promise<KnowledgeFile[]> {
  const paths = await collectMdFiles(knowledgeDir);
  const results = await Promise.all(paths.map((p) => loadFile(p, knowledgeDir)));
  return results.filter((f): f is KnowledgeFile => f !== null);
}

/**
 * Load only plugin knowledge files, optionally filtered by category.
 */
export async function loadPlugins(
  knowledgeDir: string,
  category?: string,
): Promise<KnowledgeFile[]> {
  const all = await loadKnowledge(knowledgeDir);
  const plugins = all.filter((f) => f.type === 'plugin');
  if (!category) return plugins;
  return plugins.filter((f) => f.frontmatter['category'] === category);
}

/**
 * Load a specific genre knowledge file by its id frontmatter field.
 */
export async function loadGenre(
  knowledgeDir: string,
  genreId: string,
): Promise<KnowledgeFile | null> {
  const all = await loadKnowledge(knowledgeDir);
  return (
    all.find(
      (f) => f.type === 'genre' && f.frontmatter['id'] === genreId,
    ) ?? null
  );
}

/**
 * Load a specific workflow knowledge file by its id frontmatter field.
 */
export async function loadWorkflow(
  knowledgeDir: string,
  workflowId: string,
): Promise<KnowledgeFile | null> {
  const all = await loadKnowledge(knowledgeDir);
  return (
    all.find(
      (f) => f.type === 'workflow' && f.frontmatter['id'] === workflowId,
    ) ?? null
  );
}

/**
 * Load all reference knowledge files.
 */
export async function loadReference(knowledgeDir: string): Promise<KnowledgeFile[]> {
  const all = await loadKnowledge(knowledgeDir);
  return all.filter((f) => f.type === 'reference');
}
