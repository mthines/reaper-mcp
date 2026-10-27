import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Read-only access to the built-in mix knowledge (plugin records + mixing lessons)
 * curated in the `reaper-mcp` LoreKit org. TS-only: no bridge command.
 *
 * The token is a read-only (`lk_ro_`) token scoped to `project::reaper-mcp` and the
 * `reaper-mcp` org. It ships in the bundle on purpose — it is public. Scope it with
 * LoreKit's `orgs_only` tenancy ("Selected orgs only"), which hides its owner's
 * personal rows; under any other tenancy the token also sees them, so the owning
 * account must keep nothing private in that scope. Every row is
 * still filtered to the `layer::built-in` tag here, and a token without the `lk_ro_`
 * prefix is refused, so a misconfigured token can neither leak nor write.
 *
 * The user's own layer (`user::` keys) is read and written through their own LoreKit
 * connection (`memory.*` tools), not through this module.
 */

export const LOREKIT_DEFAULT_URL = 'https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp';
/** Public read-only token, restricted to scope project::reaper-mcp and the reaper-mcp org. */
export const BUILTIN_LOREKIT_TOKEN = 'lk_ro_9YKX9WXJXZYKDQeRrG3bRt9XxYDn77Rj';
export const BUILTIN_SCOPE = 'project::reaper-mcp';
export const BUILTIN_TAG = 'layer::built-in';

const BUCKET_TAGS = { plugins: 'plugin-knowledge', lessons: 'loop::mixing-lessons' } as const;
const KEY_PREFIXES = { plugins: 'plugins::', lessons: 'mixing-lessons::' } as const;
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;

interface LoreKitEntry {
  scope?: string;
  key: string;
  value?: string;
  tags?: string[];
  updated_at?: string;
  value_bytes?: number;
  preview?: string;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): { url: string; token: string } {
  return {
    url: env.REAPER_MCP_LOREKIT_URL || LOREKIT_DEFAULT_URL,
    token: env.REAPER_MCP_LOREKIT_TOKEN ?? BUILTIN_LOREKIT_TOKEN,
  };
}

const cache = new Map<string, { expires: number; data: unknown }>();

export function clearKnowledgeCache(): void {
  cache.clear();
}

/** Call one LoreKit MCP tool over JSON-RPC and return its parsed JSON payload. */
export async function callLoreKit(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const { url, token } = resolveConfig();
  if (!token) {
    throw new Error('Built-in knowledge is not configured (no LoreKit read-only token). Set REAPER_MCP_LOREKIT_TOKEN or use your own LoreKit memory.');
  }
  if (!token.startsWith('lk_ro_')) {
    throw new Error('Refusing a LoreKit token that is not read-only (expected an lk_ro_ token).');
  }

  const cacheKey = JSON.stringify([url, tool, args]);
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.data;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LoreKit HTTP ${res.status}`);

  const body = (await res.json()) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { type: string; text: string }[] };
  };
  if (body.error) throw new Error(`LoreKit: ${body.error.message ?? 'unknown error'}`);
  const text = body.result?.content?.[0]?.text ?? 'null';
  if (body.result?.isError) throw new Error(`LoreKit: ${text}`);

  const data = JSON.parse(text) as unknown;
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, data });
  return data;
}

function isBuiltIn(entry: LoreKitEntry): boolean {
  return Boolean(entry.tags?.includes(BUILTIN_TAG));
}

function isBuiltInKey(key: string): boolean {
  return key.startsWith(KEY_PREFIXES.plugins) || key.startsWith(KEY_PREFIXES.lessons);
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
}

export function registerKnowledgeTools(server: McpServer): void {
  server.tool(
    'list_builtin_knowledge',
    'List the built-in (read-only, curated) mix knowledge: plugin records and mixing lessons. Without query: summaries (key, tags, preview) — filter plugins by tags such as "category::eq" or "fx::Pro-Q 3". With query: full-text search returning full bodies. Combine with the user\'s own LoreKit layer (user:: keys), which overrides these.',
    {
      kind: z.enum(['plugins', 'lessons', 'all']).optional().describe('Which bucket (default all)'),
      tags: z.array(z.string()).optional().describe('List mode: return rows having ANY of these tags (e.g. ["category::compressor"])'),
      query: z.string().optional().describe('Full-text search instead of a list (e.g. "drum bus attack")'),
      limit: z.coerce.number().int().min(1).max(100).optional().describe('Max results (default 50 for list, 5 for search)'),
    },
    async ({ kind = 'all', tags, query, limit }) => {
      try {
        const wantKey = (key: string) => kind === 'all' ? isBuiltInKey(key) : key.startsWith(KEY_PREFIXES[kind]);
        let entries: LoreKitEntry[];
        if (query) {
          const searchTags = kind === 'all' ? [BUILTIN_TAG] : [BUILTIN_TAG, BUCKET_TAGS[kind]];
          const data = await callLoreKit('memory.search', { q: query, scopes: [BUILTIN_SCOPE], tags: searchTags, limit: limit ?? 5 });
          entries = (data as { entries?: LoreKitEntry[] } | null)?.entries ?? [];
        } else {
          const listTags = tags?.length ? tags : kind === 'all' ? Object.values(BUCKET_TAGS) : [BUCKET_TAGS[kind]];
          const data = await callLoreKit('memory.list', { scope: BUILTIN_SCOPE, tags: listTags, view: 'summary', limit: limit ?? 50 });
          entries = (data as { entries?: LoreKitEntry[] } | null)?.entries ?? [];
        }
        const rows = entries
          .filter(e => isBuiltIn(e) && wantKey(e.key))
          .map(({ key, tags: t, value, preview, updated_at }) => ({ key, tags: t, ...(value !== undefined ? { value } : { preview }), updated_at }));
        return ok({ layer: 'built-in', scope: BUILTIN_SCOPE, count: rows.length, entries: rows });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'get_builtin_knowledge',
    'Read one built-in (read-only) record by key: "plugins::<vendor>/<plugin>" (e.g. "plugins::fabfilter/pro-q-3") or "mixing-lessons::<slug>". Returns null when the built-in layer has no such record. The user\'s own "user::" record of the same name, if any, overrides it.',
    {
      key: z.string().describe('Built-in key, e.g. "plugins::fabfilter/pro-q-3"'),
    },
    async ({ key }) => {
      if (!isBuiltInKey(key)) {
        return fail(new Error('Key must start with "plugins::" or "mixing-lessons::" (user:: keys live in your own LoreKit memory).'));
      }
      try {
        const data = await callLoreKit('memory.read', { scope: BUILTIN_SCOPE, key }) as { value?: string; updated_at?: string } | null;
        return ok({ layer: 'built-in', key, record: data?.value !== undefined ? { value: data.value, updated_at: data.updated_at } : null });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
