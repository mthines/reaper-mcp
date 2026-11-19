import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toaster, toast } from 'sonner';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { exampleFeed } from '../../demo/feed.js';
import type { BridgeSidecarInstall, BridgeStatus } from '../../lib/status.js';
import { SidecarToasts } from './SidecarToasts.js';

const { status } = exampleFeed();
const job = (state: BridgeSidecarInstall['state'], log: string[] = []): BridgeStatus => ({
  ...status,
  control: { token: 'demo', canRestart: true, canUpdate: true, canInstallSidecar: true, sidecar: { kind: 'sidecar', state, startedAt: 1, log } },
});

/** Steps a status feed forward on a click, so a play function can watch the toasts follow an install */
const Feed = ({ steps }: { steps: BridgeStatus[] }) => {
  const [i, setI] = useState(0);
  return (
    <>
      <button onClick={() => setI((n) => Math.min(n + 1, steps.length - 1))}>Next</button>
      <Toaster theme="dark" />
      <SidecarToasts status={steps[i]} />
    </>
  );
};

const meta = {
  title: 'Features/Sidecar/Toasts/Tests',
  component: Feed,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { steps: [status] },
  beforeEach: () => {
    toast.dismiss();
  }, // toasts live on document.body, so one story's would leak into the next
} satisfies Meta<typeof Feed>;
export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

export const AnInstallThisPageWatchedEndsWithAToastThatSaysToTryAgain: Story = {
  args: { steps: [status, job('running', ['Installing numpy…']), job('done')] },
  play: async ({ canvasElement }) => {
    const next = within(canvasElement).getByRole('button', { name: 'Next' });
    await userEvent.click(next);
    await waitFor(() => expect(body().getByText('Installing audio analysis…')).toBeVisible());
    await expect(body().getByText('Installing numpy…')).toBeVisible();
    await userEvent.click(next);
    await waitFor(() => expect(body().getByText('Audio analysis is installed')).toBeVisible());
    await expect(body().getByText('Ask the agent to try again.')).toBeVisible();
  },
};

export const AFailedInstallSaysSoAndNamesTheCommand: Story = {
  args: { steps: [status, job('running'), job('failed', ['Python 3.10+ is required'])] },
  play: async ({ canvasElement }) => {
    const next = within(canvasElement).getByRole('button', { name: 'Next' });
    await userEvent.click(next);
    await userEvent.click(next);
    await waitFor(() => expect(body().getByText('The install failed')).toBeVisible());
    await expect(body().getByText(/Python 3.10\+ is required/)).toBeVisible();
    await expect(body().getByText(/reaper-mcp setup-sidecar/)).toBeVisible();
  },
};

export const AnInstallFromBeforeThePageOpenedStaysSilent: Story = {
  args: { steps: [job('done')] },
  play: async () => {
    await new Promise((r) => setTimeout(r, 300));
    await expect(body().queryByText('Audio analysis is installed')).toBeNull();
  },
};
