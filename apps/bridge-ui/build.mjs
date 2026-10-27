// Bundles the React app and inlines JS + CSS into one self-contained HTML file
// (REAPER's web server serves single files from reaper_www_root/).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../dist/apps/bridge-ui');
const { version } = JSON.parse(readFileSync(join(here, '../reaper-mcp-server/package.json'), 'utf-8'));

const result = await build({
  entryPoints: [join(here, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __VERSION__: JSON.stringify(version) },
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
console.log(`bridge-ui: wrote mcp_bridge.html (${(html.length / 1024).toFixed(1)} KB)`);
