import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
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

export const ShowsAndHidesTheDetails: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('button', { name: /stat details|fewer stats/ });
    const name = toggle.getAttribute('aria-label');
    await userEvent.click(toggle);
    await expect(toggle).not.toHaveAttribute('aria-label', name);
  },
};
