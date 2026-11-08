import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import drawerStyles from '../../styles/drawer.module.css';

const examples = measuredExamples('waveforms');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/Waveforms',
  component: Measurement.Waveforms,
  args: { m: first.m, entry: first.entry, previous: first.was },
} satisfies Meta<typeof Measurement.Waveforms>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={chartStyles.measure}>
            <Measurement.Waveforms m={x.m} entry={x.entry} previous={x.was} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

export const Narrow: Story = {
  decorators: [(Story) => <div className={cx(drawerStyles.drawerBody, 'story-narrow')}><div className={chartStyles.measure}><Story /></div></div>],
};
