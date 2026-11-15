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

/** ReaPack owns the REAPER side: the notice names ReaPack's menu, not commands that would leave the bridge stale */
export const GuidesAReaPackInstallThroughReaPack: Story = {
  args: { status: { ...status, control: { token: 'demo', canRestart: true, canUpdate: false, reapack: true } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('How to update'));
    await expect(canvas.getByText('Extensions → ReaPack → Synchronize packages')).toBeVisible();
    await expect(canvas.getByText('npm install -g @mthines/reaper-mcp@latest')).toBeVisible();
    await expect(canvas.queryByText(/git pull/)).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
  },
};

/** With an Update button (npm setup ran first) it still updates the server; ReaPack handles the rest */
export const KeepsTheUpdateButtonForAReaPackInstallThatCanUpdate: Story = {
  args: { status: { ...status, control: { token: 'demo', canRestart: true, canUpdate: true, updateSource: 'npm', reapack: true } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    await userEvent.click(canvas.getByText('How to update'));
    await expect(canvas.getByText('Extensions → ReaPack → Synchronize packages')).toBeVisible();
    await expect(canvas.queryByText('npm install -g @mthines/reaper-mcp@latest')).not.toBeInTheDocument();
  },
};

/** The by-hand notice stays one short line until someone asks how: the commands unfold from "How to update" */
export const KeepsTheCommandsFoldedUntilAskedFor: Story = {
  args: { status: { ...status, control: { token: 'demo', canRestart: true, canUpdate: false } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('How to update')).toBeInTheDocument();
    await expect(canvas.getByText('git pull && ./scripts/install.sh')).not.toBeVisible();
    await userEvent.click(canvas.getByText('How to update'));
    await expect(canvas.getByText('git pull && ./scripts/install.sh')).toBeVisible();
    await expect(canvas.getByText('npm install -g @mthines/reaper-mcp@latest && reaper-mcp setup')).toBeVisible();
  },
};
