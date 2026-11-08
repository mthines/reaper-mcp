import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Settings } from './index.js';

const meta = {
  title: 'Features/Settings/SettingsPanel',
  component: Settings,
  args: {
    settings: { paused: false, readonly: false, openOnStart: true, dev: false, autostart: true },
    autostartInstalled: true,
    notify: false,
    usageStats: { on: true },
    loreToken: null,
    publishToken: null,
    canUpdate: true,
    onSet: fn(),
    onNotify: fn(),
    onUsageStats: fn(),
    onLoreToken: fn(),
    onPublishToken: fn(),
    onClose: fn(),
    onRestart: fn(),
  },
  decorators: [(Story) => <div className="story-drawer"><Story /></div>],
} satisfies Meta<typeof Settings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playground: Story = {};

export const ReadOnlyAndPaused: Story = { args: { settings: { paused: true, readonly: true, openOnStart: false, dev: true, autostart: false } } };

/** setup has not written the startup block in this REAPER yet: the toggle says how, and can't be turned on */
export const StartWithReaperNotSetUp: Story = { args: { autostartInstalled: false } };

export const ConnectedToLoreKit: Story = { args: { loreToken: 'lk_ro_example', publishToken: 'lk_rw_example' } };
