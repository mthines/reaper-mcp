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
      '@reaper-mcp/extension-api': resolve(__dirname, '../../libs/extension-api/src/index.ts'),
      '@reaper-mcp/protocol': resolve(__dirname, '../../libs/protocol/src/index.ts'),
    },
  },
});
