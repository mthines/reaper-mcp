import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';
import chartStyles from '../../styles/chart.module.css';

const examples = measuredExamples('masking');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/Masking',
  component: Measurement.Masking,
  args: { m: first.m },
} satisfies Meta<typeof Measurement.Masking>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={chartStyles.measure}>
            <Measurement.Masking m={x.m} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
