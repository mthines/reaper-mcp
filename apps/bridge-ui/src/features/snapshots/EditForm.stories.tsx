import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SNAPSHOT_EXAMPLES } from '../../demo/examples.js';
import { EditForm } from './EditForm.js';

const snapshots = SNAPSHOT_EXAMPLES[0].feed?.snapshots ?? [];

const meta = {
  title: 'Features/Snapshots/EditForm',
  component: EditForm,
  args: { snapshot: snapshots[1], snapshots, onSave: fn(), onCancel: fn() },
} satisfies Meta<typeof EditForm>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Rename a snapshot or change its description, in place of its row */
export const Default: Story = {};

export const Playground: Story = {};

export const RenamesASnapshot: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const name = canvas.getAllByRole('textbox')[0];
    await userEvent.clear(name);
    await userEvent.type(name, 'mix-B final{Enter}');
    await expect(args.onSave).toHaveBeenCalledWith('mix-B final', expect.any(String));
  },
};
