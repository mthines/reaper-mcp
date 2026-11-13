import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import type { BridgeStatus } from '../lib/status.js';
import { resetUpdateReady } from '../lib/update.js';
import { UpdateToasts } from './UpdateToasts.js';

const { status } = exampleFeed();
const control = { token: 'demo', canRestart: true, canUpdate: true, updateSource: 'npm' as const };
const running: BridgeStatus = { ...status, control: { ...control, update: { kind: 'update', state: 'running', startedAt: 1, log: ['==> Downloading the new version'] } } };
const failed: BridgeStatus = { ...status, control: { ...control, update: { kind: 'update', state: 'failed', startedAt: 1, log: ['✗ The download did not finish.'] } } };
const done: BridgeStatus = { ...status, control: { ...control, update: { kind: 'update', state: 'done', startedAt: 1, log: [] } } };
// The bridge restarted into the new version: a new run that no longer remembers the update
const restarted: BridgeStatus = { ...status, startedAt: status.startedAt + 60_000, control };
const idleDone: BridgeStatus = done;

/** Steps a status feed forward on a click, so a play function can watch the toasts follow an update */
const Feed = ({ steps, request, onReload }: { steps: BridgeStatus[]; request: () => void; onReload: () => void }) => {
  const [i, setI] = useState(0);
  return (
    <>
      <button onClick={() => setI((n) => Math.min(n + 1, steps.length - 1))}>Next</button>
      <UpdateToasts status={steps[i]} request={request} onReload={onReload} />
    </>
  );
};

const meta = {
  title: 'App/UpdateToasts/Tests',
  component: Feed,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { steps: [status], request: fn(), onReload: fn() },
  beforeEach: () => resetUpdateReady(),
} satisfies Meta<typeof Feed>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FollowsAnUpdateAndOffersReload: Story = {
  args: { steps: [status, running, restarted] },
  play: async ({ canvasElement, args }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.queryByText('Updating reaper-mcp…')).not.toBeInTheDocument();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByText('Updating reaper-mcp…')).toBeInTheDocument();
    await expect(screen.getByText('Downloading the new version')).toBeInTheDocument();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByText('reaper-mcp is up to date')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Updating reaper-mcp…')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await expect(args.onReload).toHaveBeenCalledOnce();
  },
};

export const OffersReloadWhenTheBridgeKeepsTheDoneState: Story = {
  args: { steps: [running, done] },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
  },
};

export const ReportsAFailedUpdateAndTriesAgain: Story = {
  args: { steps: [running, failed] },
  play: async ({ canvasElement, args }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByText('The update didn’t finish')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await expect(args.request).toHaveBeenCalled();
  },
};

/** A page opened after an update finished must not offer Reload on every visit */
export const StaysQuietForAnUpdateItNeverSawRun: Story = {
  args: { steps: [idleDone] },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  },
};
