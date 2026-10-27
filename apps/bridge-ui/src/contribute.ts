import { formatContribution } from './plugin-contributions.mjs';
import type { PluginRecord } from './plugins.js';

// "Contribute": the viewer's own records become a PR adding one file under knowledge/contributions/,
// opened through GitHub's "new file" page (GitHub forks and opens the PR, no token needed here).
// The plugin-contributions workflow checks it; the maintainer's label publishes it to LoreKit.

export const CONTRIBUTE_REPO = 'https://github.com/mthines/reaper-mcp';
// GitHub refuses very long URLs; above this the file holds PASTE_HERE and the records are on the clipboard
const MAX_URL = 8000;
export const PASTE_HERE =
  'Paste your clipboard here (⌘V / Ctrl+V), replacing this text.\n\nThe MCP Bridge copied your plugin records when you pressed Contribute. If the clipboard is empty, press Contribute again.\n';

export function contributable(records: PluginRecord[]): PluginRecord[] {
  return records.filter((r) => r.layer === 'user' && r.source);
}

export function contributionFileName(records: PluginRecord[], date = new Date(), suffix = Math.random().toString(36).slice(2, 6)): string {
  const day = date.toISOString().slice(0, 10);
  const slug = records.length === 1 ? records[0].key.split('/').pop() : `${records.length}-plugins`;
  return `knowledge/contributions/${day}-${slug}-${suffix}.md`;
}

/** The GitHub URL that proposes the file, and the file's text (copied to the clipboard as well). */
export function contribution(records: PluginRecord[], fileName = contributionFileName(records)): { url: string; text: string; prefilled: boolean } {
  const text = formatContribution(records.flatMap((r) => (r.source ? [{ key: r.key, tags: r.source.tags, value: r.source.value }] : [])));
  const names = records.map((r) => r.name);
  const message = `Contribute plugin knowledge: ${names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')}`;
  const url = (value: string) => `${CONTRIBUTE_REPO}/new/main?${new URLSearchParams({ filename: fileName, message, value })}`;
  const full = url(text);
  return full.length <= MAX_URL ? { url: full, text, prefilled: true } : { url: url(PASTE_HERE), text, prefilled: false };
}
