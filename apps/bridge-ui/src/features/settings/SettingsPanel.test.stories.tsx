import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Settings } from './index.js';
import { EXAMPLE_FLAG_ROWS } from '../../demo/flag-examples.js';

const meta = {
  title: 'Features/Settings/SettingsPanel/Tests',
  component: Settings,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: {
    settings: { paused: false, readonly: false, openOnStart: true, dev: false, autostart: true },
    autostartInstalled: true,
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
} satisfies Meta<typeof Settings>;
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

export const TurnsStartWithReaperOff: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('switch', { name: /Start with REAPER/ })).toBeChecked();
    await userEvent.click(canvas.getByText('Start with REAPER'));
    await expect(args.onSet).toHaveBeenCalledWith('cfg_autostart', false);
  },
};

export const SaysHowToSetUpStartWithReaperWhenTheStartupScriptLacksIt: Story = {
  args: { autostartInstalled: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch', { name: /Start with REAPER/ });
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(canvas.getByText(/Run reaper-mcp setup in a terminal/)).toBeInTheDocument();
    await expect(args.onSet).not.toHaveBeenCalled();
  },
};

export const HidesStartWithReaperOnBridgesThatDoNotReportIt: Story = {
  args: { settings: { paused: false, readonly: false, openOnStart: true, dev: false }, autostartInstalled: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('switch', { name: /Start with REAPER/ })).toBeNull();
  },
};

export const ShowsTheDeveloperFlagsOnlyInDeveloperMode: Story = {
  args: {
    settings: { paused: false, readonly: false, openOnStart: true, dev: false, autostart: true },
    flags: { rows: EXAMPLE_FLAG_ROWS, onSet: fn(), onResetAll: fn() },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('combobox', { name: 'example-panel variant' })).toBeNull();
  },
};

export const SetsAFlagOverrideInDeveloperMode: Story = {
  args: {
    settings: { paused: false, readonly: false, openOnStart: true, dev: true, autostart: true },
    flags: { rows: EXAMPLE_FLAG_ROWS, onSet: fn(), onResetAll: fn() },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'example-panel variant' }), 'on');
    await expect(args.flags?.onSet).toHaveBeenCalledWith('example-panel', 'on');
    await userEvent.click(canvas.getByRole('button', { name: 'Reset example-forced' }));
    await expect(args.flags?.onSet).toHaveBeenCalledWith('example-forced', null);
  },
};
