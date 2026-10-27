import type { InstalledFx, PluginRecord, UsedFx } from './plugins.js';

// Plugin knowledge straight from LoreKit's REST API (it allows browser origins; the /mcp endpoint the
// server uses does not). Built-in records come with the public read-only token bundled at build time;
// the viewer's own `user::` records only with their own read-only token.

export const LOREKIT_SCOPE = 'project::reaper-mcp';

/** A row from GET /memories */
export interface LoreKitEntry {
  id: string;
  key: string;
  value?: string;
  tags?: string[];
  updated_at?: string;
}

const tagValue = (tags: string[], name: string) => tags.find((t) => t.startsWith(`${name}::`))?.slice(name.length + 2);

/** The body of one `## Heading` section, without the heading. */
function section(value: string, heading: RegExp): string | undefined {
  const lines = value.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && heading.test(l));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

/** The record's Markdown without its title and the summary lines the drawer already shows as facts. */
export function recordBody(value: string): string {
  return value
    .replace(/^\s*#\s+.*\n?/, '')
    .split('\n')
    .filter((l) => !/^\s*\*\*(Category|Matches FX):\*\*/.test(l))
    .join('\n')
    .trim();
}

/** Turn a plugin-knowledge row into the record the Plugins view shows; null for anything else. */
export function parseRecord(entry: LoreKitEntry): PluginRecord | null {
  const tags = entry.tags ?? [];
  const user = entry.key.startsWith('user::plugins::');
  if (!user && !entry.key.startsWith('plugins::')) return null;
  if (!tags.includes('plugin-knowledge')) return null;
  if (!user && !tags.includes('layer::built-in')) return null;
  const value = entry.value ?? '';
  const preference = Number(tagValue(tags, 'preference'));
  const learned = section(value, /learned notes/i);
  return {
    id: entry.id,
    key: entry.key,
    name: value.match(/^#\s+(.+)$/m)?.[1].trim() ?? entry.key.split('/').pop() ?? entry.key,
    vendor: value.match(/\*\*Vendor:\*\*\s*([^·\n]+)/)?.[1].trim() ?? tagValue(tags, 'vendor') ?? '',
    category: tagValue(tags, 'category') ?? 'other',
    style: tagValue(tags, 'style'),
    preference: Number.isFinite(preference) ? preference : undefined,
    layer: user ? 'user' : 'built-in',
    matches: tags.filter((t) => t.startsWith('fx::')).map((t) => t.slice(4)),
    notes: learned ? learned.split('\n').filter((l) => /^(-|\*)\s/.test(l)).length : undefined,
    updatedAt: entry.updated_at ? Date.parse(entry.updated_at) : 0,
    preview: recordBody(value),
    source: user ? { value, tags } : undefined,
  };
}

/** One layer's plugin records: `plugins::` (built-in) or `user::plugins::` (the token owner's own). */
export async function fetchRecords(api: string, token: string, layer: 'built-in' | 'user', signal?: AbortSignal): Promise<PluginRecord[]> {
  if (!token.startsWith('lk_ro_')) throw new Error('Use a read-only LoreKit token (lk_ro_…)');
  const records: PluginRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({
      scope: LOREKIT_SCOPE,
      key_prefix: layer === 'user' ? 'user::plugins::' : 'plugins::',
      tags: layer === 'user' ? 'plugin-knowledge' : 'plugin-knowledge,layer::built-in',
      tags_mode: 'all',
      limit: '100',
    });
    if (cursor) q.set('cursor', cursor);
    const res = await fetch(`${api}/memories?${q}`, { headers: { Authorization: `Bearer ${token}`, 'X-LoreKit-Client': 'api' }, signal });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'LoreKit refused the token' : `LoreKit answered ${res.status}`);
    const body = (await res.json()) as { entries?: LoreKitEntry[]; hasMore?: boolean; nextCursor?: string | null };
    for (const e of body.entries ?? []) {
      const r = parseRecord(e);
      if (r && r.layer === layer) records.push(r);
    }
    if (!body.hasMore || !body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return records;
}

/** The bridge's ExtState `installed` payload: `{ v, supported, fx: [{ n, t }] }`. */
export function parseInstalled(raw: unknown): { supported: boolean; fx: InstalledFx[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { supported?: unknown; fx?: unknown };
  const rows = Array.isArray(o.fx) ? o.fx : [];
  const fx = rows.flatMap((r) => (r && typeof r === 'object' && typeof (r as { n?: unknown }).n === 'string' ? [{ name: (r as { n: string }).n, type: String((r as { t?: unknown }).t ?? '') }] : []));
  return { supported: o.supported !== false, fx };
}

/** The bridge's ExtState `used` payload: `{ v, fx: [{ n, c }] }`, FX in the open project. */
export function parseUsed(raw: unknown): UsedFx[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { fx?: unknown }).fx)) return null;
  return ((raw as { fx: unknown[] }).fx).flatMap((r) => {
    const o = r as { n?: unknown; c?: unknown } | null;
    return o && typeof o.n === 'string' && typeof o.c === 'number' && o.c > 0 ? [{ name: o.n, count: o.c }] : [];
  });
}
