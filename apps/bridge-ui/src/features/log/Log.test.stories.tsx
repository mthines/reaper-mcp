import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { Log } from './index.js';

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

// A call row is a pressable button showing the time of the call. Matched on its text: a `name` query computes the
// accessible name of every button in the log on each retry, which alone outran the test timeout on a busy machine
const callRows = (canvas: ReturnType<typeof within>) =>
  canvas.queryAllByRole('button', { pressed: false }).filter((b: HTMLElement) => /\d{2}:\d{2}:\d{2}/.test(b.textContent ?? ''));

export const FiltersTheCallsBySearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(callRows(canvas).some((row: HTMLElement) => !/read_track_lufs/.test(row.textContent ?? ''))).toBe(true));
    const search = canvas.getByPlaceholderText('Filter commands or errors');
    await userEvent.clear(search);
    await userEvent.type(search, 'read_track_lufs');
    await waitFor(() => expect(callRows(canvas).length).toBeGreaterThan(0));
    for (const row of callRows(canvas)) await expect(row).toHaveTextContent('read_track_lufs');
  },
};

export const OpensACallInTheDrawerAndClosesIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByPlaceholderText('Filter commands or errors');
    await userEvent.clear(search);
    await userEvent.type(search, 'read_track_lufs');
    await waitFor(() => expect(callRows(canvas).length).toBeGreaterThan(0));
    await userEvent.click(callRows(canvas)[0]);
    const drawer = canvas.getByRole('complementary', { name: 'Details for read_track_lufs' });
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
