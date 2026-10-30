import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ResizeHandle } from './ResizeHandle.js';

/** The handle as the drawer uses it: the committed width is kept and fed back */
function Drawer({ initial, onCommit }: { initial: number | null; onCommit: (f: number | null) => void }) {
  const [fraction, setFraction] = useState(initial);
  const commit = (f: number | null) => {
    setFraction(f);
    onCommit(f);
  };
  return (
    <div className="story-drawer">
      <aside className="drawer">
        <ResizeHandle fraction={fraction} onCommit={commit} />
      </aside>
    </div>
  );
}

const meta = {
  title: 'Components/ResizeHandle/Tests',
  component: Drawer,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { initial: null, onCommit: fn() },
} satisfies Meta<typeof Drawer>;
export default meta;
type Story = StoryObj<typeof meta>;

const handle = (el: HTMLElement) => within(el).getByRole('separator', { name: 'Resize sidebar' });
const width = (el: HTMLElement) => Number(handle(el).getAttribute('aria-valuenow'));

export const WidensWithTheLeftArrowAndNarrowsWithTheRight: Story = {
  play: async ({ canvasElement, args }) => {
    const before = width(canvasElement);
    handle(canvasElement).focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(width(canvasElement)).toBeGreaterThan(before);
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{ArrowRight}');
    await expect(width(canvasElement)).toBe(before);
  },
};

export const JumpsToTheNarrowestWithHomeAndTheWidestWithEnd: Story = {
  play: async ({ canvasElement }) => {
    const sep = handle(canvasElement);
    sep.focus();
    await userEvent.keyboard('{Home}');
    await expect(width(canvasElement)).toBe(Number(sep.getAttribute('aria-valuemin')));
    await userEvent.keyboard('{End}');
    await expect(width(canvasElement)).toBe(Number(sep.getAttribute('aria-valuemax')));
  },
};

export const ResetsOnDoubleClick: Story = {
  args: { initial: 0.5 },
  play: async ({ canvasElement, args }) => {
    await userEvent.dblClick(handle(canvasElement));
    await expect(args.onCommit).toHaveBeenLastCalledWith(null);
    await expect(width(canvasElement)).toBe(400);
  },
};
