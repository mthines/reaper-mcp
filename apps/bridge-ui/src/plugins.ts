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
  /** First lines of the record body */
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
}

const norm = (s: string) => s.toLowerCase().replace(/^(vst3?i?|au|clap|js):\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/[\s_-]+/g, '');

export function fxLabel(name: string): string {
  return name.replace(/^(VST3?i?|AU|CLAP|JS):\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '');
}

function matches(record: PluginRecord, fx: InstalledFx): boolean {
  const target = norm(fx.name);
  return record.matches.some((m) => norm(m) === target);
}

/** Pair every installed FX with the record the mix skills would use for it. */
export function pluginCoverage(feed: KnowledgeFeed): PluginRow[] {
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
