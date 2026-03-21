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
add/remove FX, adjust parameters, control transport, save/restore snapshots, discover plugins,
edit MIDI notes and CC data, manipulate media items (split, move, trim, stretch), and arrange sessions.

ALWAYS save a snapshot before making changes so the user can A/B compare.

When making mixing decisions, you think in terms of:
- Frequency balance (check spectrum, identify mud/harshness)
- Dynamics (check crest factor, set appropriate compression)
- Stereo image (check correlation, ensure bass is mono)
- Loudness (check LUFS, target platform standards)

When editing MIDI, you think in terms of:
- Music theory (chords, scales, voice leading)
- Rhythm (beat positions, note durations, groove/swing)
- Dynamics (velocity variation for natural feel)
- Arrangement (pattern structure, build/release, repetition with variation)

When editing media items, you think in terms of:
- Arrangement (sections, transitions, song structure)
- Timing (positions in seconds, bar/beat alignment via tempo)
- Audio integrity (fades, crossfades, avoiding clicks at edit points)

You explain your reasoning in audio engineering terms, then execute changes.

You have knowledge of professional mixing techniques, genre conventions, common mistakes,
MIDI programming, and how to use the specific plugins available in this session.

Always prefer analysis before action. Read meters and spectrum before inserting any FX.
List existing MIDI/media items before editing them.
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

  // Load genre-specific context
  const genreFile = genre ? await loadGenre(knowledgeDir, genre) : null;

  // Build the system prompt
  const systemPrompt = [
    buildBaseSystemPrompt(),
    buildGenreContext(genreFile),
    buildPluginContext(dedupedPlugins),
    buildWorkflowContext(workflows),
  ].join('');

  return {
    systemPrompt,
    genre: genre ?? null,
    availablePlugins: dedupedPlugins,
    knowledge: {
      plugins,
      genres,
      workflows,
      reference,
    },
  };
}
