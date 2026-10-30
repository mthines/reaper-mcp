import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { PluginsView } from './PluginsView.js';

const meta = {
  title: 'Features/Plugins/PluginsView',
  component: PluginsView,
  args: { feed: DEMO_KNOWLEDGE, query: '', now: EXAMPLE_NOW, onOpenSettings: fn() },
  argTypes: { query: { control: 'text' } },
  decorators: [(Story) => <div style={{ height: 640, display: 'flex', flexDirection: 'column' }}><Story /></div>],
} satisfies Meta<typeof PluginsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Which installed plugins the mix skills know, project plugins first; unknown ones point at /learn-plugin */
export const Default: Story = {};

export const Playground: Story = {};

export const Filtered: Story = { args: { query: 'fabfilter' } };

export const WithoutYourRecords: Story = { args: { feed: { ...DEMO_KNOWLEDGE, records: DEMO_KNOWLEDGE.records.filter((r) => r.layer === 'built-in'), userLayer: 'off', publish: undefined } } };

export const OldReaper: Story = { args: { feed: { ...DEMO_KNOWLEDGE, installed: [], installedSupported: false } } };

export const LoadingFailed: Story = { args: { feed: { ...DEMO_KNOWLEDGE, problem: 'LoreKit didn’t answer (HTTP 503). Built-in records are unavailable.' } } };
