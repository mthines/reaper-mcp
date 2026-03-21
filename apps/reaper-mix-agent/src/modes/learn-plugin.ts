import type { AgentContext } from '../agent.js';

export const MODE_NAME = 'learn-plugin';
export const MODE_DESCRIPTION =
  'Discover an unknown plugin by reading parameters, researching, and creating a knowledge file';

export function getModeInstructions(context: AgentContext): string {
  const unresolvedNote =
    context.unresolvedFx.length > 0
      ? `\n### Plugins without knowledge files\n${context.unresolvedFx.map((name) => `- \`${name}\``).join('\n')}\n\nPick one from this list, or specify a track/FX index to learn a specific plugin.`
      : '\nAll installed plugins already have knowledge files. You can still run this workflow on a specific FX by track/FX index.';

  return `## Workflow Mode: Learn Plugin

Discover an unknown plugin, understand its parameters, and create a knowledge file so future sessions can use it effectively.
${unresolvedNote}

### Step 1: Identify the target plugin

If the user specified a plugin name, find it on a track. Otherwise, pick from the unresolved list above.

\`\`\`
tool: list_tracks          # Find which track has the plugin
tool: get_track_properties # See the FX chain
  params: { trackIndex: N }
\`\`\`

### Step 2: Read all parameters

\`\`\`
tool: get_fx_parameters
  params: { trackIndex: N, fxIndex: M }
\`\`\`

Analyze the parameter names to determine the plugin's category:
- **Frequency, Q, Gain, Slope** → EQ
- **Threshold, Ratio, Attack, Release, Knee** → Compressor
- **Ceiling, Lookahead, True Peak** → Limiter
- **Pre-delay, Decay, Room Size, Damping** → Reverb
- **Time, Feedback, Sync, Ping-pong** → Delay
- **Drive, Saturation, Harmonics** → Saturator
- **Range, Hold, Hysteresis** → Gate
- **Width, Mid/Side, Rotation** → Stereo imager

Record every parameter with its name, current value, min, and max.

### Step 3: Check presets

\`\`\`
tool: get_fx_preset_list
  params: { trackIndex: N, fxIndex: M }
\`\`\`

Preset names reveal intended use cases and plugin character.

### Step 4: Web research (if category or usage is still unclear)

Search for: \`"{plugin name}" audio plugin guide\`

Look for the official product page, manual, reviews, and recommended settings from professionals.

### Step 5: Write the knowledge file

Create \`knowledge/plugins/{vendor-slug}/{plugin-slug}.md\` with:
- Complete YAML frontmatter (name, fx_match, category, vendor, preference, style)
- "What it does" section describing character and use cases
- Full parameter table with exact names from Step 2
- At least one recommended settings table with specific values and reasoning
- Presets worth knowing (from Step 3)
- "When to prefer this" section

### Step 6: Report to the user

Summarize what you learned:
- Plugin name, vendor, and category
- Key capabilities and character
- Where the knowledge file was saved
- Recommended use cases
`;
}
