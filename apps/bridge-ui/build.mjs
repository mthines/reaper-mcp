// Bundles the React app and inlines JS + CSS into one self-contained HTML file
// (REAPER's web server serves single files from reaper_www_root/).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../dist/apps/bridge-ui');
const { version } = JSON.parse(readFileSync(join(here, '../reaper-mcp-server/package.json'), 'utf-8'));

// The public read-only LoreKit token + endpoint for the built-in plugin records, read from the server's
// knowledge tool so there's one source of truth. The page calls LoreKit's REST API (CORS-enabled);
// the server's /mcp endpoint is not reachable from a browser.
const knowledgeSrc = readFileSync(join(here, '../reaper-mcp-server/src/tools/knowledge.ts'), 'utf-8');
const lorekitToken = knowledgeSrc.match(/BUILTIN_LOREKIT_TOKEN = '(lk_ro_[A-Za-z0-9]+)'/)?.[1];
const lorekitMcpUrl = knowledgeSrc.match(/LOREKIT_DEFAULT_URL = '(https:\/\/[^']+)\/mcp'/)?.[1];
if (!lorekitToken || !lorekitMcpUrl) throw new Error('bridge-ui: could not read the LoreKit token/URL from tools/knowledge.ts');

const result = await build({
  entryPoints: [join(here, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    __VERSION__: JSON.stringify(version),
    __LOREKIT_TOKEN__: JSON.stringify(lorekitToken),
    __LOREKIT_API__: JSON.stringify(lorekitMcpUrl),
  },
  outdir: 'out',
  write: false,
  legalComments: 'none',
});

const pick = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
// Keep inline <script> from terminating early on a literal "</script" in the bundle
const js = pick('.js').replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Bridge</title>
<meta name="theme-color" content="#0e0f11">
<link rel="manifest" href="/mcp_bridge.webmanifest">
<link rel="icon" type="image/png" href="/mcp_bridge_icon_192.png">
<link rel="apple-touch-icon" href="/mcp_bridge_icon_192.png">
<style>${pick('.css')}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'mcp_bridge.html'), html);
// PWA files (manifest, service worker, icons) sit next to the page in reaper_www_root/
cpSync(join(here, 'public'), outDir, { recursive: true });
console.log(`bridge-ui: wrote mcp_bridge.html (${(html.length / 1024).toFixed(1)} KB)`);
