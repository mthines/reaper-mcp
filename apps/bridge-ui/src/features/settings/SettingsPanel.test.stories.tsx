import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SettingsPanel } from './SettingsPanel.js';

const meta = {
  title: 'Features/Settings/SettingsPanel/Tests',
  component: SettingsPanel,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: {
    settings: { paused: false, readonly: false, openOnStart: true, dev: false },
    notify: false,
    usageStats: { on: true },
    loreToken: null,
    publishToken: null,
    canUpdate: false,
    onSet: fn(),
    onNotify: fn(),
    onUsageStats: fn(),
    onLoreToken: fn(),
    onPublishToken: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof SettingsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WritesABridgeSetting: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByText('Read-only mode'));
    await expect(args.onSet).toHaveBeenCalledWith('cfg_readonly', true);
  },
};

export const TurnsUsageStatisticsOff: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByText('Share usage statistics'));
    await expect(args.onUsageStats).toHaveBeenCalledWith(false);
  },
};

export const OffersNoRestartWhenTheBridgeCannotRelaunch: Story = {
  play: async ({ canvasElement, args }) => {
    const panel = within(canvasElement).getByRole('complementary', { name: 'Settings' });
    await expect(within(panel).queryByRole('button', { name: /Restart/ })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Close settings' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
