#!/usr/bin/env node
// Generate the ReaPack index (index.xml) for the files `reaper-mcp setup` installs into REAPER.
//
//   node scripts/reapack-index.mjs --version 0.78.0 --out index.xml            # release: GitHub URLs at the tag
//   node scripts/reapack-index.mjs --local --out /tmp/rp/index.xml              # test: file:// URLs into this clone
//
// Packages: the bridge (script + libs + snapshot actions), the JSFX meters, and the status page.
// The file list comes from REAPER_ASSETS-style discovery of reaper/, so a new lib is picked up
// without editing this script.

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = 'mthines/reaper-mcp';
const INDEX_NAME = 'reaper-mcp';
const MAIN_SCRIPTS = new Set(['mcp_bridge.lua', 'mcp_snapshot_next.lua', 'mcp_snapshot_prev.lua', 'mcp_snapshot_quick_save.lua']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The files in reaper/ that belong in REAPER, split by kind. */
export function listAssets(dir = join(root, 'reaper')) {
  const files = readdirSync(dir).sort();
  return {
    scripts: files.filter((f) => f.endsWith('.lua')),
    effects: files.filter((f) => f.endsWith('.jsfx')),
    includes: files.filter((f) => f.endsWith('.jsfx-inc')),
  };
}

/**
 * @param {{version: string, urlFor: (kind: 'reaper'|'ui', file: string) => string, time?: string, uiAvailable?: boolean, assets?: ReturnType<typeof listAssets>}} o
 */
export function buildIndex({ version, urlFor, time = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), uiAvailable = true, assets = listAssets() }) {
  const ver = (body) =>
    `      <version name="${esc(version)}" author="mthines" time="${time}">\n${body}\n      </version>`;
  const src = (file, url, attrs = '') => `        <source file="${esc(file)}"${attrs}>${esc(url)}</source>`;
  const changelog = `        <changelog><![CDATA[https://github.com/${REPO}/releases/tag/v${version}]]></changelog>`;

  const bridgeSources = assets.scripts.map((f) =>
    src(f, urlFor('reaper', f), MAIN_SCRIPTS.has(f) ? ' main="main"' : ' main="nomain"'),
  );
  const effectSources = [...assets.effects, ...assets.includes].map((f) => src(f, urlFor('reaper', f), ' type="effect"'));

  const pkgs = [];
  pkgs.push(`    <category name="MCP Bridge">
      <reapack name="mcp_bridge.lua" type="script" desc="REAPER MCP bridge">
        <metadata>
          <description><![CDATA[The Lua bridge that lets an MCP server (Claude Code and others) control REAPER. Install the server with: npm i -g @mthines/reaper-mcp && reaper-mcp init]]></description>
          <link rel="website">https://github.com/${REPO}</link>
        </metadata>
${ver(`${bridgeSources.join('\n')}\n${changelog}`)}
      </reapack>
    </category>`);
  pkgs.push(`    <category name="Meters">
      <reapack name="reaper-mcp meters.jsfx" type="effect" desc="Analyzer and meters the MCP tools insert">
${ver(effectSources.join('\n'))}
      </reapack>
    </category>`);
  if (uiAvailable) {
    pkgs.push(`    <category name="Web Interfaces">
      <reapack name="reaper-mcp bridge status.www" type="webinterface" desc="Bridge status page">
${ver(src('mcp_bridge.html', urlFor('ui', 'mcp_bridge.html')))}
      </reapack>
    </category>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<index version="1" name="${INDEX_NAME}">\n${pkgs.join('\n')}\n</index>\n`;
}

function main() {
  const args = process.argv.slice(2);
  const get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const local = args.includes('--local');
  const out = get('--out') ?? join(root, 'index.xml');
  const version = get('--version') ?? '0.0.0-local';
  const uiPath = get('--ui') ?? join(root, 'dist', 'apps', 'bridge-ui', 'mcp_bridge.html');
  const tag = `v${version}`;
  const urlFor = local
    ? (kind, file) => pathToFileURL(kind === 'ui' ? uiPath : join(root, 'reaper', file)).href
    : (kind, file) =>
        kind === 'ui'
          ? `https://github.com/${REPO}/releases/download/${tag}/${file}`
          : `https://raw.githubusercontent.com/${REPO}/${tag}/reaper/${file}`;
  const uiAvailable = !local || existsSync(uiPath);
  writeFileSync(out, buildIndex({ version, urlFor, uiAvailable }));
  console.log(`wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
