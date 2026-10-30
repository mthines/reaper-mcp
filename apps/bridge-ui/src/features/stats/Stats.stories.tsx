import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { Stats } from './Stats.js';

const { status, log, series } = exampleFeed();

const meta = {
  title: 'Features/Stats/Stats',
  component: Stats,
  args: { status, log, now: EXAMPLE_NOW, series },
} satisfies Meta<typeof Stats>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Commands, errors, latency and the defer loop, each with its last minute as a sparkline */
export const Default: Story = {};

export const Playground: Story = {};

export const CountsTheCommandsAndErrors: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(status.commands.toLocaleString())).toBeVisible();
    await expect(canvas.getByText(status.errors.toLocaleString())).toBeVisible();
  },
};
