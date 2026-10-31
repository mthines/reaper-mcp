import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Toggle } from './Toggle.js';

const meta = {
  title: 'Components/Toggle',
  component: Toggle,
  args: { label: 'Read-only', hint: 'Only reads, transport and navigation pass', on: false, disabled: false, onChange: fn() },
} satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <Toggle label="On" hint="Open this page when the bridge starts" on onChange={() => undefined} />
      <Toggle label="Off" hint="Open this page when the bridge starts" on={false} onChange={() => undefined} />
      <Toggle label="Disabled" hint="Not available on this platform" on={false} disabled onChange={() => undefined} />
    </div>
  ),
};

export const Playground: Story = {};
