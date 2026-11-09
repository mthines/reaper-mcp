import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import { EXAMPLE_NOW } from '../demo/examples.js';
import { Header } from './Header.js';

const { status, sessions } = exampleFeed();

const meta = {
  title: 'App/Header/Tests',
  component: Header,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { status, state: 'live', reachable: true, now: EXAMPLE_NOW, sessions, overview: false, onShowAgents: fn(), onOpenSettings: fn(), onToggleOverview: fn() },
} satisfies Meta<typeof Header>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NamesTheProjectAndOpensSettings: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Midnight Drive — mix v3\.rpp/)).toBeInTheDocument();
    await expect(canvas.getByText('Live')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Settings' }));
    await expect(args.onOpenSettings).toHaveBeenCalled();
  },
};

export const SaysWhenReaperIsUnreachable: Story = {
  args: { status: null, state: 'offline', reachable: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('REAPER unreachable')).toBeInTheDocument();
  },
};

export const AnUpdateOpensWhatsNew: Story = {
  args: { updateVersion: '99.0.0', onOpenUpdate: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Update available' }));
    await expect(args.onOpenUpdate).toHaveBeenCalled();
  },
};

export const NoPillWithoutAnUpdate: Story = {
  args: { onOpenUpdate: fn() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Update available' })).not.toBeInTheDocument();
  },
};

/** Short windows fold the header into the ⋯ menu (hidden by CSS otherwise, hence `hidden: true`) */
export const TheMenuOffersTheUpdateAndWhatsNew: Story = {
  args: { updateVersion: '99.0.0', onOpenUpdate: fn(), onOpenChangelog: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'More (update available)', hidden: true }));
    await userEvent.click(canvas.getByRole('menuitem', { name: 'What’s new', hidden: true }));
    await expect(args.onOpenChangelog).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'More (update available)', hidden: true }));
    await userEvent.click(canvas.getByRole('menuitem', { name: 'What’s new in v99.0.0', hidden: true }));
    // Opened from the menu, so it counts as the menu, not the header pill
    await expect(args.onOpenChangelog).toHaveBeenCalledTimes(2);
    await expect(args.onOpenUpdate).not.toHaveBeenCalled();
  },
};
