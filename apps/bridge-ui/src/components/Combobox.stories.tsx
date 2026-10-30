import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Combobox, GroupedCombobox } from './Combobox.js';

const RANGES = [
  { value: '5m', label: 'Last 5 minutes', hint: '10 s per bar' },
  { value: '1h', label: 'Last hour', hint: '1 m per bar' },
  { value: '24h', label: 'Last 24 hours', hint: '30 m per bar' },
];

const meta = {
  title: 'Components/Combobox',
  component: Combobox,
  args: { label: 'Timeline range', value: '1h', options: RANGES, onChange: fn() },
  argTypes: { value: { control: 'select', options: RANGES.map((r) => r.value) } },
} satisfies Meta<typeof Combobox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="story-row">
      <Combobox {...args} />
      <GroupedCombobox
        label="View, filters and actions"
        triggerLabel="Calls · Errors"
        groups={[
          { label: 'View', items: [{ key: 'calls', label: 'Calls', selected: true, onPick: () => undefined }, { key: 'tools', label: 'Tools', onPick: () => undefined }] },
          { label: 'Show', items: [{ key: 'errors', label: 'Errors only', selected: true, onPick: () => undefined }] },
        ]}
      />
    </div>
  ),
};

export const Playground: Story = {};
