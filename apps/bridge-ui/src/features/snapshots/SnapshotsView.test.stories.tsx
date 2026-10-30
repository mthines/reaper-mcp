import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EXAMPLE_NOW, SNAPSHOT_EXAMPLES } from '../../demo/examples.js';
import { SnapshotsView } from './SnapshotsView.js';

const example = (title: string) => SNAPSHOT_EXAMPLES.find((x) => x.title === title) ?? SNAPSHOT_EXAMPLES[0];
const { feed } = example('List');

const meta = {
  title: 'Features/Snapshots/SnapshotsView/Tests',
  component: SnapshotsView,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { feed, request: null, blocked: null, now: EXAMPLE_NOW, onSend: fn() },
} satisfies Meta<typeof SnapshotsView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LoadsASnapshotOnClick: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /mix-A/ }));
    await expect(args.onSend).toHaveBeenCalledWith('restore', 'mix-A');
  },
};

export const LoadsWithTheNumberKeys: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard('2');
    await expect(args.onSend).toHaveBeenCalledWith('restore', feed?.snapshots[1].name);
  },
};

export const MarksTheLoadedSnapshot: Story = {
  play: async ({ canvasElement }) => {
    const current = within(canvasElement).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'true');
    await expect(current).toHaveTextContent(/mix-B.*Loaded/);
  },
};

export const SavesTheCurrentMix: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Snapshot name'), 'mix-D');
    await userEvent.type(canvas.getByLabelText('Snapshot description'), 'brighter vocal');
    await userEvent.click(canvas.getByRole('button', { name: 'Save current mix' }));
    await expect(args.onSend).toHaveBeenCalledWith('save', 'mix-D', 'brighter vocal');
  },
};

export const AsksOnceBeforeReplacingASnapshot: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Snapshot name'), 'mix-B');
    await userEvent.click(canvas.getByRole('button', { name: 'Save current mix' }));
    await expect(args.onSend).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Replace mix-B' }));
    await expect(args.onSend).toHaveBeenCalledWith('save', 'mix-B', '');
  },
};

export const DeletesAfterConfirmingInTheRow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle('Delete mix-A'));
    const confirm = canvas.getByRole('group', { name: 'Delete mix-A?' });
    await userEvent.click(within(confirm).getByRole('button', { name: /Delete/ }));
    await expect(args.onSend).toHaveBeenCalledWith('delete', 'mix-A');
  },
};

export const RefusesLoadsAndSavesWhileReadOnly: Story = {
  args: { blocked: example('Read-only').blocked },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /mix-A/ }));
    await userEvent.keyboard('1');
    await expect(args.onSend).not.toHaveBeenCalled();
    await expect(canvas.getByLabelText('Snapshot name')).toBeDisabled();
  },
};

export const SaysWhenTheBridgeNeverAnswered: Story = {
  args: { request: example('No answer').request },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/mix-D/)).toBeInTheDocument();
  },
};
