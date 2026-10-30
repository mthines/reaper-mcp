import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { Notices } from './Notices.js';

const { status } = exampleFeed();

const meta = {
  title: 'App/Notices',
  component: Notices,
  args: { status, settings: status.settings ?? null, onSet: fn(), request: fn() },
} satisfies Meta<typeof Notices>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing to say: a healthy bridge shows no notice */
export const Default: Story = {};

export const Playground: Story = {};

export const Paused: Story = { args: { settings: { ...status.settings!, paused: true } } };

export const ReadOnly: Story = { args: { settings: { ...status.settings!, readonly: true } } };

export const NoSwsAndOutdated: Story = {
  args: { status: { ...status, health: { sws: false, jsfx: true, outdated: true }, control: { token: 'demo', canRestart: true, canUpdate: false } } },
};
