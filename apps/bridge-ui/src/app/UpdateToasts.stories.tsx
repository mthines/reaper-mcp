import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import type { BridgeStatus } from '../lib/status.js';
import { UpdateToasts } from './UpdateToasts.js';

const { status } = exampleFeed();
const withUpdate = (state: 'running' | 'failed' | 'done', log: string[]): BridgeStatus => ({
  ...status,
  control: { token: 'demo', canRestart: true, canUpdate: true, updateSource: 'npm', update: { kind: 'update', state, startedAt: 1, log } },
});

const meta = {
  title: 'App/UpdateToasts',
  component: UpdateToasts,
  args: { status, request: fn(), onReload: fn() },
} satisfies Meta<typeof UpdateToasts>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No update running: nothing on screen */
export const Default: Story = {};

export const Playground: Story = {};

/** The download is running in the background: a loading toast naming the step */
export const Downloading: Story = { args: { status: withUpdate('running', ['==> Checking for a new version', '==> Downloading the new version']) } };
