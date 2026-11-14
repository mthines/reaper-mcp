import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Settings } from './index.js';
import { EXAMPLE_FLAG_ROWS } from '../../demo/flag-examples.js';

const meta = {
  title: 'Features/Settings/DeveloperSettings/Tests',
  component: Settings.Developer,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { rows: EXAMPLE_FLAG_ROWS, onSet: fn(), onResetAll: fn() },
} satisfies Meta<typeof Settings.Developer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ForcesAVariant: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'example-panel variant' }), 'on');
    await expect(args.onSet).toHaveBeenCalledWith('example-panel', 'on');
  },
};

export const ShowsHowEachFlagResolves: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('off · static')).toBeInTheDocument();
    await expect(canvas.getByText('control · split')).toBeInTheDocument();
    await expect(canvas.getByText('on · override')).toBeInTheDocument();
    await expect(canvas.getByText('Experiment: control 90% / wide 10%')).toBeInTheDocument();
  },
};

export const ResetsAnOverrideOnlyWhereOneIsSet: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Reset example-panel' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Reset example-forced' }));
    await expect(args.onSet).toHaveBeenCalledWith('example-forced', null);
    await userEvent.click(canvas.getByRole('button', { name: 'Reset all overrides' }));
    await expect(args.onResetAll).toHaveBeenCalled();
  },
};

export const FollowsTheRegistryAgainFromTheSelect: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.selectOptions(within(canvasElement).getByRole('combobox', { name: 'example-forced variant' }), 'Follow the registry');
    await expect(args.onSet).toHaveBeenCalledWith('example-forced', null);
  },
};

export const SaysSoWhenNoFlagsAreDeclared: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No feature flags are declared.')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Reset all overrides' })).toBeNull();
  },
};
