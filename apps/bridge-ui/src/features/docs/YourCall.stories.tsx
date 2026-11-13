import type { Meta, StoryObj } from '@storybook/react-vite';
import { YourCall } from './YourCall.js';

const meta = {
  title: 'Features/Docs/YourCall',
  component: YourCall,
  args: { text: 'Whether any of it is right for the song. It measures; you listen.' },
} satisfies Meta<typeof YourCall>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div style={{ maxWidth: 640 }}>
      <YourCall {...args} />
    </div>
  ),
};

export const Playground: Story = {};
