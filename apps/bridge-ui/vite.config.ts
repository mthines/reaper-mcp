// The bridge page: React (with the React Compiler) built by Vite into one self-contained mcp_bridge.html, since
// REAPER's web server serves single files from reaper_www_root/. `pnpm dev:bridge` runs this config's dev server.
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildConstants, here, reactCompilerBabel } from './build-config.mjs';
import { devPort, reaperDev } from './vite-reaper-dev.mjs';
import { parseGuide, renderLlmsFull, renderLlmsTxt, sortGuides, type Guide } from './src/features/docs/docs.js';

// The hosted build serves the changelog's media (and the highlights index) beside the page: /changelog/media/…
const hostedChangelogMedia = (): Plugin => ({
  name: 'hosted-changelog-media',
  apply: 'build',
  closeBundle() {
    if (process.env.BRIDGE_HOSTED !== '1') return;
    cpSync(join(here, 'changelog'), join(here, '../../dist/apps/bridge-ui/changelog'), {
      recursive: true,
      filter: (src) => !src.endsWith('releases.snapshot.json'),
    });
  },
});

// The guides (docs/guides/*.md) are served beside the page: /docs/<slug>.md, /docs/index.json, /llms.txt, /llms-full.txt.
// Hosted build: copied into the output. Dev server: served from the working tree, so a saved guide shows on reload.
const guidesDir = join(here, '../../docs/guides');
const MEDIA_TYPES: Record<string, string> = { '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4' };

function readGuides(): Guide[] {
  if (!existsSync(guidesDir)) return [];
  return sortGuides(
    readdirSync(guidesDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'CLAUDE.md')
      .map((f) => parseGuide(basename(f, '.md'), readFileSync(join(guidesDir, f), 'utf-8'))),
  );
}

const llmsOrigin = () => (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

const guidesIndex = (guides: Guide[]) => JSON.stringify(guides.map((g) => ({ ...g, body: undefined })));

const hostedDocs = (): Plugin => ({
  name: 'hosted-docs',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      const send = (type: string, body: string | Buffer) => {
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      };
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        // The hosted site's pages by path, as vercel.json rewrites them: /changelog and the guides
        if (path === '/changelog' || path === '/docs' || /^\/docs\/[^/.]+\/?$/.test(path)) {
          req.url = '/mcp_bridge.html';
          return next();
        }
        if (path === '/docs/index.json') return send(MEDIA_TYPES['.json'], guidesIndex(readGuides()));
        if (path === '/llms.txt') return send(MEDIA_TYPES['.txt'], renderLlmsTxt(readGuides()));
        if (path === '/llms-full.txt') return send(MEDIA_TYPES['.txt'], renderLlmsFull(readGuides()));
        const file = /^\/docs\/(.+)$/.exec(decodeURIComponent(path))?.[1];
        if (file) {
          const full = normalize(join(guidesDir, file));
          if (!full.startsWith(guidesDir) || !existsSync(full) || !statSync(full).isFile()) return next();
          return send(MEDIA_TYPES[extname(full)] ?? 'application/octet-stream', readFileSync(full));
        }
      } catch (e) {
        res.statusCode = 500;
        return send(MEDIA_TYPES['.txt'], e instanceof Error ? e.message : String(e));
      }
      next();
    });
  },
  closeBundle() {
    if (process.env.BRIDGE_HOSTED !== '1') return;
    const out = join(here, '../../dist/apps/bridge-ui');
    const guides = readGuides(); // a guide with bad frontmatter fails the hosted build here, never the live site
    cpSync(guidesDir, join(out, 'docs'), { recursive: true, filter: (src) => !['README.md', 'CLAUDE.md'].includes(basename(src)) });
    writeFileSync(join(out, 'docs/index.json'), guidesIndex(guides));
    writeFileSync(join(out, 'llms.txt'), renderLlmsTxt(guides, llmsOrigin()));
    writeFileSync(join(out, 'llms-full.txt'), renderLlmsFull(guides, llmsOrigin()));
  },
});

export default defineConfig(async ({ command }) => ({
  root: here,
  define: buildConstants(),
  plugins: [react({ babel: reactCompilerBabel }), viteSingleFile(), reaperDev(), hostedChangelogMedia(), hostedDocs()],
  server: { host: '127.0.0.1', port: command === 'serve' ? await devPort() : 8098, strictPort: true },
  build: {
    outDir: join(here, '../../dist/apps/bridge-ui'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: { input: join(here, 'mcp_bridge.html') },
  },
}));
