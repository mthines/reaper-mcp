import { describe, it, expect } from 'vitest';
import { PluginResolver } from './plugin-resolver.js';
import type { KnowledgeFile } from './knowledge-loader.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makePlugin(
  name: string,
  fxMatch: string[],
  category: string,
  preference: number,
  style?: string,
): KnowledgeFile {
  return {
    path: `/knowledge/plugins/${name.toLowerCase().replace(/\s/g, '-')}.md`,
    type: 'plugin',
    frontmatter: {
      name,
      fx_match: fxMatch,
      category,
      preference,
      ...(style ? { style } : {}),
    },
    content: `# ${name}\n\nA plugin for testing.`,
  };
}

const PRO_Q_3 = makePlugin('FabFilter Pro-Q 3', ['Pro-Q 3', 'VST3: Pro-Q 3'], 'eq', 90, 'transparent');
const REA_EQ = makePlugin('ReaEQ', ['ReaEQ', 'ReaEQ (Cockos)'], 'eq', 40, 'transparent');
const PRO_C_2 = makePlugin('FabFilter Pro-C 2', ['Pro-C 2', 'VST3: Pro-C 2'], 'compressor', 88, 'transparent');
const REA_COMP = makePlugin('ReaComp', ['ReaComp', 'ReaComp (Cockos)'], 'compressor', 35);
const VINTAGE_COMP = makePlugin('Vintage Comp', ['VintageComp', 'Vintage-Comp'], 'compressor', 70, 'vintage');
const PRO_L_2 = makePlugin('FabFilter Pro-L 2', ['Pro-L 2', 'VST3: Pro-L 2'], 'limiter', 92);

const ALL_PLUGINS = [PRO_Q_3, REA_EQ, PRO_C_2, REA_COMP, VINTAGE_COMP, PRO_L_2];

// ---------------------------------------------------------------------------
// isInstalled
// ---------------------------------------------------------------------------

