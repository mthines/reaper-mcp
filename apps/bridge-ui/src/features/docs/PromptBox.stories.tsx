import type { Meta, StoryObj } from '@storybook/react-vite';
import { PromptBox } from './PromptBox.js';

const meta = {
  title: 'Features/Docs/PromptBox',
  component: PromptBox,
  args: { text: '/critique Roast my mix' },
} satisfies Meta<typeof PromptBox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <PromptBox {...args} />
      <PromptBox text="Prep this session from my template: name the tracks, route them to buses, and tell me what you changed." />
    </div>
  ),
};

export const Playground: Story = {};
