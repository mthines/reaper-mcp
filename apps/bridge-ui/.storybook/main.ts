import type { StorybookConfig } from '@storybook/react-vite';
import { buildConstants } from '../build-config.mjs';

// The page's build-time constants (version, LoreKit token, Dash0 destination), the same values build.mjs bakes in
const constants = buildConstants();

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({ ...vite, define: { ...vite.define, ...constants } }),
};

export default config;
