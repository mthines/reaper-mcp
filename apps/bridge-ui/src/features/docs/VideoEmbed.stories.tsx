import type { Meta, StoryObj } from '@storybook/react-vite';
import { VideoEmbed } from './VideoEmbed.js';

const meta = {
  title: 'Features/Docs/VideoEmbed',
  component: VideoEmbed,
  args: { title: 'Install and connect', duration: '3 min' },
} satisfies Meta<typeof VideoEmbed>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Not recorded yet, and one with a video waiting for its play click */
export const Default: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <VideoEmbed {...args} />
      <VideoEmbed {...args} youtube="dQw4w9WgXcQ" />
    </div>
  ),
};

export const Playground: Story = {};
