import type { Meta, StoryObj } from '@storybook/react-vite';
import { Measurement } from './index.js';
import chartStyles from '../../styles/chart.module.css';

const meta = {
  title: 'Features/Measurements/Readout',
  component: Measurement.Readout,
  args: { label: 'Peak L', value: '−9.4', unit: 'dB', zone: 'ok' },
  argTypes: { zone: { control: 'select', options: ['ok', 'hot', 'over'] }, word: { control: 'text' } },
} satisfies Meta<typeof Measurement.Readout>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The measurements' building blocks: a value readout in each zone, a level bar with its previous call, and a dB scale */
export const Default: Story = {
  render: () => (
    <div className={chartStyles.measure}>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Peak L" value="−9.4" unit="dB" />
        <Measurement.Readout label="Peak R" value="−2.6" unit="dB" zone="hot" word="hot" />
        <Measurement.Readout label="True peak" value="+0.4" unit="dBTP" zone="over" word="over 0" />
        <Measurement.Readout label="Width" value="1.12" />
      </div>
      <Measurement.Level label="L" value={-21.3} hold={-9.4} />
      <Measurement.Level label="R" value={-14.2} hold={-2.6} was={{ value: -18.2, hold: -6.8 }} />
      <Measurement.Scale ticks={[-60, -40, -20, -6, 0]} min={-60} max={6} indent />
    </div>
  ),
};

export const Playground: Story = { render: (args) => <div className={chartStyles.measureReadouts}><Measurement.Readout {...args} /></div> };
