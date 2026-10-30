import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { Log } from './index.js';

const { log, sessions } = exampleFeed();

const meta = {
  title: 'Features/Log/Log',
  component: Log,
  parameters: { layout: 'fullscreen' },
  args: {
    log,
    selection: null,
    rangeKey: '1h',
    oldestKept: log[log.length - 1]?.t ?? null,
    sessions,
    knowledge: DEMO_KNOWLEDGE,
    view: 'calls',
    paused: false,
    now: EXAMPLE_NOW,
    onRange: fn(),
    onClearSelection: fn(),
    onView: fn(),
    onTogglePause: fn(),
    onClear: fn(),
    onOpenSettings: fn(),
  },
  argTypes: {
    view: { control: 'select', options: ['calls', 'tools', 'sessions', 'plugins'] },
    rangeKey: { control: 'select', options: ['5m', '10m', '30m', '1h', '6h', '24h', '7d'] },
  },
  decorators: [(Story) => <div style={{ height: 640, display: 'flex', flexDirection: 'column' }}><Story /></div>],
} satisfies Meta<typeof Log>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playground: Story = {};

export const Tools: Story = { args: { view: 'tools' } };

export const Sessions: Story = { args: { view: 'sessions' } };

export const Plugins: Story = { args: { view: 'plugins' } };

export const Paused: Story = { args: { paused: true } };

export const Empty: Story = { args: { log: [], oldestKept: null } };
