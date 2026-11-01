import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';

const pick = (title: string) => {
  const x = editExamples('pins').find((e) => e.title === title);
  if (!x) throw new Error(`no pins example “${title}”`);
  return x.v;
};
const sidechain = pick('Pins · sidechain');
const listed = pick('Pins listed');

const meta = {
  title: 'Features/Edit views/Pins/Tests',
  component: EditView.Pins,
  tags: ['test'],
  args: { v: sidechain },
} satisfies Meta<typeof EditView.Pins>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ThePatchSaysWhichChannelsFeedWhichPins: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('img', { name: /channel 3 into Aux L in \(new\), channel 4 into Aux R in \(new\); Out 1 to channel 1/ })).toBeInTheDocument();
    await expect(c.getByText('Newly connected')).toBeInTheDocument();
    await expect(c.getByText('Channel added to the track')).toBeInTheDocument();
  },
};

export const HoveringAPinShowsWhereItIsWired: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const pin = c.getByText('Aux L in');
    await userEvent.hover(pin);
    await expect(await c.findByRole('tooltip')).toHaveTextContent('Aux L in ← channel 3 (new)');
    await userEvent.unhover(pin);
    await expect(c.queryByRole('tooltip')).not.toBeInTheDocument();
  },
};

export const HoveringAChannelShowsWhatItFeeds: Story = {
  args: { v: listed },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const patch = within(c.getByRole('img'));
    await userEvent.hover(patch.getAllByText('2')[0]);
    await expect(await c.findByRole('tooltip')).toHaveTextContent('Channel 2 → Input R');
    await expect(c.getByText('Connected')).toBeInTheDocument();
  },
};
