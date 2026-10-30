import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mark } from './Mark.js';

const meta = {
  title: 'Components/Mark',
  component: Mark,
  args: { active: true },
} satisfies Meta<typeof Mark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The logo; the eye blinks while the bridge is live. Click it to blink and follow the cursor. */
export const Default: Story = {
  render: () => (
    <div className="story-row">
      <Mark active />
      <Mark active={false} />
    </div>
  ),
};

export const Playground: Story = {};
