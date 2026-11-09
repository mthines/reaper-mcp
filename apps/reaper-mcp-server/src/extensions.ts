import { copyFile, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  EXTENSION_API_VERSION,
  MANIFEST_FILE,
  createFxStateClient,
  validateManifest,
  type BridgeResult,
  type ExtensionApi,
  type ExtensionManifest,
  type ExtensionModule,
  type ToolResult,
} from '@reaper-mcp/extension-api';
import type { CommandType } from '@reaper-mcp/protocol';
import { z } from 'zod/v4';
import { ensureBridgeDir, sendCommand } from './bridge.js';
import { existsSync } from 'node:fs';
import type { Check } from './doctor-report.js';
import { registerExtensionCategory } from './tools/categories.js';

/** Where installed extensions live: one folder per extension. `REAPER_MCP_EXTENSIONS` overrides it. */
export function getExtensionsDir(): string {
  return process.env['REAPER_MCP_EXTENSIONS'] || join(homedir(), '.reaper-mcp', 'extensions');
}

export interface DiscoveredExtension {
  /** Folder name under the extensions folder */
  folder: string;
  dir: string;
  manifest?: ExtensionManifest;
  /** Why the extension cannot load; empty when the manifest is valid */
  errors: string[];
}

/** Every folder (or symlink to a folder) under `root`, with its manifest checked. A missing `root` is no extensions. */
export async function discoverExtensions(root: string = getExtensionsDir()): Promise<DiscoveredExtension[]> {
  let names: string[];
  try {
    names = (await readdir(root)).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
  const found: DiscoveredExtension[] = [];
  for (const folder of names) {
    const dir = join(root, folder);
    if (!(await stat(dir).catch(() => null))?.isDirectory()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
    } catch (err) {
      const why = (err as NodeJS.ErrnoException).code === 'ENOENT' ? `no ${MANIFEST_FILE}` : `${MANIFEST_FILE} is not valid JSON`;
      found.push({ folder, dir, errors: [why] });
      continue;
    }
    const result = validateManifest(raw);
    if (!result.ok) {
      found.push({ folder, dir, errors: result.errors });
    } else if (result.manifest.name !== folder) {
      found.push({ folder, dir, errors: [`folder name "${folder}" must match the manifest name "${result.manifest.name}"`] });
    } else {
      found.push({ folder, dir, manifest: result.manifest, errors: [] });
    }
  }
  return found;
}

export interface ExtensionStatus {
  name: string;
  version?: string;
  status: 'loaded' | 'skipped';
  reason?: string;
  tools: string[];
}

const REGISTER_TIMEOUT_MS = 10_000;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });

interface Registered {
  remove?: () => void;
}

