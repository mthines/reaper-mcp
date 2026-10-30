import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Measurement } from './index.js';

const examples = measuredExamples('lufs');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/Loudness',
  component: Measurement.Loudness,
  args: { m: first.m, target: -14, was: first.was?.integrated },
} satisfies Meta<typeof Measurement.Loudness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className="measure">
            <Measurement.Loudness m={x.m} target={x.title.includes('no target') ? null : -14} was={x.was?.integrated} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
