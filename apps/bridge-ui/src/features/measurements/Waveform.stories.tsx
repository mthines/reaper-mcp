import type { Meta, StoryObj } from '@storybook/react-vite';
import { measuredExamples } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { Waveform } from './Waveform.js';

const examples = measuredExamples('waveform');
const [first] = examples;

const meta = {
  title: 'Features/Measurements/Waveform',
  component: Waveform,
  args: { m: first.m, entry: first.entry, previous: first.was },
} satisfies Meta<typeof Waveform>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className="measure">
            <Waveform m={x.m} entry={x.entry} previous={x.was} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
