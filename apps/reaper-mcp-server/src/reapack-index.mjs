// Generate the ReaPack index (index.xml) for the files `reaper-mcp setup` installs into REAPER.
//
//   node scripts/reapack-index.mjs --version 0.78.0 --out index.xml            # release: GitHub URLs at the tag
//   node scripts/reapack-index.mjs --local --out /tmp/rp/index.xml              # test: file:// URLs into this clone
//
// Packages: the bridge (script + libs + snapshot actions), the JSFX meters, and the status page.
// The file list comes from REAPER_ASSETS-style discovery of reaper/, so a new lib is picked up
// without editing this script.

import { readdirSync } from 'node:fs';
export const REPO = 'mthines/reaper-mcp';
const INDEX_NAME = 'reaper-mcp';
const MAIN_SCRIPTS = new Set(['mcp_bridge.lua', 'mcp_snapshot_next.lua', 'mcp_snapshot_prev.lua', 'mcp_snapshot_quick_save.lua']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The files in reaper/ that belong in REAPER, split by kind. */
export function listAssets(dir) {
  const files = readdirSync(dir).sort();
  return {
    scripts: files.filter((f) => f.endsWith('.lua')),
    effects: files.filter((f) => f.endsWith('.jsfx')),
    includes: files.filter((f) => f.endsWith('.jsfx-inc')),
  };
}

/**
 * @param {{version: string, urlFor: (kind: 'reaper'|'ui', file: string) => string, time?: string, uiFiles?: string[], assets?: ReturnType<typeof listAssets>}} o
 */
export function buildIndex({ version, urlFor, time = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), uiFiles = ['mcp_bridge.html'], assets }) {
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
  if (uiFiles.length) {
    pkgs.push(`    <category name="Web Interfaces">
      <reapack name="reaper-mcp bridge status.www" type="webinterface" desc="Bridge status page">
${ver(uiFiles.map((f) => src(f, urlFor('ui', f))).join('\n'))}
      </reapack>
    </category>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<index version="1" name="${INDEX_NAME}">\n${pkgs.join('\n')}\n</index>\n`;
}
