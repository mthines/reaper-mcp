import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { Log } from './Log.js';

const { log, sessions } = exampleFeed();

const meta = {
  title: 'Features/Log/Log/Tests',
  component: Log,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: {
    log,
    selection: null,
    rangeKey: '1h',
    oldestKept: log[log.length - 1]?.t ?? null,
    sessions,
    view: 'calls',
    paused: false,
    now: EXAMPLE_NOW,
    onRange: fn(),
    onClearSelection: fn(),
    onView: fn(),
    onTogglePause: fn(),
    onClear: fn(),
  },
} satisfies Meta<typeof Log>;
export default meta;
type Story = StoryObj<typeof meta>;

const commandsShown = (el: HTMLElement) => [...el.querySelectorAll('.row-cmd')].map((n) => n.textContent);

export const FiltersTheCallsBySearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText('Filter commands or errors'), 'read_track_lufs');
    await waitFor(() => expect(commandsShown(canvasElement).length).toBeGreaterThan(0));
    await expect(new Set(commandsShown(canvasElement))).toEqual(new Set(['read_track_lufs']));
  },
};

export const OpensACallInTheDrawerAndClosesIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first] = canvas.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('row-main'));
    const command = first.querySelector('.row-cmd')?.textContent ?? '';
    await userEvent.click(first);
    const drawer = canvas.getByRole('complementary', { name: `Details for ${command}` });
    await expect(drawer).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close details' }));
    await expect(canvas.queryByRole('complementary', { name: /Details for/ })).toBeNull();
  },
};

export const PausesAndClears: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Pause/ }));
    await expect(args.onTogglePause).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: /Clear/ }));
    await expect(args.onClear).toHaveBeenCalled();
  },
};
