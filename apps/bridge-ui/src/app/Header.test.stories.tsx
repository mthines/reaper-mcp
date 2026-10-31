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
