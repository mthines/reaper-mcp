import { TOOL_CATEGORIES } from './tools/categories.js';

/**
 * Tool profiles: a smaller tool surface for clients that cap the number of tools (some allow ~128) or models that
 * choose badly among ~190. `REAPER_MCP_PROFILE` takes one profile name, or a comma-separated list of profile and
 * category names (`mixing,knowledge`, an extension's name such as `composition` too). Unset or `full` registers everything.
 *
 * A profile is a set of tool categories (`tools/categories.ts`), so it can never drift from them: the bridge-coverage
 * test already fails on a tool that is in no category.
 */
export const PROFILES: Record<string, string[]> = {
  /** Smoke test and basic control. */
  minimal: ['project', 'tracks', 'fx', 'transport', 'discovery', 'selection'],
  /** Mixing and mastering: measure, set levels and FX, route, automate, snapshot, render. */
  mixing: ['project', 'tracks', 'fx', 'fx_files', 'transport', 'discovery', 'selection', 'routing', 'plan', 'analysis', 'snapshots', 'envelopes', 'actions', 'knowledge', 'recording'],
  /** Writing and editing music and arrangements (no takes or actions). Adding categories or an extension, e.g. `mixing,composition`, can push a profile past 128. */
  music: ['project', 'tracks', 'fx', 'transport', 'discovery', 'selection', 'midi', 'media', 'arrange', 'markers', 'tempo', 'envelopes', 'plan'],
  /** Inspect and measure; the tracks and project categories still hold a few writers, so this is not read-only. */
  analysis: ['project', 'tracks', 'transport', 'discovery', 'selection', 'routing', 'markers', 'tempo', 'analysis', 'knowledge'],
};

export interface Profile {
  /** The setting as given, or `full`. */
  name: string;
  /** Selected categories; null = everything. */
  categories: Set<string> | null;
  /** Names that are no profile and no core category: taken to be extensions, checked once those have loaded. */
  extensions: string[];
}

/** Which categories the setting selects. */
export function resolveProfile(value: string | undefined = process.env['REAPER_MCP_PROFILE']): Profile {
  const parts = (value ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.includes('full')) return { name: 'full', categories: null, extensions: [] };
  const categories = new Set<string>();
  const extensions: string[] = [];
  for (const part of parts) {
    const profile = PROFILES[part];
    if (profile) profile.forEach((c) => categories.add(c));
    else {
      categories.add(part);
      if (!(part in TOOL_CATEGORIES)) extensions.push(part);
    }
  }
  return { name: parts.join(','), categories, extensions };
}

/** Core tool names a profile leaves out. A tool in no core category (an extension's, or the category tools themselves) is never blocked. */
export function blockedTools(categories: Set<string> | null): Set<string> {
  if (!categories) return new Set();
  const all = new Set<string>();
  const kept = new Set<string>();
  for (const cat of Object.values(TOOL_CATEGORIES)) {
    for (const t of cat.tools) {
      all.add(t);
      if (categories.has(cat.name)) kept.add(t);
    }
  }
  return new Set([...all].filter((t) => !kept.has(t)));
}
