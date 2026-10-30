// Bundles the React app and inlines JS + CSS into one self-contained HTML file
// (REAPER's web server serves single files from reaper_www_root/).
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOptions, here, renderHtml } from './build-config.mjs';

const outDir = join(here, '../../dist/apps/bridge-ui');
const result = await build(buildOptions());
const html = renderHtml(result.outputFiles);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'mcp_bridge.html'), html);
// PWA files (manifest, service worker, icons) sit next to the page in reaper_www_root/
cpSync(join(here, 'public'), outDir, { recursive: true });
console.log(`bridge-ui: wrote mcp_bridge.html (${(html.length / 1024).toFixed(1)} KB)`);
