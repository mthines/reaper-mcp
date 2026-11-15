import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    watch: false,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      // The more specific alias first: a prefix match would send '/server' to index.ts
      '@reaper-mcp/feature-flags/server': resolve(__dirname, '../../libs/feature-flags/src/server.ts'),
      '@reaper-mcp/feature-flags': resolve(__dirname, '../../libs/feature-flags/src/index.ts'),
      '@reaper-mcp/protocol': resolve(__dirname, '../../libs/protocol/src/index.ts'),
      '@reaper-mcp/extension-api': resolve(__dirname, '../../libs/extension-api/src/index.ts'),
    },
  },
});
