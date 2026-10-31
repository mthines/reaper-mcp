import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { EXAMPLE_NOW } from '../demo/examples.js';
import { Header } from './Header.js';

const { status, sessions } = exampleFeed();

const meta = {
  title: 'App/Header',
  component: Header,
  args: {
    status,
    state: 'live',
    reachable: true,
    now: EXAMPLE_NOW,
    sessions,
    overview: false,
    onShowAgents: fn(),
    onOpenSettings: fn(),
    onToggleOverview: fn(),
  },
  argTypes: { state: { control: 'select', options: ['live', 'stale', 'offline'] } },
} satisfies Meta<typeof Header>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playground: Story = {};

export const RebuildAvailable: Story = { args: { onRebuild: fn() } };

export const Offline: Story = { args: { status: null, state: 'offline', reachable: false } };
