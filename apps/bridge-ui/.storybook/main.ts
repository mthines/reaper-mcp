import type { StorybookConfig } from '@storybook/react-vite';
import { buildOptions } from '../build-config.mjs';

// The page's build-time constants (version, LoreKit token, Dash0 destination), the same values build.mjs bakes in
const constants = Object.fromEntries(Object.entries(buildOptions().define as Record<string, string>).filter(([k]) => k.startsWith('__')));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({ ...vite, define: { ...vite.define, ...constants } }),
};

export default config;
