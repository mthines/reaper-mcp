import {
  loadKnowledge,
  loadGenre,
  type KnowledgeFile,
} from './knowledge-loader.js';
import { PluginResolver, type ResolvedPlugin } from './plugin-resolver.js';

export interface AgentContext {
  systemPrompt: string;
  genre: string | null;
  availablePlugins: ResolvedPlugin[];
  unresolvedFx: string[];
  knowledge: {
    plugins: KnowledgeFile[];
    genres: KnowledgeFile[];
    workflows: KnowledgeFile[];
    reference: KnowledgeFile[];
  };
}

// ---------------------------------------------------------------------------
// System prompt builders
// ---------------------------------------------------------------------------

function buildBaseSystemPrompt(): string {
  return `You are a professional mix engineer with 20 years of experience working inside REAPER DAW.
You have access to MCP tools that let you control REAPER: read meters, analyze spectrum,
add/remove FX, adjust parameters, control transport, save/restore snapshots, and discover plugins.

ALWAYS save a snapshot before making changes so the user can A/B compare.

When making mixing decisions, you think in terms of:
- Frequency balance (check spectrum, identify mud/harshness)
- Dynamics (check crest factor, set appropriate compression)
- Stereo image (check correlation, ensure bass is mono)
- Loudness (check LUFS, target platform standards)

You explain your reasoning in audio engineering terms, then execute changes.

You have knowledge of professional mixing techniques, genre conventions, common mistakes,
and how to use the specific plugins available in this session.

Always prefer analysis before action. Read meters and spectrum before inserting any FX.
When in doubt, save a snapshot and make the change — the user can always A/B compare.`;
}

function buildGenreContext(genreFile: KnowledgeFile | null): string {
  if (!genreFile) return '';
  const name = genreFile.frontmatter['name'] ?? 'Unknown';
  return `\n\n## Genre Context: ${name}\n\n${genreFile.content}`;
}

function buildPluginContext(availablePlugins: ResolvedPlugin[]): string {
  if (availablePlugins.length === 0) {
    return '\n\n## Available Plugins\n\nNo third-party plugins detected. All processing will use stock REAPER plugins (ReaEQ, ReaComp, ReaLimit, ReaVerb, ReaDelay, ReaGate).';
  }

  const byCategory = new Map<string, ResolvedPlugin[]>();
  for (const p of availablePlugins) {
    const cat = String(p.knowledge.frontmatter['category'] ?? 'other');
    const list = byCategory.get(cat) ?? [];
    list.push(p);
    byCategory.set(cat, list);
  }

  const lines: string[] = ['\n\n## Available Plugins\n'];
  for (const [cat, plugins] of byCategory) {
    lines.push(`### ${cat}`);
    for (const p of plugins) {
      const name = p.knowledge.frontmatter['name'] ?? p.installedName;
      const pref = p.preference;
      lines.push(`- **${name}** (\`${p.installedName}\`) — preference: ${pref}/100`);
    }
  }

  lines.push(
    '\nAlways use the highest-preference available plugin for each category.',
  );

  return lines.join('\n');
}

function buildUnresolvedPluginContext(unresolvedFx: string[]): string {
  if (unresolvedFx.length === 0) return '';

  const list = unresolvedFx.map((name) => `- \`${name}\``).join('\n');
  return `\n\n## Unknown Plugins (no knowledge file)

The following installed plugins have no matching knowledge file. When you encounter one of these on a track and need to use it:

1. **Read its parameters** — use \`get_fx_parameters\` to see all parameter names, current values, and ranges. Parameter names often reveal what the plugin does (e.g., "Threshold", "Ratio" → compressor; "Frequency", "Q", "Gain" → EQ).
2. **Check presets** — use \`get_fx_preset_list\` to see factory presets. Preset names reveal intended use cases.
3. **If still unclear, research the plugin** — do a web search for the plugin name to learn its category, character, and recommended settings.
4. **Create a knowledge file** — once you understand the plugin, write a knowledge file to \`knowledge/plugins/{vendor-slug}/{plugin-slug}.md\` following the template format. This ensures future sessions can use the plugin effectively.

Run the **Learn Plugin** workflow for a guided step-by-step process.

${list}
`;
}

function buildWorkflowContext(workflows: KnowledgeFile[]): string {
  if (workflows.length === 0) return '';
  const names = workflows
    .map((w) => String(w.frontmatter['name'] ?? w.frontmatter['id'] ?? ''))
    .filter(Boolean);
  return `\n\n## Available Workflow Modes\n\nYou can execute these workflow modes when asked:\n${names.map((n) => `- ${n}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// Main factory function
// ---------------------------------------------------------------------------

export async function createAgentContext(options: {
  knowledgeDir: string;
  installedFx?: string[];
  genre?: string;
}): Promise<AgentContext> {
  const { knowledgeDir, installedFx = [], genre } = options;

  // Load all knowledge files
  const allKnowledge = await loadKnowledge(knowledgeDir);

  const plugins = allKnowledge.filter((f) => f.type === 'plugin');
  const genres = allKnowledge.filter((f) => f.type === 'genre');
  const workflows = allKnowledge.filter((f) => f.type === 'workflow');
  const reference = allKnowledge.filter((f) => f.type === 'reference');

  // Resolve available plugins from installed FX list
  const resolver = new PluginResolver(installedFx, plugins);
  // Gather all resolved plugins across all categories
  const allCategories = [
    ...new Set(
      plugins
        .map((p) => p.frontmatter['category'])
        .filter((c): c is string => typeof c === 'string'),
    ),
  ];
  const resolvedAll: ResolvedPlugin[] = [];
  for (const cat of allCategories) {
    const resolved = resolver.resolveAll(cat);
    resolvedAll.push(...resolved);
  }
  // Deduplicate by installedName
  const seen = new Set<string>();
  const dedupedPlugins: ResolvedPlugin[] = [];
  for (const p of resolvedAll) {
    if (!seen.has(p.installedName)) {
      seen.add(p.installedName);
      dedupedPlugins.push(p);
    }
  }

  // Identify installed FX without knowledge files
  const unresolvedFx = resolver.getUnresolved();

  // Load genre-specific context
  const genreFile = genre ? await loadGenre(knowledgeDir, genre) : null;

  // Build the system prompt
  const systemPrompt = [
    buildBaseSystemPrompt(),
    buildGenreContext(genreFile),
    buildPluginContext(dedupedPlugins),
    buildUnresolvedPluginContext(unresolvedFx),
    buildWorkflowContext(workflows),
  ].join('');

  return {
    systemPrompt,
    genre: genre ?? null,
    availablePlugins: dedupedPlugins,
    unresolvedFx,
    knowledge: {
      plugins,
      genres,
      workflows,
      reference,
    },
  };
}
