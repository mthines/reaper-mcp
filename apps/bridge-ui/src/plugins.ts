/** One plugin knowledge record from LoreKit (built-in layer or the user's own). */
export interface PluginRecord {
  /** LoreKit row id, for the deep link */
  id?: string;
  key: string;
  name: string;
  vendor: string;
  category: string;
  style?: string;
  /** 0-100: how strongly the skills prefer it within its category */
  preference?: number;
  layer: 'built-in' | 'user';
  /** FX names this record matches (the `fx::` tags) */
  matches: string[];
  /** Learned notes on the record (user layer) */
  notes?: number;
  updatedAt: number;
  /** The full LoreKit row for the viewer's own records, for Contribute */
  source?: { value: string; tags: string[] };
  /** The record body as Markdown (rendered safely by markdown.tsx) */
  preview: string;
}

/** An FX as REAPER lists it, e.g. "VST3: Pro-Q 3 (FabFilter)". */
export interface InstalledFx {
  name: string;
  type: string;
}

export interface KnowledgeFeed {
  installed: InstalledFx[];
  records: PluginRecord[];
  /** False when this REAPER can't enumerate its FX (needs 6.37+) */
  installedSupported?: boolean;
  /** Whether the viewer's own LoreKit records are included */
  userLayer?: 'off' | 'on' | 'error';
  /** Why something couldn't be loaded, shown above the list */
  problem?: string;
  /** FX in the open project and how many instances (track, master, input and take FX) */
  used?: UsedFx[];
}

export interface UsedFx {
  name: string;
  count: number;
}

export type Coverage = 'learned' | 'built-in' | 'unknown';

export interface PluginRow {
  fx: InstalledFx;
  /** Display name without the "VST3:" prefix and "(Vendor)" suffix */
  label: string;
  coverage: Coverage;
  /** The record the skills will use: the user's wins over the built-in one */
  record?: PluginRecord;
  /** The built-in record the user's record overrides, if any */
  shadows?: PluginRecord;
  /** Instances in the open project (0 when unused or unknown) */
  used: number;
  /** Who makes it: the record's vendor, else the "(Vendor)" suffix REAPER shows */
  creator: string;
}

const PREFIX = /^(VST3i?|VSTi?|AUi?|CLAPi?|LV2i?|DXi?|JS):\s*/i;
// Bracket tags REAPER adds that are neither a vendor nor part of the title: outputs, channels, architecture
const IO_TAG = /^(\d+\s*(->\s*\d+\s*)?(ch|out|in)|x86_64|x64|arm64|\d+\s*bit)$/i;

/**
 * Split a REAPER FX name into title and vendor. VST3/CLAP put the vendor first and then categories
 * ("VST3: Pro-C 2 (FabFilter) (Comp)"); VST2/AU put it last ("VST: Ozone 9 (x86_64) (iZotope)"). JSFX
 * titles keep their brackets ("JS: Channel mapper (18 out)") and have no vendor.
 */
export function parseFxName(name: string): { type: string; title: string; vendor?: string } {
  const type = (name.match(PREFIX)?.[1] ?? '').toUpperCase().replace(/I$/, '');
  let rest = name.replace(PREFIX, '').trim();
  if (type === 'JS' || type === '') return { type, title: rest };
  const groups: string[] = [];
  for (let m = rest.match(/\s*\(([^()]*)\)\s*$/); m && m.index !== undefined && m.index > 0; m = rest.match(/\s*\(([^()]*)\)\s*$/)) {
    groups.unshift(m[1].trim());
    rest = rest.slice(0, m.index);
  }
  const named = groups.map((g, i) => ({ g, i })).filter(({ g }) => !IO_TAG.test(g));
  const vendorFirst = type === 'VST3' || type === 'CLAP';
  const vendor = (vendorFirst ? named[0] : named[named.length - 1])?.i;
  // VST3/CLAP: everything after the vendor is a category; VST2/AU: groups before it are part of the title
  const kept = groups.filter((g, i) => i !== vendor && !IO_TAG.test(g) && !(vendorFirst && vendor !== undefined && i > vendor));
  return { type, title: [rest.trim(), ...kept.map((g) => `(${g})`)].join(' '), vendor: vendor === undefined ? undefined : groups[vendor] };
}

