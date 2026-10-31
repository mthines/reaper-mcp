import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';
import chartStyles from '../../styles/chart.module.css';

const examples = measuredExamples('curve');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/LoudnessCurve',
  component: Measurement.LoudnessCurve,
  args: { m: first.m, was: first.was },
} satisfies Meta<typeof Measurement.LoudnessCurve>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={chartStyles.measure}>
            <Measurement.LoudnessCurve m={x.m} was={x.was} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
