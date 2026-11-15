import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Developer } from './index.js';
import { EXAMPLE_FLAG_ROWS } from '../../demo/flag-examples.js';

const meta = {
  title: 'Features/Developer/DeveloperPanel/Tests',
  component: Developer,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { rows: EXAMPLE_FLAG_ROWS, onSet: fn(), onResetAll: fn(), onClose: fn() },
} satisfies Meta<typeof Developer>;
export default meta;
type Story = StoryObj<typeof meta>;

const pick = (canvas: ReturnType<typeof within>, flag: string, name: string) =>
  userEvent.click(within(canvas.getByRole('tablist', { name: `${flag} variant` })).getByRole('tab', { name }));

export const ForcesAVariant: Story = {
  play: async ({ canvasElement, args }) => {
    await pick(within(canvasElement), 'example-panel', 'On');
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

export const MarksWhatEachFlagFollowsOrForces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tab = (flag: string, name: string) => within(canvas.getByRole('tablist', { name: `${flag} variant` })).getByRole('tab', { name });
    await expect(tab('example-panel', 'Follow')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('example-forced', 'Follow')).toHaveAttribute('aria-selected', 'false');
    await expect(tab('example-forced', 'On')).toHaveAttribute('aria-selected', 'true');
  },
};

export const FollowsTheRegistryAgainFromFollow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await pick(canvas, 'example-forced', 'Follow');
    await expect(args.onSet).toHaveBeenCalledWith('example-forced', null);
    await userEvent.click(canvas.getByRole('button', { name: /Reset all overrides/ }));
    await expect(args.onResetAll).toHaveBeenCalled();
  },
};

export const SaysSoWhenNoFlagsAreDeclared: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No feature flags are declared.')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Reset all overrides/ })).toBeNull();
  },
};

export const WarnsThatForcingAFlagIsUnsupported: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Forcing one on is unsupported and may break things/)).toBeInTheDocument();
  },
};

export const ClosesFromTheButton: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close developer tools' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const ClosesOnEscape: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
