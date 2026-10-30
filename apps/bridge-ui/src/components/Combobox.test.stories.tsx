import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Combobox, GroupedCombobox } from './Combobox.js';

const RANGES = [
  { value: '5m', label: 'Last 5 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
];

function Range({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('1h');
  const change = (v: string) => {
    setValue(v);
    onChange(v);
  };
  return <Combobox label="Timeline range" value={value} options={RANGES} onChange={change} />;
}

const meta = {
  title: 'Components/Combobox/Tests',
  component: Range,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { onChange: fn() },
} satisfies Meta<typeof Range>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PicksWithTheKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Timeline range: Last hour' });
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    // Opens on the selected option
    await expect(canvas.getByRole('option', { name: /Last hour/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('24h');
    await expect(canvas.queryByRole('listbox')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Timeline range: Last 24 hours' })).toBeInTheDocument();
  },
};

export const ClosesWithEscapeAndKeepsTheValue: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Timeline range: Last hour' }));
    await expect(canvas.getByRole('listbox', { name: 'Timeline range' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowUp}{Escape}');
    await expect(canvas.queryByRole('listbox')).toBeNull();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const PicksFromTheMouse: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Timeline range/ }));
    await userEvent.click(canvas.getByRole('option', { name: /Last 5 minutes/ }));
    await expect(args.onChange).toHaveBeenCalledWith('5m');
  },
};

export const GroupedNamesItsChoicesAndRunsThePickedItem: Story = {
  render: (args) => (
    <GroupedCombobox
      label="View, filters and actions"
      triggerLabel="Calls · Errors"
      groups={[
        { label: 'View', items: [{ key: 'calls', label: 'Calls', selected: true, onPick: () => undefined }, { key: 'tools', label: 'Tools', onPick: () => args.onChange('tools') }] },
        { label: 'Actions', items: [] },
      ]}
    />
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'View, filters and actions: Calls · Errors' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(canvas.queryByRole('listbox')).toBeNull(); // closed until opened
    await userEvent.click(trigger);
    await expect(canvas.getByRole('group', { name: 'View' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('option', { name: /Tools/ }));
    await expect(args.onChange).toHaveBeenCalledWith('tools');
  },
};
