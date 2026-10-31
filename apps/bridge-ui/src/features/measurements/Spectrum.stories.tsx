import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';
import chartStyles from '../../styles/chart.module.css';

const examples = measuredExamples('spectrum');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/Spectrum',
  component: Measurement.Spectrum,
  args: { m: first.m, previous: first.was?.bands ?? null },
} satisfies Meta<typeof Measurement.Spectrum>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={chartStyles.measure}>
            <Measurement.Spectrum m={x.m} previous={x.was?.bands ?? null} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
