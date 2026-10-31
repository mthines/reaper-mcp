import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DRAWER_EXAMPLES, EXAMPLE_NOW } from '../../demo/examples.js';
import { Log } from './index.js';

const example = (title: string) => DRAWER_EXAMPLES.find((x) => x.title === title) ?? DRAWER_EXAMPLES[0];

const meta = {
  title: 'Features/Log/Details/Tests',
  component: Log.Details,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { entry: example('Error').entry, history: [], session: null, now: EXAMPLE_NOW, filtered: false, onFilter: fn(), onAddTerm: fn(), onClose: fn(), onPick: fn() },
} satisfies Meta<typeof Log.Details>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsASystemErrorAsAnError: Story = {
  play: async ({ canvasElement }) => {
    const drawer = within(canvasElement).getByRole('complementary', { name: 'Details for send_midi_cc' });
    await expect(within(drawer).getAllByText('Error').length).toBeGreaterThan(0);
    await expect(within(drawer).queryByText('Refused')).toBeNull();
    await expect(within(drawer).getByText(/could not be found in the MCP Meters container/)).toBeInTheDocument();
  },
};

export const ShowsARefusedRequestAsAWarning: Story = {
  args: { entry: example('Refused').entry },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Refused')).toBeInTheDocument();
  },
};

export const ClosesWithItsButton: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close details' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