function createApi(server: McpServer, manifest: ExtensionManifest) {
  const prefix = manifest.name.replace(/-/g, '_');
  const toolNames: string[] = [];
  const registered: Registered[] = [];
  let categoryDescription: string | undefined;
  const json = (data: unknown): ToolResult => text(JSON.stringify(data, null, 2));
  const error = (message: string): ToolResult => ({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true });

  const api: ExtensionApi = {
    name: manifest.name,
    apiVersion: EXTENSION_API_VERSION,
    z,
    tool(name, description, shape, handler) {
      if (!TOOL_NAME.test(name)) throw new Error(`tool name "${name}" must be lowercase letters, digits and underscores`);
      const full = `${prefix}_${name}`;
      if (full in (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools) {
        throw new Error(`tool "${full}" is already registered`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reg = (server.tool as any)(full, description, shape, async (args: never) => {
        try {
          return await handler(args);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      }) as Registered;
      registered.push(reg);
      toolNames.push(full);
    },
    bridge: (command: CommandType, params = {}, timeoutMs?: number): Promise<BridgeResult> => sendCommand(command, params, timeoutMs),
    call: (command, params = {}, timeoutMs?: number): Promise<BridgeResult> =>
      sendCommand('extension_call', { extension: manifest.name, command, paramsJson: JSON.stringify(params) }, timeoutMs),
    fxState: createFxStateClient({
      bridge: (command, params, timeoutMs) => sendCommand(command, params, timeoutMs),
      bridgeDir: ensureBridgeDir,
    }),
    reply: (res) => (res.success ? json(res.data) : error(res.error ?? 'failed')),
    json,
    error,
    describeCategory(description) {
      categoryDescription = description;
    },
  };

  return {
    api,
    toolNames,
    categoryDescription: () => categoryDescription,
    rollback: () => registered.forEach((r) => r.remove?.()),
  };
}

/** Copy the extension's Lua file next to the bridge's own, where `extension_call` reads it; only when it changed. */
async function installLua(dir: string, manifest: ExtensionManifest): Promise<void> {
  if (!manifest.lua) return;
  const target = join(await ensureBridgeDir(), 'extensions', manifest.name);
  await mkdir(target, { recursive: true });
  const src = join(dir, manifest.lua);
  const dest = join(target, 'handlers.lua');
  const [a, b] = await Promise.all([readFile(src), readFile(dest).catch(() => null)]);
  if (!b || !a.equals(b)) await copyFile(src, dest);
}

async function loadOne(server: McpServer, ext: DiscoveredExtension & { manifest: ExtensionManifest }): Promise<ExtensionStatus> {
  const { manifest, dir } = ext;
  const skipped = (reason: string): ExtensionStatus => ({ name: manifest.name, version: manifest.version, status: 'skipped', reason, tools: [] });
  const built = createApi(server, manifest);
  try {
    const realDir = await realpath(dir);
    const mainPath = await realpath(join(dir, manifest.main)).catch(() => null);
    if (!mainPath) return skipped(`"main" file ${manifest.main} does not exist (is the extension built?)`);
    if (!mainPath.startsWith(realDir + sep)) return skipped('"main" resolves outside the extension folder');
    if (manifest.lua) {
      const luaPath = await realpath(join(dir, manifest.lua)).catch(() => null);
      if (!luaPath) return skipped(`"lua" file ${manifest.lua} does not exist`);
      if (!luaPath.startsWith(realDir + sep)) return skipped('"lua" resolves outside the extension folder');
    }

    const mod = (await import(pathToFileURL(mainPath).href)) as { default?: ExtensionModule; register?: ExtensionModule['register'] };
    const register = mod.default?.register ?? mod.register;
    if (typeof register !== 'function') return skipped('its main file has no register(api) function');

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve(register(built.api)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`register() did not finish within ${REGISTER_TIMEOUT_MS / 1000} s`)), REGISTER_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }

    await installLua(dir, manifest);
    if (built.toolNames.length > 0) {
      registerExtensionCategory(manifest.name, built.categoryDescription() ?? manifest.description ?? `Tools from the ${manifest.name} extension`, built.toolNames);
    }
    return { name: manifest.name, version: manifest.version, status: 'loaded', tools: built.toolNames };
  } catch (err) {
    built.rollback();
    return skipped(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Load every installed extension into `server`. Never throws: an extension that is broken, built for another
 * API version or fails in `register()` is skipped (its tools are removed again) and reported, so one bad
 * extension can never stop `serve`.
 */
export async function loadExtensions(server: McpServer, root: string = getExtensionsDir(), include?: (name: string) => boolean): Promise<ExtensionStatus[]> {
  const statuses: ExtensionStatus[] = [];
  for (const ext of await discoverExtensions(root)) {
    if (include && !include(ext.manifest?.name ?? ext.folder)) {
      statuses.push({ name: ext.manifest?.name ?? ext.folder, status: 'skipped', reason: 'not in the REAPER_MCP_PROFILE', tools: [] });
      continue;
    }
    if (!ext.manifest) {
      statuses.push({ name: ext.folder, status: 'skipped', reason: ext.errors.join('; '), tools: [] });
    } else {
      statuses.push(await loadOne(server, { ...ext, manifest: ext.manifest }));
    }
  }
  return statuses;
}

/** One doctor row per installed extension: manifest valid, API version supported, entry (and Lua) files present. No rows when none are installed. */
export async function checkExtensions(root: string = getExtensionsDir()): Promise<Check[]> {
  const checks: Check[] = [];
  for (const ext of await discoverExtensions(root)) {
    if (!ext.manifest) {
      checks.push({ label: ext.folder, status: 'fail', detail: ext.errors.join('; '), fix: `reaper-mcp extension remove ${ext.folder}, or fix its manifest` });
      continue;
    }
    const m = ext.manifest;
    const missing: string[] = [];
    for (const rel of [m.main, m.lua]) {
      if (rel && !existsSync(join(ext.dir, rel))) missing.push(rel);
    }
    checks.push(
      missing.length > 0
        ? { label: m.name, status: 'fail', detail: `missing ${missing.join(', ')}`, fix: `build it (pnpm nx build ${m.name}) or reinstall` }
        : { label: m.name, status: 'ok', detail: `v${m.version}${m.description ? ` · ${m.description}` : ''}` },
    );
  }
  return checks;
}
