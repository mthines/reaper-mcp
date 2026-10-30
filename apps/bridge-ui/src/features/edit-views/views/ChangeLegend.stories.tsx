import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChangeLegend, ChangeMark, Legend } from './ChangeLegend.js';

const meta = {
  title: 'Features/Edit views/Change legend',
  component: ChangeLegend,
  args: { change: new Map([[0, 'new'], [2, 'moved'], [3, 'changed']]), removed: 1 },
} satisfies Meta<typeof ChangeLegend>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The marks a list diff puts on rows, the legend that names their colours, and a plain legend */
export const Default: Story = {
  render: (args) => (
    <div className="story-stack">
      <div className="story-row">
        <ChangeMark c="new" />
        <ChangeMark c="moved" />
        <ChangeMark c="changed" />
      </div>
      <ChangeLegend {...args} />
      <Legend items={[['lg-line', 'Now'], ['lg-previous', 'Before']]} />
    </div>
  ),
};

export const Playground: Story = {};