describe('PluginResolver.isInstalled', () => {
  it('finds a plugin by case-insensitive substring', () => {
    const resolver = new PluginResolver(
      ['VST3: Pro-Q 3 (FabFilter)', 'VST3: ReaEQ (Cockos)'],
      ALL_PLUGINS,
    );
    expect(resolver.isInstalled('Pro-Q 3')).toBe('VST3: Pro-Q 3 (FabFilter)');
    expect(resolver.isInstalled('pro-q 3')).toBe('VST3: Pro-Q 3 (FabFilter)');
    expect(resolver.isInstalled('PRO-Q 3')).toBe('VST3: Pro-Q 3 (FabFilter)');
  });

  it('returns null when pattern not found', () => {
    const resolver = new PluginResolver(['ReaEQ (Cockos)'], ALL_PLUGINS);
    expect(resolver.isInstalled('Pro-Q 3')).toBeNull();
  });

  it('returns null when installedFx is empty', () => {
    const resolver = new PluginResolver([], ALL_PLUGINS);
    expect(resolver.isInstalled('ReaEQ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getKnowledgeFor
// ---------------------------------------------------------------------------

describe('PluginResolver.getKnowledgeFor', () => {
  it('returns the knowledge file for an installed FX name', () => {
    const resolver = new PluginResolver(
      ['VST3: Pro-Q 3 (FabFilter)'],
      ALL_PLUGINS,
    );
    const kf = resolver.getKnowledgeFor('VST3: Pro-Q 3 (FabFilter)');
    expect(kf).not.toBeNull();
    expect(kf?.frontmatter['name']).toBe('FabFilter Pro-Q 3');
  });

  it('returns null when no knowledge matches', () => {
    const resolver = new PluginResolver(
      ['VST3: UnknownPlugin 1.0'],
      ALL_PLUGINS,
    );
    const kf = resolver.getKnowledgeFor('VST3: UnknownPlugin 1.0');
    expect(kf).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

describe('PluginResolver.resolve', () => {
  it('returns the highest-preference installed plugin for a category', () => {
    // Both Pro-Q 3 (preference 90) and ReaEQ (preference 40) are installed
    const resolver = new PluginResolver(
      ['VST3: Pro-Q 3 (FabFilter)', 'ReaEQ (Cockos)'],
      ALL_PLUGINS,
    );
    const result = resolver.resolve('eq');
    expect(result).not.toBeNull();
    expect(result?.knowledge.frontmatter['name']).toBe('FabFilter Pro-Q 3');
    expect(result?.preference).toBe(90);
  });

  it('falls back to lower-preference plugin when best is not installed', () => {
    // Only ReaEQ installed, not Pro-Q 3
    const resolver = new PluginResolver(['ReaEQ (Cockos)'], ALL_PLUGINS);
    const result = resolver.resolve('eq');
    expect(result).not.toBeNull();
    expect(result?.knowledge.frontmatter['name']).toBe('ReaEQ');
  });

  it('returns null when no plugins of the category are installed', () => {
    const resolver = new PluginResolver(['ReaEQ (Cockos)'], ALL_PLUGINS);
    const result = resolver.resolve('limiter');
    expect(result).toBeNull();
  });

  it('filters by style when specified', () => {
    // Both transparent and vintage compressors installed
    const resolver = new PluginResolver(
      ['VST3: Pro-C 2 (FabFilter)', 'VintageComp'],
      ALL_PLUGINS,
    );
    const result = resolver.resolve('compressor', 'vintage');
    expect(result).not.toBeNull();
    expect(result?.knowledge.frontmatter['name']).toBe('Vintage Comp');
  });

  it('falls back to best available when style not found', () => {
    // Only transparent compressor installed, requesting vintage
    const resolver = new PluginResolver(
      ['VST3: Pro-C 2 (FabFilter)'],
      ALL_PLUGINS,
    );
    const result = resolver.resolve('compressor', 'vintage');
    // Returns best available even though style doesn't match
    expect(result).not.toBeNull();
    expect(result?.knowledge.frontmatter['name']).toBe('FabFilter Pro-C 2');
  });
});

// ---------------------------------------------------------------------------
// resolveAll
// ---------------------------------------------------------------------------

describe('PluginResolver.resolveAll', () => {
  it('returns all installed plugins for a category sorted by preference', () => {
    const resolver = new PluginResolver(
      ['VST3: Pro-Q 3 (FabFilter)', 'ReaEQ (Cockos)'],
      ALL_PLUGINS,
    );
    const results = resolver.resolveAll('eq');
    expect(results.length).toBe(2);
    const first = results[0];
    const second = results[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.preference).toBeGreaterThanOrEqual(second?.preference ?? 0);
    expect(first?.knowledge.frontmatter['name']).toBe('FabFilter Pro-Q 3');
    expect(second?.knowledge.frontmatter['name']).toBe('ReaEQ');
  });

  it('returns empty array when nothing in the category is installed', () => {
    const resolver = new PluginResolver(['ReaEQ (Cockos)'], ALL_PLUGINS);
    const results = resolver.resolveAll('limiter');
    expect(results).toEqual([]);
  });

  it('does not include the same plugin twice', () => {
    // Two fx_match patterns could theoretically match the same installed FX twice
    const resolver = new PluginResolver(
      ['VST3: Pro-Q 3 (FabFilter)'],
      [PRO_Q_3],
    );
    const results = resolver.resolveAll('eq');
    expect(results.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive matching
// ---------------------------------------------------------------------------

describe('case-insensitive matching', () => {
  it('matches regardless of case in the installed FX name', () => {
    const resolver = new PluginResolver(['VST3: REAEQ (COCKOS)'], ALL_PLUGINS);
    const result = resolver.resolve('eq');
    expect(result).not.toBeNull();
    expect(result?.knowledge.frontmatter['name']).toBe('ReaEQ');
  });

  it('matches regardless of case in the fx_match pattern', () => {
    const resolver = new PluginResolver(['reaeq (cockos)'], ALL_PLUGINS);
    const result = resolver.resolve('eq');
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles empty installed FX list', () => {
    const resolver = new PluginResolver([], ALL_PLUGINS);
    expect(resolver.resolve('eq')).toBeNull();
    expect(resolver.resolveAll('eq')).toEqual([]);
  });

  it('handles empty plugin knowledge list', () => {
    const resolver = new PluginResolver(['VST3: Pro-Q 3 (FabFilter)'], []);
    expect(resolver.resolve('eq')).toBeNull();
    expect(resolver.getKnowledgeFor('VST3: Pro-Q 3 (FabFilter)')).toBeNull();
  });

  it('handles plugin with no fx_match field', () => {
    const noMatch = makePlugin('NoMatch Plugin', [], 'eq', 50);
    const resolver = new PluginResolver(['NoMatch Plugin'], [noMatch]);
    // Cannot match — no fx_match patterns provided
    expect(resolver.resolve('eq')).toBeNull();
  });
});
