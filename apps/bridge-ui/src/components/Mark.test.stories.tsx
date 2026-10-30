import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Mark } from './Mark.js';

const meta = {
  title: 'Components/Mark/Tests',
  component: Mark,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { active: true },
} satisfies Meta<typeof Mark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ClickTogglesWatching: Story = {
  play: async ({ canvasElement }) => {
    const mark = within(canvasElement).getByRole('button', { name: 'reaper-mcp' });
    await expect(mark).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(mark);
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(mark);
    await expect(mark).toHaveAttribute('aria-pressed', 'false');
  },
};
