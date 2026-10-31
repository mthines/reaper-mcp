import { defineConfig } from 'vitest/config';
import { buildConstants } from './build-config.mjs';

// The page's build-time constants (version, LoreKit token, Dash0 destination), the same values build.mjs bakes in
const constants = buildConstants();

export default defineConfig({
  define: constants,
  test: {
    globals: true,
    environment: 'node',
    watch: false,
    passWithNoTests: true,
    // The page's stylesheets (root and CSS modules) apply in jsdom, so a story can tell a shown element from a hidden one
    css: { include: [/\.css$/] },
  },
});
