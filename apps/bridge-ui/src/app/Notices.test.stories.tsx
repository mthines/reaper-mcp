import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { Notices } from './Notices.js';

const { status } = exampleFeed();
const settings = { paused: false, readonly: false, openOnStart: true, dev: false, ...status.settings };
const newer = { version: '99.0.0', url: 'https://github.com/mthines/reaper-mcp/releases/tag/v99.0.0' };

const meta = {
  title: 'App/Notices/Tests',
  component: Notices,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: {
    status: { ...status, control: { token: 'demo', canRestart: true, canUpdate: true, updateSource: 'npm' } },
    settings,
    onSet: fn(),
    request: fn(),
    release: newer,
    onSkip: fn(),
    onWhatsNew: fn(),
  },
} satisfies Meta<typeof Notices>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AFastDoubleClickOnUpdateSendsOneRequest: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const update = canvas.getByRole('button', { name: 'Update' });
    await userEvent.dblClick(update);
    await expect(args.request).toHaveBeenCalledTimes(1);
    await expect(args.request).toHaveBeenCalledWith('update');
    await expect(canvas.getByRole('button', { name: 'Starting…' })).toBeDisabled();
  },
};
