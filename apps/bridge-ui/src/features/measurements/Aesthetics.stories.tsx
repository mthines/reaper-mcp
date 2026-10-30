import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';

const examples = measuredExamples('aesthetics');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/Aesthetics',
  component: Measurement.Aesthetics,
  args: { m: first.m, was: first.was },
} satisfies Meta<typeof Measurement.Aesthetics>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className="measure">
            <Measurement.Aesthetics m={x.m} was={x.was} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
