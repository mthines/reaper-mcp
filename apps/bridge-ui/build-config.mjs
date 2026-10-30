// What build.mjs and dev.mjs share: the esbuild options and the single-file HTML the bundle is inlined into.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));

/** esbuild options for the page; `extra` adds or overrides fields (dev adds plugins and a sourcemap). */
export function buildOptions(extra = {}) {
  const { version } = JSON.parse(readFileSync(join(here, '../reaper-mcp-server/package.json'), 'utf-8'));

  // The public read-only LoreKit token + endpoint for the built-in plugin records, read from the server's
  // knowledge tool so there's one source of truth. The page calls LoreKit's REST API (CORS-enabled);
  // the server's /mcp endpoint is not reachable from a browser.
  const knowledgeSrc = readFileSync(join(here, '../reaper-mcp-server/src/tools/knowledge.ts'), 'utf-8');
  const lorekitToken = knowledgeSrc.match(/BUILTIN_LOREKIT_TOKEN = '(lk_ro_[A-Za-z0-9]+)'/)?.[1];
  const lorekitMcpUrl = knowledgeSrc.match(/LOREKIT_DEFAULT_URL = '(https:\/\/[^']+)\/mcp'/)?.[1];
  if (!lorekitToken || !lorekitMcpUrl) throw new Error('bridge-ui: could not read the LoreKit token/URL from tools/knowledge.ts');

  // Usage statistics go where the server's default telemetry goes (an ingest-only token for one Dash0
  // dataset, safe to ship), read from telemetry-consent.ts so there's one source of truth. An empty token
  // there means no built-in destination, and the page sends nothing.
  const consentSrc = readFileSync(join(here, '../reaper-mcp-server/src/telemetry-consent.ts'), 'utf-8');
  const destination = consentSrc.match(/DEFAULT_DESTINATION = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const field = (name) => destination.match(new RegExp(`${name}: '([^']*)'`))?.[1];
  const dash0 = { endpoint: field('endpoint'), dataset: field('dataset'), token: field('token') ?? '' };
  if (!dash0.endpoint || !dash0.dataset) throw new Error('bridge-ui: could not read DEFAULT_DESTINATION from telemetry-consent.ts');

  return {
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
      __DASH0_ENDPOINT__: JSON.stringify(dash0.endpoint),
      __DASH0_DATASET__: JSON.stringify(dash0.dataset),
      __DASH0_TOKEN__: JSON.stringify(dash0.token),
    },
    outdir: 'out',
    write: false,
    legalComments: 'none',
    ...extra,
  };
}

/** The page as one self-contained HTML file; `headExtra` is inserted before </head> (dev's live reload). */
export function renderHtml(outputFiles, headExtra = '') {
  const pick = (ext) => outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
  // Keep inline <script> from terminating early on a literal "</script" in the bundle
  const js = pick('.js').replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
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
${headExtra}</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
}
