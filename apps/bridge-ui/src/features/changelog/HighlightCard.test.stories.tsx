import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Changelog } from './index.js';
import { EXAMPLE_HIGHLIGHTS } from './highlight-examples.js';

const meta = {
  title: 'Features/Changelog/Highlight/Tests',
  component: Changelog.Highlight,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { highlight: EXAMPLE_HIGHLIGHTS[1] },
} satisfies Meta<typeof Changelog.Highlight>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsTheFeatureAndWhereToTryIt: Story = {
  args: { highlight: EXAMPLE_HIGHLIGHTS[0] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('What’s new, right on the bridge page')).toBeInTheDocument();
    await expect(canvas.getByLabelText('The Update available pill opens the What’s new drawer')).toBeInTheDocument();
    await expect(canvas.getByText('⌘K → What’s new')).toBeInTheDocument();
  },
};

export const EnlargesAndClosesWithEscape: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const onWindowEscape = fn();
    const listener = (ev: KeyboardEvent) => ev.key === 'Escape' && onWindowEscape();
    window.addEventListener('keydown', listener);
    await userEvent.click(page.getByRole('button', { name: 'Enlarge: Sends render in one pass' }));
    await expect(page.getByRole('dialog', { name: 'Sends render in one pass' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect(page.queryByRole('dialog')).not.toBeInTheDocument();
    // Escape closed the enlarged view only, not the drawer around it (which listens on window)
    await expect(onWindowEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', listener);
  },
};

export const KeyboardFocusMovesIntoAndBackOutOfTheEnlargedView: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const enlarge = page.getByRole('button', { name: 'Enlarge: Sends render in one pass' });
    enlarge.focus();
    await userEvent.keyboard('{Enter}');
    await expect(page.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(page.queryByRole('dialog')).not.toBeInTheDocument();
    await expect(enlarge).toHaveFocus();
  },
};

/** An animated SVG has no player to pause, so with reduced motion both the card and its enlarged view show the poster */
export const ReducedMotionShowsThePosterWhenEnlarged: Story = {
  args: {
    highlight: {
      id: 'teach-mode',
      pr: 98,
      kind: 'animation',
      group: 'new',
      title: 'Learn REAPER while the agent works',
      blurb: 'Every change comes with what it did and how to do it by hand.',
      media: '/changelog/media/teach.svg',
      poster: '/changelog/media/teach.webp',
      alt: 'One change explained four ways',
    },
  },
  beforeEach: () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = real;
    };
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByAltText('One change explained four ways')).toHaveAttribute('src', '/changelog/media/teach.webp');
    await userEvent.click(page.getByRole('button', { name: 'Enlarge: Learn REAPER while the agent works' }));
    const dialog = within(page.getByRole('dialog', { name: 'Learn REAPER while the agent works' }));
    await expect(dialog.getByAltText('One change explained four ways')).toHaveAttribute('src', '/changelog/media/teach.webp');
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
  },
};
