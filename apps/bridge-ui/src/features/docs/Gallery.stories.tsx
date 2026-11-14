import type { Meta, StoryObj } from '@storybook/react-vite';
import { Gallery } from './Gallery.js';
import { GALLERY_EXAMPLE } from './docs-examples.js';

const meta = {
  title: 'Features/Docs/Gallery',
  component: Gallery,
  args: { title: 'Seven plugins already installed', items: GALLERY_EXAMPLE },
} satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Cards with and without a picture side by side; the ones without get a name tile */
export const Default: Story = {
  render: (args) => (
    <div style={{ maxWidth: 640 }}>
      <Gallery {...args} />
    </div>
  ),
};

export const Playground: Story = {};
