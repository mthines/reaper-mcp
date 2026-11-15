import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { buildConstants, reactCompilerBabel } from './build-config.mjs';

export default defineConfig({
  // Components run as the page ships them: through the React Compiler
  plugins: [react({ babel: reactCompilerBabel })],
  // The page's build-time constants (version, LoreKit token, Dash0 destination), the same values vite.config.ts bakes in
  define: buildConstants(),
  resolve: { alias: { '@reaper-mcp/feature-flags': resolve(__dirname, '../../libs/feature-flags/src/index.ts') } },
  test: {
    globals: true,
    environment: 'node',
    watch: false,
    passWithNoTests: true,
    // The page's stylesheets (root and CSS modules) apply in jsdom, so a story can tell a shown element from a hidden one
    css: { include: [/\.css$/] },
  },
});
