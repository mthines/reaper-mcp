import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Settings } from './index.js';

const meta = {
  title: 'Features/Settings/LoreKitSettings/Tests',
  component: Settings.LoreKit,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { token: null, onChange: fn() },
} satisfies Meta<typeof Settings.LoreKit>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RefusesATokenThatCouldWrite: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('LoreKit read-only token'), 'lk_rw_secret{Enter}');
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const SavesAReadOnlyToken: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('LoreKit read-only token'), 'lk_ro_abc123{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('lk_ro_abc123');
  },
};
