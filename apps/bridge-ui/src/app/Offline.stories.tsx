import type { Meta, StoryObj } from '@storybook/react-vite';
import { Offline } from './Offline.js';

const meta = {
  title: 'App/Offline',
  component: Offline,
  args: { reachable: true },
} satisfies Meta<typeof Offline>;
export default meta;
type Story = StoryObj<typeof meta>;

/** REAPER answers but the bridge script isn't running, or REAPER's web interface doesn't answer at all */
export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <Offline reachable />
      <Offline reachable={false} />
    </div>
  ),
};

export const Playground: Story = {};
