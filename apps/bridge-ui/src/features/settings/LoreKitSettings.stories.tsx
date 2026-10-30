import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { LoreKitSetting, PublishSetting } from './LoreKitSettings.js';

const meta = {
  title: 'Features/Settings/LoreKitSettings',
  component: LoreKitSetting,
  args: { token: null, onChange: fn() },
  argTypes: { token: { control: 'text' } },
} satisfies Meta<typeof LoreKitSetting>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Your own plugin records (a read-only token) and publishing to the built-in layer (a writer token) */
export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <LoreKitSetting token={null} onChange={() => undefined} />
      <LoreKitSetting token="lk_ro_example" onChange={() => undefined} />
      <PublishSetting token={null} readToken="lk_ro_example" onChange={() => undefined} />
      <PublishSetting token="lk_rw_example" readToken="lk_ro_example" onChange={() => undefined} />
    </div>
  ),
};

export const Playground: Story = {};
