#!/usr/bin/env node
// Rewrite the built-in plugin list in docs/PLUGINS.md from LoreKit's built-in layer, read with the
// public read-only token. Run after publishing records: by the maintainer (/learn-plugin,
// /mix-memory publish) and by the plugin-contributions workflow, which commits the result to main.
//
//   node scripts/plugin-list.mjs           rewrite docs/PLUGINS.md, say whether it changed
//   node scripts/plugin-list.mjs --check   exit 1 when docs/PLUGINS.md is out of date

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updatePluginList } from '../apps/bridge-ui/src/plugin-list.mjs';

const SCOPE = 'project::reaper-mcp';

const here = dirname(fileURLToPath(import.meta.url));
const DOC = join(here, '../docs/PLUGINS.md');
const knowledgeSrc = readFileSync(join(here, '../apps/reaper-mcp-server/src/tools/knowledge.ts'), 'utf-8');
const READ_TOKEN = knowledgeSrc.match(/BUILTIN_LOREKIT_TOKEN = '(lk_ro_[A-Za-z0-9]+)'/)?.[1];
const MCP_URL = process.env.LOREKIT_MCP_URL || knowledgeSrc.match(/LOREKIT_DEFAULT_URL = '(https:\/\/[^']+)'/)?.[1];
if (!READ_TOKEN || !MCP_URL) throw new Error('Could not read the LoreKit token/URL from tools/knowledge.ts');
const API = MCP_URL.replace(/\/mcp$/, '');

async function builtInRecords() {
  const records = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ scope: SCOPE, key_prefix: 'plugins::', tags: 'plugin-knowledge,layer::built-in', tags_mode: 'all', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const res = await fetch(`${API}/memories?${q}`, { headers: { Authorization: `Bearer ${READ_TOKEN}`, 'X-LoreKit-Client': 'api' } });
    if (!res.ok) throw new Error(`LoreKit answered ${res.status}`);
    const body = await res.json();
    records.push(...(body.entries ?? []));
    if (!body.hasMore || !body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return records;
}

const before = readFileSync(DOC, 'utf-8');
const after = updatePluginList(before, await builtInRecords());
if (process.argv.includes('--check')) {
  if (after !== before) {
    console.error('docs/PLUGINS.md is out of date: run node scripts/plugin-list.mjs');
    process.exit(1);
  }
  console.log('docs/PLUGINS.md is up to date');
} else if (after === before) {
  console.log('docs/PLUGINS.md is up to date');
} else {
  writeFileSync(DOC, after);
  console.log('Updated docs/PLUGINS.md');
}
