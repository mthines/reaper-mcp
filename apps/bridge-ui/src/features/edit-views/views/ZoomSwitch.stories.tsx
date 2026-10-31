import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import { StoryCard } from '../../../demo/StoryCard.js';
import type { Zoom } from '../../../lib/zoom.js';
import { EditView } from '../index.js';

const meta = {
  title: 'Features/Edit views/ZoomSwitch',
  component: EditView.ZoomSwitch,
  args: { zoom: 'change', onChange: fn(), span: '1:04–1:12', total: '3:45' },
} satisfies Meta<typeof EditView.ZoomSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

function Live({ start }: { start: Zoom }) {
  const [zoom, setZoom] = useState<Zoom>(start);
  return <EditView.ZoomSwitch zoom={zoom} onChange={setZoom} span="1:04–1:12" total="3:45" />;
}

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <StoryCard title="Around the change" note="The default: zoomed in on what the call touched">
        <Live start="change" />
      </StoryCard>
      <StoryCard title="Whole project" note="Shows where the change sits">
        <Live start="whole" />
      </StoryCard>
    </div>
  ),
};

export const Playground: Story = {};
