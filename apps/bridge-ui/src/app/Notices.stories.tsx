import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { Notices } from './Notices.js';

const { status } = exampleFeed();
const settings = { paused: false, readonly: false, openOnStart: true, dev: false, ...status.settings };

const meta = {
  title: 'App/Notices',
  component: Notices,
  args: { status, settings, onSet: fn(), request: fn(), release: null, onWhatsNew: fn() },
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

const newer = { version: '99.0.0', url: 'https://github.com/mthines/reaper-mcp/releases/tag/v99.0.0' };

/** A newer release, and this install can update itself: Update, What's new (opens the drawer) and skip */
export const UpdateAvailable: Story = { args: { release: newer, status: { ...status, control: { token: 'demo', canRestart: true, canUpdate: true } } } };

/** A newer release on an install the bridge can't update (npm, or no update config): the command instead */
export const UpdateAvailableByHand: Story = { args: { release: newer, status: { ...status, control: { token: 'demo', canRestart: true, canUpdate: false } } } };
