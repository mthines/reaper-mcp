import type { Meta, StoryObj } from '@storybook/react-vite';
import { CloseNotice } from './CloseNotice.js';

const meta = {
  title: 'App/CloseNotice',
  component: CloseNotice,
  args: { secondsLeft: 5, onCancel: () => undefined },
} satisfies Meta<typeof CloseNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="story-stack">
      <CloseNotice {...args} secondsLeft={5} />
      <CloseNotice {...args} secondsLeft={1} />
    </div>
  ),
};

export const Playground: Story = {};
