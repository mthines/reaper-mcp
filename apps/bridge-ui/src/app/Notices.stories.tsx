import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { Notices } from './Notices.js';

const { status } = exampleFeed();
const settings = { paused: false, readonly: false, openOnStart: true, dev: false, ...status.settings };

const meta = {
  title: 'App/Notices',
  component: Notices,
  args: { status, settings, onSet: fn(), request: fn() },
} satisfies Meta<typeof Notices>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing to say: a healthy bridge shows no notice */
export const Default: Story = {};

export const Playground: Story = {};

export const Paused: Story = { args: { settings: { ...settings, paused: true } } };

export const ReadOnly: Story = { args: { settings: { ...settings, readonly: true } } };

export const NoSwsAndOutdated: Story = {
  args: { status: { ...status, health: { sws: false, jsfx: true, outdated: true }, control: { token: 'demo', canRestart: true, canUpdate: false } } },
};