const norm = (s: string) =>
  parseFxName(s)
    .title.toLowerCase()
    .replace(/\s*\(mono\)/g, '')
    .replace(/[\s_-]+/g, '');

export function fxLabel(name: string): string {
  return parseFxName(name).title;
}

function matches(record: PluginRecord, fx: InstalledFx): boolean {
  const target = norm(fx.name);
  return record.matches.some((m) => norm(m) === target);
}


/**
 * Who makes an FX, for grouping. REAPER appends "(Vendor)" only to VST/AU/CLAP names; a JSFX's trailing
 * brackets are part of its title ("Channel mapper (18 out)"), so scripts group as "JSFX".
 */
export function creatorOf(fx: InstalledFx, record?: PluginRecord): string {
  if (record?.vendor) return record.vendor;
  const parsed = parseFxName(fx.name);
  if ((parsed.type || fx.type.toUpperCase()) === 'JS') return 'JSFX';
  return parsed.vendor || 'Other';
}

/** Pair every installed FX with the record the mix skills would use for it. */
export function pluginCoverage(feed: KnowledgeFeed): PluginRow[] {
  const exact = new Map<string, number>();
  const loose = new Map<string, number>();
  for (const u of feed.used ?? []) {
    exact.set(u.name, (exact.get(u.name) ?? 0) + u.count);
    loose.set(norm(u.name), (loose.get(norm(u.name)) ?? 0) + u.count);
  }
  return feed.installed.map((fx) => {
    const user = feed.records.find((r) => r.layer === 'user' && matches(r, fx));
    const builtIn = feed.records.find((r) => r.layer === 'built-in' && matches(r, fx));
    const record = user ?? builtIn;
    return {
      fx,
      label: fxLabel(fx.name),
      coverage: user ? 'learned' : builtIn ? 'built-in' : 'unknown',
      record,
      shadows: user && builtIn ? builtIn : undefined,
      used: exact.get(fx.name) ?? loose.get(norm(fx.name)) ?? 0,
      creator: creatorOf(fx, record),
    };
  });
}

/** Records for plugins that aren't installed here (kept, but listed apart). */
export function notInstalled(feed: KnowledgeFeed): PluginRecord[] {
  return feed.records.filter((r) => !feed.installed.some((fx) => matches(r, fx)) && !(r.layer === 'built-in' && feed.records.some((u) => u.layer === 'user' && u.key.endsWith(r.key))));
}

const LOREKIT_SCOPE = 'project::reaper-mcp';

/** Deep link into the LoreKit app with the record open in its scope; none without a row id. */
export function lorekitUrl(record: PluginRecord): string | undefined {
  if (!record.id) return undefined;
  const q = new URLSearchParams({ scope: JSON.stringify(LOREKIT_SCOPE), memoryId: record.id });
  return `https://www.lorekit.io/lore?${q}`;
}

export interface CreatorGroup {
  creator: string;
  rows: PluginRow[];
  used: number;
}

/** Rows by creator: creators with plugins in the open project first, then A–Z, "Other" last. */
export function groupByCreator(rows: PluginRow[]): CreatorGroup[] {
  const groups = new Map<string, CreatorGroup>();
  for (const r of rows) {
    const key = r.creator.toLowerCase();
    const g = groups.get(key) ?? { creator: r.creator, rows: [], used: 0 };
    g.rows.push(r);
    if (r.used > 0) g.used += 1;
    groups.set(key, g);
  }
  const rank = (g: CreatorGroup) => (g.creator === 'Other' ? 1 : 0);
  return [...groups.values()].sort((a, b) => Number(b.used > 0) - Number(a.used > 0) || rank(a) - rank(b) || a.creator.localeCompare(b.creator));
}
