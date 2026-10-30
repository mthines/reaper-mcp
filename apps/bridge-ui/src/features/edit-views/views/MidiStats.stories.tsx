import type { Meta, StoryObj } from '@storybook/react-vite';
import { editExamples } from '../../../demo/examples.js';
import { StoryCard } from '../../../demo/StoryCard.js';
import { MidiStats } from './MidiStats.js';

const examples = editExamples('midiStats');
const [first] = examples;

const meta = {
  title: 'Features/Edit views/MIDI stats',
  component: MidiStats,
  args: { v: first.v },
  decorators: [(Story) => <div className="measure"><div className="measure-body"><Story /></div></div>],
} satisfies Meta<typeof MidiStats>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [],
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className="measure">
            <div className="measure-body">
              <MidiStats v={x.v} />
            </div>
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

/** The drawer at its narrowest: labels give way, every view stays readable */
export const Narrow: Story = { decorators: [(Story) => <div className="story-narrow drawer-body"><Story /></div>] };
