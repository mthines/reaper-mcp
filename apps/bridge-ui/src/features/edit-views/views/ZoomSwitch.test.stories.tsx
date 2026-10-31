import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EditView } from '../index.js';

const meta = {
  title: 'Features/Edit views/ZoomSwitch/Tests',
  component: EditView.ZoomSwitch,
  tags: ['test'],
  args: { zoom: 'change', onChange: fn(), span: '1:04–1:12', total: '3:45' },
} satisfies Meta<typeof EditView.ZoomSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MarksTheChosenSideAndAsksForTheOther: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: /change/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(c.getByRole('button', { name: /whole/i })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(c.getByRole('button', { name: /whole/i }));
    await expect(args.onChange).toHaveBeenLastCalledWith('whole');
  },
};

export const SaysOnHoverWhatEachSideShows: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: /change/i })).toHaveAttribute('title', expect.stringContaining('1:04–1:12'));
    await expect(c.getByRole('button', { name: /whole/i })).toHaveAttribute('title', expect.stringContaining('3:45'));
  },
};
