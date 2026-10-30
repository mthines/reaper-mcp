import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SettingsPanel } from './SettingsPanel.js';

const meta = {
  title: 'Features/Settings/SettingsPanel',
  component: SettingsPanel,
  args: {
    settings: { paused: false, readonly: false, openOnStart: true, dev: false },
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
} satisfies Meta<typeof SettingsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playground: Story = {};

export const ReadOnlyAndPaused: Story = { args: { settings: { paused: true, readonly: true, openOnStart: false, dev: true } } };

export const ConnectedToLoreKit: Story = { args: { loreToken: 'lk_ro_example', publishToken: 'lk_rw_example' } };
