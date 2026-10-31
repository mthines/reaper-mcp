import type { PluginRow } from './plugins.js';

/** Prompt for one plugin: the exact FX name so the agent loads the right one on its scratch track. */
export const learnPrompt = (row: PluginRow) => `/learn-plugin ${row.fx.name}`;

/** One prompt for several: /learn-plugin handles one plugin per run, so ask for them in turn. */
export const learnAllPrompt = (rows: PluginRow[]) =>
  rows.length === 1
    ? learnPrompt(rows[0])
    : `Run /learn-plugin for each of these installed plugins, one at a time:\n${rows.map((r) => `- ${r.fx.name}`).join('\n')}`;
