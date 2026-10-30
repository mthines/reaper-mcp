import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Settings } from './index.js';

const meta = {
  title: 'Features/Settings/LoreKitSettings',
  component: Settings.LoreKit,
  args: { token: null, onChange: fn() },
  argTypes: { token: { control: 'text' } },
} satisfies Meta<typeof Settings.LoreKit>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Your own plugin records (a read-only token) and publishing to the built-in layer (a writer token) */
export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <Settings.LoreKit token={null} onChange={() => undefined} />
      <Settings.LoreKit token="lk_ro_example" onChange={() => undefined} />
      <Settings.Publish token={null} readToken="lk_ro_example" onChange={() => undefined} />
      <Settings.Publish token="lk_rw_example" readToken="lk_ro_example" onChange={() => undefined} />
    </div>
  ),
};

export const Playground: Story = {};
