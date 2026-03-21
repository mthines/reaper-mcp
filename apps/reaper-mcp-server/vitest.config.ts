import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@reaper-mcp/protocol': resolve(__dirname, '../../libs/protocol/src/index.ts'),
    },
  },
});
