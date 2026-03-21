import type { KnowledgeFile } from './knowledge-loader.js';

export interface ResolvedPlugin {
  knowledge: KnowledgeFile;
  installedName: string; // actual name in REAPER's FX list
  preference: number;
}

/**
 * Resolves installed FX names against plugin knowledge files.
 *
 * Matching is done by checking whether any string in the knowledge file's
 * `fx_match` array appears as a case-insensitive substring of any installed
 * FX name.
 */
export class PluginResolver {
  private readonly installedFx: string[];
  private readonly pluginKnowledge: KnowledgeFile[];

  constructor(installedFx: string[], pluginKnowledge: KnowledgeFile[]) {
    this.installedFx = installedFx;
    this.pluginKnowledge = pluginKnowledge;
  }

  /**
   * Find the first installed FX name that contains the given pattern
   * (case-insensitive substring match).
   * Returns the installed FX name, or null if not found.
   */
  isInstalled(fxMatchPattern: string): string | null {
    const lower = fxMatchPattern.toLowerCase();
    return (
      this.installedFx.find((name) => name.toLowerCase().includes(lower)) ?? null
    );
  }

  /**
   * Find the knowledge file that best matches a given installed FX name.
   * Uses the same fx_match substring logic in reverse.
   */
  getKnowledgeFor(installedName: string): KnowledgeFile | null {
    const lower = installedName.toLowerCase();

    for (const kf of this.pluginKnowledge) {
      const patterns = this.getFxMatchPatterns(kf);
      if (patterns.some((p) => lower.includes(p.toLowerCase()))) {
        return kf;
      }
    }

    return null;
  }

  /**
   * Resolve the best available plugin for a given category (and optional style).
   * Returns null if no matching installed plugin is found.
   */
  resolve(category: string, style?: string): ResolvedPlugin | null {
    const all = this.resolveAll(category);
    if (all.length === 0) return null;

    if (style) {
      const styleMatches = all.filter(
        (r) => r.knowledge.frontmatter['style'] === style,
      );
      const best = styleMatches[0];
      if (best !== undefined) return best;
    }

    return all[0] ?? null;
  }

  /**
   * Resolve all available plugins for a given category, sorted by preference
   * descending. Returns an empty array if nothing matches.
   */
  resolveAll(category: string): ResolvedPlugin[] {
    const resolved: ResolvedPlugin[] = [];

    for (const kf of this.pluginKnowledge) {
      if (kf.frontmatter['category'] !== category) continue;

      const patterns = this.getFxMatchPatterns(kf);
      for (const pattern of patterns) {
        const installedName = this.isInstalled(pattern);
        if (installedName) {
          resolved.push({
            knowledge: kf,
            installedName,
            preference: this.getPreference(kf),
          });
          break; // only add once per knowledge file
        }
      }
    }

    return resolved.sort((a, b) => b.preference - a.preference);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getFxMatchPatterns(kf: KnowledgeFile): string[] {
    const raw = kf.frontmatter['fx_match'];
    if (Array.isArray(raw)) {
      return raw.map(String);
    }
    if (typeof raw === 'string' && raw.length > 0) {
      return [raw];
    }
    return [];
  }

  private getPreference(kf: KnowledgeFile): number {
    const pref = kf.frontmatter['preference'];
    if (typeof pref === 'number') return pref;
    const parsed = Number(pref);
    return isNaN(parsed) ? 0 : parsed;
  }
}
