import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { EditView } from '../index.js';

const meta = { title: 'Features/Edit views/Counts/Tests', component: EditView.Counts, tags: ['test'] } satisfies Meta<typeof EditView.Counts>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NamesOnlyTheCountsThatAreNotZero: Story = {
  args: { added: 0, removed: 1 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Removed')).toBeInTheDocument();
    await expect(c.queryByText('Added')).not.toBeInTheDocument();
  },
};

export const SaysHowManyChangedWhenNothingWasAddedOrRemoved: Story = {
  args: { added: 0, removed: 0, changed: 3 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Changed')).toBeInTheDocument();
    await expect(c.getByText('3')).toBeInTheDocument();
  },
};

export const SaysNothingChangedInWords: Story = {
  args: { added: 0, removed: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('nothing')).toBeInTheDocument();
  },
};
