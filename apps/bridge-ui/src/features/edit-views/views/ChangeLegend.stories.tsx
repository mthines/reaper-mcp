import type { Meta, StoryObj } from '@storybook/react-vite';
import { EditView } from '../index.js';
import chartStyles from '../../../styles/chart.module.css';

const meta = {
  title: 'Features/Edit views/Change legend',
  component: EditView.ChangeLegend,
  args: { change: new Map([[0, 'new'], [2, 'moved'], [3, 'changed']]), removed: 1 },
} satisfies Meta<typeof EditView.ChangeLegend>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The marks a list diff puts on rows, the legend that names their colours, and a plain legend */
export const Default: Story = {
  render: (args) => (
    <div className="story-stack">
      <div className="story-row">
        <EditView.ChangeMark c="new" />
        <EditView.ChangeMark c="moved" />
        <EditView.ChangeMark c="changed" />
      </div>
      <EditView.ChangeLegend {...args} />
      <EditView.Legend items={[[chartStyles.lgLine, 'Now'], [chartStyles.lgPrevious, 'Before']]} />
    </div>
  ),
};

export const Playground: Story = {};
