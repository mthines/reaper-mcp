// The bridge page: React (with the React Compiler) built by Vite into one self-contained mcp_bridge.html, since
// REAPER's web server serves single files from reaper_www_root/. `pnpm dev:bridge` runs this config's dev server.
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildConstants, here, reactCompilerBabel } from './build-config.mjs';
import { reaperDev } from './vite-reaper-dev.mjs';

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

export default defineConfig({
  root: here,
  define: buildConstants(),
  plugins: [react({ babel: reactCompilerBabel }), viteSingleFile(), reaperDev(), hostedChangelogMedia()],
  server: { host: '127.0.0.1', port: Number(process.env.BRIDGE_DEV_PORT) || 8098, strictPort: Boolean(process.env.BRIDGE_DEV_PORT) },
  build: {
    outDir: join(here, '../../dist/apps/bridge-ui'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: { input: join(here, 'mcp_bridge.html') },
  },
});
