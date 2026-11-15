import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Settings } from './index.js';
import { EXAMPLE_FLAG_ROWS } from '../../demo/flag-examples.js';

const meta = {
  title: 'Features/Settings/DeveloperSettings',
  component: Settings.Developer,
  args: { rows: EXAMPLE_FLAG_ROWS, onSet: fn(), onResetAll: fn() },
  decorators: [(Story) => <div className="story-drawer"><Story /></div>],
} satisfies Meta<typeof Settings.Developer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Resolved by default, by a running split, and forced by the viewer */
export const Default: Story = {};

export const Playground: Story = {};

export const NoFlagsDeclared: Story = { args: { rows: [] } };

export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>] };
