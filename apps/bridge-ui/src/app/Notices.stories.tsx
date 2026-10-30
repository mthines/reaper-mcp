import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { RELEASE_KEY } from '../lib/update.js';
import { Notices } from './Notices.js';

const { status } = exampleFeed();
const settings = { paused: false, readonly: false, openOnStart: true, dev: false, ...status.settings };

const meta = {
  title: 'App/Notices',
  component: Notices,
  args: { status, settings, onSet: fn(), request: fn() },
  // The release check sees this version as the latest, so no story offers an update or asks GitHub
  beforeEach: () => {
    localStorage.setItem(RELEASE_KEY, JSON.stringify({ at: Date.now(), release: { version: __VERSION__, url: 'https://github.com/mthines/reaper-mcp/releases' } }));
    return () => localStorage.removeItem(RELEASE_KEY);
  },
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
