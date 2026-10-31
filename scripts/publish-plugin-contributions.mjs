#!/usr/bin/env node
// Check, and with --publish write, contributed plugin records into LoreKit's built-in layer
// (the `reaper-mcp` org). Run by .github/workflows/plugin-contributions.yml; the files are
// downloaded from the PR as data and only ever parsed here.
//
//   node scripts/publish-plugin-contributions.mjs <file>... [--publish] [--summary out.md]
//
// Without --publish it only checks the files and says, per record, whether it is new or replaces a
// built-in record (read with the public read-only token). --publish needs LOREKIT_PUBLISH_TOKEN, an
// lk_rw_ token of a write-capable member of the reaper-mcp org.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContribution } from '../apps/bridge-ui/src/features/plugins/plugin-contributions.mjs';

const SCOPE = 'project::reaper-mcp';
const ORG = 'reaper-mcp';

const here = dirname(fileURLToPath(import.meta.url));
const knowledgeSrc = readFileSync(join(here, '../apps/reaper-mcp-server/src/tools/knowledge.ts'), 'utf-8');
const READ_TOKEN = knowledgeSrc.match(/BUILTIN_LOREKIT_TOKEN = '(lk_ro_[A-Za-z0-9]+)'/)?.[1];
const MCP_URL = process.env.LOREKIT_MCP_URL || knowledgeSrc.match(/LOREKIT_DEFAULT_URL = '(https:\/\/[^']+)'/)?.[1];
if (!READ_TOKEN || !MCP_URL) throw new Error('Could not read the LoreKit token/URL from tools/knowledge.ts');
const API = MCP_URL.replace(/\/mcp$/, '');

const args = process.argv.slice(2);
const publish = args.includes('--publish');
const summaryAt = args.indexOf('--summary');
const summaryFile = summaryAt >= 0 ? args[summaryAt + 1] : undefined;
const files = args.filter((a, i) => !a.startsWith('--') && (summaryAt < 0 || i !== summaryAt + 1));

const lines = [];
const say = (l = '') => lines.push(l);

async function existing(key) {
  const q = new URLSearchParams({ scope: SCOPE, key_prefix: key, tags: 'layer::built-in', limit: '10' });
  const res = await fetch(`${API}/memories?${q}`, { headers: { Authorization: `Bearer ${READ_TOKEN}`, 'X-LoreKit-Client': 'api' } });
  if (!res.ok) throw new Error(`LoreKit answered ${res.status} reading ${key}`);
  const body = await res.json();
  return (body.entries ?? []).find((e) => e.key === key);
}

async function write(record, token) {
  const pr = Number(process.env.PR_NUMBER) || undefined;
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'memory.write',
        arguments: {
          scope: SCOPE,
          org: ORG,
          key: record.key,
          value: record.value,
          tags: record.tags,
          trigger: 'pr-webhook',
          source_agent: 'plugin-contributions',
          ...(process.env.GITHUB_REPOSITORY ? { origin_repo: process.env.GITHUB_REPOSITORY } : {}),
          ...(pr ? { origin_pr: pr } : {}),
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`LoreKit HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? 'LoreKit error');
  if (body.result?.isError) throw new Error(body.result.content?.[0]?.text ?? 'LoreKit refused the write');
}

let failed = false;
const all = [];
for (const file of files) {
  const { records, errors } = parseContribution(readFileSync(file, 'utf-8'));
  const name = process.env.CONTRIBUTION_ROOT ? file.replace(process.env.CONTRIBUTION_ROOT, '') : file;
  if (errors.length) {
    failed = true;
    say(`**\`${name}\`** can't be published:`);
    for (const e of errors) say(`- ${e}`);
    say();
  } else {
    all.push(...records);
  }
}
const keys = all.map((r) => r.key);
for (const k of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) {
  failed = true;
  say(`- \`${k}\` is in more than one file.`);
}
if (!files.length) {
  failed = true;
  say('No contribution files in this PR.');
}

if (!failed) {
  const token = process.env.LOREKIT_PUBLISH_TOKEN;
  if (publish && !token?.startsWith('lk_rw_')) throw new Error('--publish needs LOREKIT_PUBLISH_TOKEN (an lk_rw_ token)');
  say(publish ? `Published ${all.length} record${all.length === 1 ? '' : 's'} to the built-in layer:` : `${all.length} record${all.length === 1 ? '' : 's'} ready to publish:`);
  say();
  say('| Record | Built-in today |');
  say('| --- | --- |');
  for (const r of all) {
    const prior = await existing(r.key);
    const status = prior ? `replaces the record from ${String(prior.updated_at ?? '').slice(0, 10) || 'earlier'}` : 'new';
    if (publish) {
      try {
        await write(r, token);
      } catch (err) {
        failed = true;
        say(`| \`${r.key}\` | **failed:** ${String(err.message ?? err).replace(/\|/g, '\\|').slice(0, 200)} |`);
        continue;
      }
    }
    say(`| \`${r.key}\` | ${status} |`);
  }
}

const out = lines.join('\n') + '\n';
process.stdout.write(out);
if (summaryFile) appendFileSync(summaryFile, out);
process.exit(failed ? 1 : 0);
