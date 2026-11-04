/**
 * The manifest every extension ships as `reaper-mcp-extension.json`, and the one function that checks it.
 * The server's loader, `reaper-mcp extension add` and `doctor` all call `validateManifest`, so an extension
 * is accepted or refused for the same reasons everywhere.
 */

/** Bumped when `ExtensionApi` changes in a way an existing extension would notice. */
export const EXTENSION_API_VERSION = 1;

export const MANIFEST_FILE = 'reaper-mcp-extension.json';

export interface ExtensionManifest {
  /** Lowercase letters, digits and dashes; prefixes every tool the extension registers (`vital` -> `vital_read_patch`). */
  name: string;
  version: string;
  /** The `EXTENSION_API_VERSION` the extension was written against. */
  apiVersion: number;
  description?: string;
  author?: string;
  homepage?: string;
  /** ES module with `register(api)` as its default export (or a named `register`), relative to the extension folder. */
  main: string;
  /** Lua handlers for `api.call()`, relative to the extension folder. Optional: most extensions need none. */
  lua?: string;
}

export type ManifestResult = { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] };

const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** A path inside the extension folder: relative, forward slashes, no `..`, no drive letter. */
export function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.length > 200) return false;
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p) || p.includes('\\') || p.includes('\0')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '');
}

export function validateManifest(raw: unknown): ManifestResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [`${MANIFEST_FILE} must be a JSON object`] };
  }
  const m = raw as Record<string, unknown>;

  if (typeof m['name'] !== 'string' || !NAME.test(m['name'])) {
    errors.push('"name" must be 2-32 characters: lowercase letters, digits and dashes, starting with a letter');
  }
  if (typeof m['version'] !== 'string' || !SEMVER.test(m['version'])) {
    errors.push('"version" must be a semantic version such as "1.0.0"');
  }
  if (!Number.isInteger(m['apiVersion'])) {
    errors.push('"apiVersion" must be an integer');
  } else if (m['apiVersion'] !== EXTENSION_API_VERSION) {
    errors.push(
      `"apiVersion" is ${String(m['apiVersion'])} but this reaper-mcp runs extension API ${EXTENSION_API_VERSION}; ` +
        'update the extension (or reaper-mcp)',
    );
  }
  if (!isSafeRelativePath(m['main'])) {
    errors.push('"main" must be a relative path inside the extension folder (no "..", no absolute path)');
  }
  if (m['lua'] !== undefined && !isSafeRelativePath(m['lua'])) {
    errors.push('"lua" must be a relative path inside the extension folder (no "..", no absolute path)');
  }
  for (const key of ['description', 'author', 'homepage'] as const) {
    if (m[key] !== undefined && typeof m[key] !== 'string') errors.push(`"${key}" must be a string`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      name: m['name'] as string,
      version: m['version'] as string,
      apiVersion: m['apiVersion'] as number,
      main: m['main'] as string,
      ...(m['lua'] !== undefined && { lua: m['lua'] as string }),
      ...(m['description'] !== undefined && { description: m['description'] as string }),
      ...(m['author'] !== undefined && { author: m['author'] as string }),
      ...(m['homepage'] !== undefined && { homepage: m['homepage'] as string }),
    },
  };
}
