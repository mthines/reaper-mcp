#!/usr/bin/env node
// Generate the ReaPack index (index.xml) for the files `reaper-mcp setup` installs into REAPER.
//
//   node scripts/reapack-index.mjs --version 0.78.0 --out index.xml            # release: GitHub URLs at the tag
//   node scripts/reapack-index.mjs --local --out /tmp/rp/index.xml              # test: file:// URLs into this clone
//
// The index itself is built by apps/reaper-mcp-server/src/reapack-index.mjs.

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, buildIndex, listAssets } from '../apps/reaper-mcp-server/src/reapack-index.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const local = args.includes('--local');
const out = get('--out') ?? join(root, 'index.xml');
const version = get('--version') ?? '0.0.0-local';
const uiPath = get('--ui') ?? join(root, 'dist', 'apps', 'bridge-ui', 'mcp_bridge.html');
const tag = `v${version}`;
const urlFor = local
  ? (kind, file) => pathToFileURL(kind === 'ui' ? join(dirname(uiPath), file) : join(root, 'reaper', file)).href
  : (kind, file) =>
      kind === 'ui'
        ? `https://github.com/${REPO}/releases/download/${tag}/${file}`
        : `https://raw.githubusercontent.com/${REPO}/${tag}/reaper/${file}`;
// The page and its PWA files (manifest, service worker, icons): all mcp_bridge*, as setup copies them
const uiFiles = existsSync(uiPath) ? readdirSync(dirname(uiPath)).filter((f) => f.startsWith('mcp_bridge')).sort() : [];
writeFileSync(out, buildIndex({ version, urlFor, uiFiles, assets: listAssets(join(root, 'reaper')) }));
console.log(`wrote ${out}`);
