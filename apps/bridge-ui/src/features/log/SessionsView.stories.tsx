import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import type { Session } from '../../lib/sessions.js';
import { SessionsView } from './SessionsView.js';

const { log, sessions } = exampleFeed();

const meta = {
  title: 'Features/Log/SessionsView',
  component: SessionsView,
  args: { ids: [...sessions.keys()], sessionOf: (id: string): Session => sessions.get(id) ?? { id, first: 0, last: 0, commands: 0, errors: 0 }, log, now: EXAMPLE_NOW, onPick: fn() },
} satisfies Meta<typeof SessionsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every agent that used the bridge in the last hour: connected, idle or gone */
export const Default: Story = {};

export const Playground: Story = {};

export const PicksAnAgent: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getAllByText(/midnight-drive/)[0]);
    await expect(args.onPick).toHaveBeenCalled();
  },
};
