import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Gallery } from './Gallery.js';
import { GALLERY_EXAMPLE } from './docs-examples.js';

const meta = {
  title: 'Features/Docs/Gallery/Tests',
  component: Gallery,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { title: 'Seven plugins already installed', items: GALLERY_EXAMPLE },
} satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsEveryPluginAsANamedSlide: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole('region', { name: 'Seven plugins already installed' });
    const slides = within(region).getAllByRole('listitem');
    await expect(slides).toHaveLength(GALLERY_EXAMPLE.length);
    await expect(slides[0]).toHaveAccessibleName(`1 of ${GALLERY_EXAMPLE.length}: Tape Sat`);
    await expect(within(slides[0]).getByRole('img', { name: /Tape Sat/ })).toBeInTheDocument();
    await expect(within(region).getByRole('heading', { name: 'Drum Pads' })).toBeInTheDocument();
  },
};

/** At the start there is nothing to go back to */
export const StartsWithPreviousDisabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Next' })).toBeEnabled();
  },
};
