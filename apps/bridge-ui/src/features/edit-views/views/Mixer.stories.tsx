import type { Meta, StoryObj } from '@storybook/react-vite';
import { editExamples } from '../../../demo/examples.js';
import { StoryCard } from '../../../demo/StoryCard.js';
import { Mixer } from './Mixer.js';

const examples = editExamples('mixer');
const [first] = examples;

const meta = {
  title: 'Features/Edit views/Mixer',
  component: Mixer,
  args: { v: first.v },
  decorators: [(Story) => <div className="measure"><div className="measure-body"><Story /></div></div>],
} satisfies Meta<typeof Mixer>;
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
              <Mixer v={x.v} />
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
