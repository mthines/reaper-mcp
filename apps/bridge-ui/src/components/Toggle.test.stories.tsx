import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Toggle } from './Toggle.js';

function Controlled({ onChange, disabled }: { onChange: (on: boolean) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  const change = (v: boolean) => {
    setOn(v);
    onChange(v);
  };
  return <Toggle label="Read-only" hint="Only reads pass" on={on} disabled={disabled} onChange={change} />;
}

const meta = {
  title: 'Components/Toggle/Tests',
  component: Controlled,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { onChange: fn() },
} satisfies Meta<typeof Controlled>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SwitchesOnAndOff: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch', { name: /Read-only/ });
    // The input sits under its drawn switch: people click the label
    await userEvent.click(canvas.getByText('Read-only'));
    await expect(toggle).toBeChecked();
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(canvas.getByText('Read-only'));
    await expect(toggle).not.toBeChecked();
    await expect(args.onChange).toHaveBeenLastCalledWith(false);
  },
};

export const IgnoresClicksWhileDisabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Read-only'));
    await expect(canvas.getByRole('switch', { name: /Read-only/ })).not.toBeChecked();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};
