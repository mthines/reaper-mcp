import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EXAMPLE_NOW, MEASUREMENT_EXAMPLES } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';

const [first] = MEASUREMENT_EXAMPLES;

const meta = {
  title: 'Features/Measurements/MeasurementView',
  component: Measurement,
  args: { entry: first.entry, history: first.history, now: EXAMPLE_NOW, onPick: fn() },
} satisfies Meta<typeof Measurement>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What every measuring command read, the previous call on the same track ghosted where there is one */
export const Default: Story = {
  render: (args) => (
    <div className="story-stack">
      {MEASUREMENT_EXAMPLES.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <code>{x.entry.c}</code>
          <Measurement {...args} entry={x.entry} history={x.history} />
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
