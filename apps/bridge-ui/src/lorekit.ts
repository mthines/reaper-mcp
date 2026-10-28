import { formatContribution, parseContribution, type ContributedRecord } from './plugin-contributions.mjs';
import type { InstalledFx, PluginRecord, PublishResult, UsedFx } from './plugins.js';

// Plugin knowledge straight from LoreKit's REST API (it allows browser origins; the /mcp endpoint the
// server uses does not). Built-in records come with the public read-only token bundled at build time;
// the viewer's own `user::` records only with their own read-only token. Members of the reaper-mcp
// org can also publish their records into the built-in layer with an lk_rw_ token (publishRecord).

export const LOREKIT_SCOPE = 'project::reaper-mcp';
/** The LoreKit org that owns the built-in layer; LoreKit checks write membership on every publish */
export const BUILTIN_ORG = 'reaper-mcp';

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

/** The built-in record a `user::` record becomes, checked exactly like a contributed file. */
export function builtInRecord(record: PluginRecord): ContributedRecord {
  if (!record.source) throw new Error('Only your own records can be published');
  const { records, errors } = parseContribution(formatContribution([{ key: record.key, tags: record.source.tags, value: record.source.value }]));
  if (errors.length) throw new Error(errors.join(' '));
  return records[0];
}

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return 'LoreKit refused the token';
  if (res.status === 403) return `LoreKit refused the write: the token needs write access as a member of the ${BUILTIN_ORG} org`;
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const msg = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : '';
    if (msg) return `LoreKit answered ${res.status}: ${msg}`;
  } catch {
    // not JSON
  }
  return `LoreKit answered ${res.status}`;
}

/**
 * Write one of the viewer's records into the built-in layer (owned by the reaper-mcp org), then
 * optionally archive their `user::` copy, which would otherwise keep overriding it. Archiving is
 * soft (restorable in LoreKit) and only happens after the publish succeeded.
 */
export async function publishRecord(api: string, token: string, record: PluginRecord, { removeCopy }: { removeCopy: boolean }): Promise<PublishResult> {
  if (!token.startsWith('lk_rw_')) throw new Error('Publishing needs a read + write LoreKit token (lk_rw_…)');
  const built = builtInRecord(record);
  const headers = { Authorization: `Bearer ${token}`, 'X-LoreKit-Client': 'api' };
  const res = await fetch(`${api}/memories`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: LOREKIT_SCOPE,
      org: BUILTIN_ORG,
      key: built.key,
      value: built.value,
      tags: built.tags,
      source_agent: 'mcp-bridge',
      trigger: 'manual',
    }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json().catch(() => ({}))) as { notice?: unknown };
  // With an explicit org LoreKit refuses rather than falling back; a notice means it wrote somewhere else
  if (typeof body.notice === 'string' && body.notice) throw new Error(`LoreKit didn't write to the built-in layer: ${body.notice}`);

  if (!removeCopy) return { key: built.key, removedCopy: false };
  const q = new URLSearchParams({ scope: LOREKIT_SCOPE, key: record.key });
  try {
    const del = await fetch(`${api}/memories?${q}`, { method: 'DELETE', headers });
    if (!del.ok) return { key: built.key, removedCopy: false, warning: `Published, but your copy wasn't archived (${await errorMessage(del)})` };
  } catch (e) {
    return { key: built.key, removedCopy: false, warning: `Published, but your copy wasn't archived (${e instanceof Error ? e.message : String(e)})` };
  }
  return { key: built.key, removedCopy: true };
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
