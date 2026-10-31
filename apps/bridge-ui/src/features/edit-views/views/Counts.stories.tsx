import type { Meta, StoryObj } from '@storybook/react-vite';
import { StoryCard } from '../../../demo/StoryCard.js';
import { EditView } from '../index.js';
import chartStyles from '../../../styles/chart.module.css';

const cases = [
  { title: 'Added and removed', note: 'One readout per count that is not zero', args: { added: 2, removed: 1 } },
  { title: 'Only removed', note: 'No "Added 0"', args: { added: 0, removed: 3 } },
  { title: 'Edited in place', note: 'Nothing added or removed: how many changed', args: { added: 0, removed: 0, changed: 4 } },
  { title: 'Nothing changed', note: 'Says so in words', args: { added: 0, removed: 0 } },
];

const meta = {
  title: 'Features/Edit views/Counts',
  component: EditView.Counts,
  args: cases[0].args,
  decorators: [(Story) => <div className={chartStyles.measureReadouts}><Story /></div>],
} satisfies Meta<typeof EditView.Counts>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [],
  render: () => (
    <div className="story-stack">
      {cases.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={chartStyles.measureReadouts}>
            <EditView.Counts {...x.args} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
