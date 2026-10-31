import type { StorybookConfig } from '@storybook/react-vite';
import type { PluginOption } from 'vite';

// Storybook builds on the page's vite.config.ts (React with the React Compiler, the build-time constants). The
// single-file output and the dev server's REAPER proxy are the page's alone.
const PAGE_ONLY = new Set(['vite:singlefile', 'reaper-dev']);
const named = (p: PluginOption): p is { name: string } => !!p && typeof p === 'object' && 'name' in p;

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({
    ...vite,
    plugins: (vite.plugins ?? []).flat(Infinity as 1).filter((p) => !(named(p) && PAGE_ONLY.has(p.name))),
    build: { ...vite.build, rollupOptions: { ...vite.build?.rollupOptions, input: undefined } },
  }),
};

export default config;
