import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { Timeline } from './Timeline.js';

const { history, longHistory } = exampleFeed();

const meta = {
  title: 'Features/Timeline/Tests',
  component: Timeline,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { history, longHistory, now: EXAMPLE_NOW, rangeKey: '1h', selection: null, clearedAt: 0, onRange: fn(), onSelect: fn() },
} satisfies Meta<typeof Timeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CountsTheCallsInTheRangeAndChangesIt: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/[1-9][\d,]* in the last hour · 1 min per bar/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Time range: Last hour' }));
    await userEvent.click(canvas.getByRole('option', { name: /Last 7 days/ }));
    await expect(args.onRange).toHaveBeenCalledWith('7d');
  },
};

export const DrawsNothingBeforeTheBridgePublishedHistory: Story = {
  args: { history: null, longHistory: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/^0 in the last hour/)).toBeInTheDocument();
  },
};
