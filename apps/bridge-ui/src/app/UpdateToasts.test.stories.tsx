import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { toast } from 'sonner';
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
const current: BridgeStatus = { ...status, control: { ...control, update: { kind: 'update', state: 'current', startedAt: 1, log: [] } } };
const idleDone: BridgeStatus = done;

/** Steps a status feed forward on a click, so a play function can watch the toasts follow an update */
const Feed = ({ steps, onReload, onOpenChangelog, version = '1.0.0' }: { steps: BridgeStatus[]; onReload: () => void; onOpenChangelog?: () => void; version?: string }) => {
  const [i, setI] = useState(0);
  return (
    <>
      <button onClick={() => setI((n) => Math.min(n + 1, steps.length - 1))}>Next</button>
      <UpdateToasts status={steps[i]} onReload={onReload} onOpenChangelog={onOpenChangelog} version={version} />
    </>
  );
};

const meta = {
  title: 'App/UpdateToasts/Tests',
  component: Feed,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { steps: [status], onReload: fn(), onOpenChangelog: fn() },
  beforeEach: () => {
    resetUpdateReady();
    sessionStorage.removeItem('mcp-bridge-updated-from');
    toast.dismiss(); // toasts live on document.body, so one story's would leak into the next
  },
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

export const ReportsAFailedUpdateOnceWithTheReason: Story = {
  args: { steps: [running, failed] },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByText('Update failed')).toBeInTheDocument();
    await expect(screen.getByText('The download did not finish.')).toBeInTheDocument();
    // Try again lives in the failure notice, so the toast does not offer a second one
    await expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  },
};

const npmFailed: BridgeStatus = { ...failed, control: { ...failed.control as NonNullable<typeof failed.control>, updateSource: 'npm', update: { kind: 'update', state: 'failed', startedAt: 1, log: ['==> Checking for a new version', '✗ v0.91.1 is released, but npm only offers v0.85.0 from this computer.', '    To check: npm install -g @mthines/reaper-mcp@0.91.1'] } } };

/** npm can't deliver: the toast says it failed, gives the reason, and points at the clone install */
export const SuggestsACloneInstallWhenNpmCannotDeliver: Story = {
  args: { steps: [running, npmFailed] },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByText('Update failed')).toBeInTheDocument();
    await expect(screen.getByText(/v0\.91\.1 is released, but npm only offers v0\.85\.0/)).toBeInTheDocument();
    await expect(screen.getByRole('link', { name: 'See how' })).toHaveAttribute('href', expect.stringContaining('/docs/install'));
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

/** The updater found nothing newer: say so, and never offer Reload for an install that did not happen */
export const SaysAlreadyUpToDateWithoutOfferingReload: Story = {
  args: { steps: [running, current] },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Next' }));
    await expect(await screen.findByText('Already up to date')).toBeInTheDocument();
    // judge this toast alone: an earlier story's toast may still be animating out on document.body
    const toastEl = (await screen.findByText('Already up to date')).closest('li') as HTMLElement;
    await expect(within(toastEl).queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  },
};

/** After the update's reload the page is the new version: it points at What's new once */
export const OffersWhatsNewAfterTheReloadThatFollowedAnUpdate: Story = {
  args: { steps: [status], version: '2.0.0', onOpenChangelog: fn() },
  beforeEach: () => {
    resetUpdateReady();
    toast.dismiss();
    sessionStorage.setItem('mcp-bridge-updated-from', '1.0.0');
  },
  play: async ({ canvasElement, args }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText('reaper-mcp v2.0.0 is ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "See what's new" }));
    await expect(args.onOpenChangelog).toHaveBeenCalledOnce();
  },
};

/** A reload that came before the new version was served is still the old page: stay quiet */
export const StaysQuietWhenTheReloadStillServesTheOldVersion: Story = {
  args: { steps: [status], version: '1.0.0' },
  beforeEach: () => {
    resetUpdateReady();
    toast.dismiss();
    sessionStorage.setItem('mcp-bridge-updated-from', '1.0.0');
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(screen.queryByRole('button', { name: "See what's new" })).not.toBeInTheDocument();
  },
};
