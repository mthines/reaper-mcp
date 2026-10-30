// The built-in plugin list in docs/PLUGINS.md: one table row per built-in plugin record, between
// two markers, so the page around it stays hand-written. Rewritten by scripts/plugin-list.mjs from
// LoreKit's built-in layer (after every publish, by the maintainer and by the plugin-contributions
// workflow); plain JS so the script runs without a build.

export const LIST_START = '<!-- plugin-list:start -->';
export const LIST_END = '<!-- plugin-list:end -->';

const tagValue = (tags, name) => tags.find((t) => t.startsWith(`${name}::`))?.slice(name.length + 2);

/** One row of the list from a built-in record ({ key, tags, value }); null for anything that isn't one. */
export function pluginRow(record) {
  const tags = record.tags ?? [];
  if (!record.key.startsWith('plugins::') || !tags.includes('plugin-knowledge')) return null;
  const value = record.value ?? '';
  const preference = Number(tagValue(tags, 'preference'));
  return {
    key: record.key,
    // "Clear (Supertone / Antinode Audio)": the vendor has its own column, asides go
    name: (value.match(/^#\s+(.+)$/m)?.[1] ?? record.key.split('/').pop()).replace(/\s*\([^)]*\)\s*$/, '').trim(),
    // "Supertone (now sold as …)": the vendor's name, not the aside
    vendor: (value.match(/\*\*Vendor:\*\*\s*([^·\n(]+)/)?.[1] ?? tagValue(tags, 'vendor') ?? '').trim(),
    categories: tags.filter((t) => t.startsWith('category::')).map((t) => t.slice('category::'.length)),
    preference: Number.isFinite(preference) ? preference : undefined,
  };
}

/** A table cell: no pipes or line breaks */
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The Markdown table: by first category, then the most preferred first, then by name. */
export function renderPluginTable(records) {
  const rows = records.map(pluginRow).filter(Boolean);
  const category = (r) => r.categories[0] ?? 'other';
  rows.sort((a, b) => category(a).localeCompare(category(b)) || (b.preference ?? 0) - (a.preference ?? 0) || a.name.localeCompare(b.name));
  const lines = [
    `${rows.length} plugins.`,
    '',
    '| Category | Plugin | Vendor | Preference |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${cell(r.categories.join(', ') || 'other')} | ${cell(r.name)} | ${cell(r.vendor)} | ${r.preference ?? '–'} |`),
  ];
  return lines.join('\n');
}

/** docs/PLUGINS.md with the table between the markers replaced; throws when the markers are missing. */
export function updatePluginList(doc, records) {
  const start = doc.indexOf(LIST_START);
  const end = doc.indexOf(LIST_END);
  if (start < 0 || end < start) throw new Error(`docs/PLUGINS.md needs ${LIST_START} … ${LIST_END}`);
  return `${doc.slice(0, start + LIST_START.length)}\n${renderPluginTable(records)}\n${doc.slice(end)}`;
}
