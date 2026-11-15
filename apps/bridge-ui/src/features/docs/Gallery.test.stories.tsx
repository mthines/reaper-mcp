import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Gallery } from './Gallery.js';
import { GALLERY_EXAMPLE } from './docs-examples.js';

const meta = {
  title: 'Features/Docs/Gallery/Tests',
  component: Gallery,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { title: 'Seven plugins already installed', items: GALLERY_EXAMPLE },
  // jsdom has no modal <dialog>: give it the two methods the overlay calls, so the stories run in the unit tests too
  beforeEach: () => {
    const proto = HTMLDialogElement.prototype;
    if (!proto.showModal) {
      proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
      proto.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
    }
  },
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

/** The full screen button opens a dialog with every card, on the first one */
export const OpensFullScreenFromTheButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Full screen' }));
    const dialog = await canvas.findByRole('dialog', { name: 'Seven plugins already installed, full screen' });
    await expect(within(dialog).getAllByRole('listitem')).toHaveLength(GALLERY_EXAMPLE.length);
    await expect(within(dialog).getByText('1 / 4')).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Previous' })).toBeDisabled();
  },
};

/** A click on a card's picture opens the full screen view on that card; Esc plays the exit and removes it */
export const OpensOnThePictureAndClosesWithEscape: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Tape Sat, full screen' }));
    await canvas.findByRole('dialog', { name: /full screen/ });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

/** The close button takes the overlay away and leaves the row as it was */
export const ClosesWithTheCloseButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Full screen' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Close full screen' }));
    await waitFor(() => expect(canvas.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(canvas.getByRole('region', { name: 'Seven plugins already installed' })).toBeInTheDocument();
  },
};
