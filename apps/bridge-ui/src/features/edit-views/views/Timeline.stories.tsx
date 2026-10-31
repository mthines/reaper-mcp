import type { Meta, StoryObj } from '@storybook/react-vite';
import { editExamples } from '../../../demo/examples.js';
import { StoryCard } from '../../../demo/StoryCard.js';
import { EditView } from '../index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import drawerStyles from '../../../styles/drawer.module.css';

const examples = editExamples('timeline');
const [first] = examples;

const meta = {
  title: 'Features/Edit views/Timeline',
  component: EditView.Timeline,
  args: { v: first.v },
  decorators: [(Story) => <div className={chartStyles.measure}><div className={chartStyles.measureBody}><Story /></div></div>],
} satisfies Meta<typeof EditView.Timeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [],
  render: () => (
    <div className="story-stack">
      {examples.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={chartStyles.measure}>
            <div className={chartStyles.measureBody}>
              <EditView.Timeline v={x.v} />
            </div>
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

/** The drawer at its narrowest: labels give way, every view stays readable */
export const Narrow: Story = { decorators: [(Story) => <div className={cx(drawerStyles.drawerBody, 'story-narrow')}><Story /></div>] };
