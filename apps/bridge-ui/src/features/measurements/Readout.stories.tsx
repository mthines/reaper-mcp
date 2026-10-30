import type { Meta, StoryObj } from '@storybook/react-vite';
import { Level, Readout, Scale } from './Readout.js';

const meta = {
  title: 'Features/Measurements/Readout',
  component: Readout,
  args: { label: 'Peak L', value: '−9.4', unit: 'dB', zone: 'ok' },
  argTypes: { zone: { control: 'select', options: ['ok', 'hot', 'over'] }, word: { control: 'text' } },
} satisfies Meta<typeof Readout>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The measurements' building blocks: a value readout in each zone, a level bar with its previous call, and a dB scale */
export const Default: Story = {
  render: () => (
    <div className="measure">
      <div className="measure-readouts">
        <Readout label="Peak L" value="−9.4" unit="dB" />
        <Readout label="Peak R" value="−2.6" unit="dB" zone="hot" word="hot" />
        <Readout label="True peak" value="+0.4" unit="dBTP" zone="over" word="over 0" />
        <Readout label="Width" value="1.12" />
      </div>
      <Level label="L" value={-21.3} hold={-9.4} />
      <Level label="R" value={-14.2} hold={-2.6} was={{ value: -18.2, hold: -6.8 }} />
      <Scale ticks={[-60, -40, -20, -6, 0]} min={-60} max={6} indent />
    </div>
  ),
};

export const Playground: Story = { render: (args) => <div className="measure-readouts"><Readout {...args} /></div> };
