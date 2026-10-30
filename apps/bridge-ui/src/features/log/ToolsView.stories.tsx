import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { Log } from './index.js';

const { log } = exampleFeed();

const meta = {
  title: 'Features/Log/ToolsView',
  component: Log.Tools,
  args: { log, query: '', now: EXAMPLE_NOW, onPick: fn() },
  argTypes: { query: { control: 'text' } },
} satisfies Meta<typeof Log.Tools>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Calls, errors and latency per tool */
export const Default: Story = {};

export const Playground: Story = {};

export const Filtered: Story = { args: { query: 'track' } };

export const PicksATool: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByText('read_track_lufs')[0]);
    await expect(args.onPick).toHaveBeenCalledWith('read_track_lufs', false);
  },
};
