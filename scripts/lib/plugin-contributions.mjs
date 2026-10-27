// Contributed plugin records: the file format the bridge page writes into a PR under
// knowledge/contributions/, and the checks the publish workflow runs before it writes a record
// into LoreKit's built-in layer. The file is data only — nothing in it is ever executed.
//
// A file holds one or more records, each a header comment followed by the record's Markdown:
//
//   <!-- lorekit-record
//   key: plugins::fabfilter/pro-q-3
//   tags: ["plugin-knowledge","category::eq","fx::VST3: Pro-Q3 (FabFilter)"]
//   -->
//   # FabFilter Pro-Q 3
//   ...

export const CONTRIBUTIONS_DIR = 'knowledge/contributions/';
export const MAX_VALUE_CHARS = 20000;
export const MAX_RECORDS = 50;

const HEADER = '<!-- lorekit-record';
const KEY = /^plugins::[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
// Tags a plugin record may carry; `layer::` is set by the publisher, never by the contributor
const TAG = /^(plugin-knowledge|(plugin|category|vendor|preference|style|fx|replaces)::.+)$/;

/** Turn `user::` records into the text of one contribution file. */
export function formatContribution(records) {
  const intro =
    '<!-- reaper-mcp plugin contribution. Each record below becomes a built-in LoreKit record once the maintainer publishes it. -->\n';
  return (
    intro +
    records
      .map((r) => {
        const key = r.key.replace(/^user::/, '');
        const tags = r.tags.filter((t) => !t.startsWith('layer::'));
        return `\n${HEADER}\nkey: ${key}\ntags: ${JSON.stringify(tags)}\n-->\n${r.value.trim()}\n`;
      })
      .join('')
  );
}

/** Parse and check one contribution file: `{ records, errors }`; any error rejects the file. */
export function parseContribution(text) {
  const errors = [];
  const records = [];
  const parts = `\n${text.replace(/\r\n?/g, '\n')}`.split(`\n${HEADER}\n`);
  if (parts.length < 2) return { records, errors: ['No records found (each starts with a "<!-- lorekit-record" header).'] };
  if (parts.length - 1 > MAX_RECORDS) errors.push(`At most ${MAX_RECORDS} records per file.`);

  parts.slice(1).forEach((part, i) => {
    const n = i + 1;
    const end = part.indexOf('\n-->\n');
    if (end < 0) {
      errors.push(`Record ${n}: header is not closed with "-->".`);
      return;
    }
    const head = Object.fromEntries(
      part
        .slice(0, end)
        .split('\n')
        .map((l) => l.match(/^(\w+):\s*(.*)$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].trim()]),
    );
    const value = part.slice(end + 5).trim();
    const key = head.key ?? '';
    const label = key || `Record ${n}`;

    if (!KEY.test(key)) errors.push(`${label}: key must look like plugins::<vendor>/<plugin> (lowercase, no user:: prefix).`);
    let tags = [];
    try {
      tags = JSON.parse(head.tags ?? '');
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) throw new Error();
    } catch {
      errors.push(`${label}: tags must be a JSON array of strings.`);
      tags = [];
    }
    tags = tags.filter((t) => !t.startsWith('layer::'));
    if (!tags.includes('plugin-knowledge')) errors.push(`${label}: tags must include "plugin-knowledge".`);
    for (const t of tags) {
      if (!TAG.test(t) || t.length > 200) errors.push(`${label}: tag ${JSON.stringify(t.slice(0, 80))} is not allowed.`);
    }
    if (!/^#\s+\S/.test(value)) errors.push(`${label}: the record must start with a "# Plugin name" title.`);
    if (value.length > MAX_VALUE_CHARS) errors.push(`${label}: the record is over ${MAX_VALUE_CHARS} characters.`);
    if (value.includes(HEADER)) errors.push(`${label}: the record contains a record header.`);
    if (records.some((r) => r.key === key)) errors.push(`${label}: the key appears twice.`);

    records.push({ key, tags: [...new Set([...tags, 'layer::built-in'])], value });
  });
  return { records, errors };
}
