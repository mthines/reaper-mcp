import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';
import chartStyles from '../../../styles/chart.module.css';

const byCommand = (c: string) => {
  const x = editExamples('timeline').find((e) => e.entry.c === c);
  if (!x) throw new Error(`no timeline example for ${c}`);
  return x.v;
};
const cut = editExamples('timeline').find((x) => x.entry.c === 'remove_time') ?? editExamples('timeline')[0];

const meta = {
  title: 'Features/Edit views/Timeline/Tests',
  component: EditView.Timeline,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { v: cut.v },
  decorators: [(Story) => <div className={chartStyles.measure}><div className={chartStyles.measureBody}><Story /></div></div>],
} satisfies Meta<typeof EditView.Timeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ZoomsToTheChangeAndShowsTheWholeProjectOnRequest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^2:16–2:48 of 3:20$/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Whole' }));
    await expect(canvas.getByText(/^0:00–3:20, the whole project$/)).toBeInTheDocument();
    await expect(canvas.getByText('0:00')).toBeInTheDocument();
    // The choice is remembered for the next view, and the next visit
    await expect(localStorage.getItem('mcp-bridge-zoom')).toBe('whole');
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }));
    await expect(canvas.getByText(/^2:16–2:48/)).toBeInTheDocument();
  },
};

export const ANewTempoMarkerReadsAsTheChangeAtItNotTheWholeMap: Story = {
  args: { v: byCommand('add_tempo_marker') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('92 → 88')).toBeInTheDocument();
    await expect(c.getByText('4/4 → 3/4')).toBeInTheDocument();
    await expect(c.queryByText('88–92')).not.toBeInTheDocument();
  },
};

export const ADeletedTempoMarkerReadsAsTheTempoComingBack: Story = {
  args: { v: byCommand('delete_tempo_marker') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('88 → 92')).toBeInTheDocument();
    await expect(c.getByText('3/4 → 4/4')).toBeInTheDocument();
  },
};

export const TheTempoMapListedShowsItsRange: Story = {
  args: { v: byCommand('get_tempo_map') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/^\d+–\d+$/)).toBeInTheDocument();
  },
};

export const HoveringTheTempoLaneShowsTheNearestMarker: Story = {
  args: { v: byCommand('add_tempo_marker') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const lane = c.getByRole('img', { name: /^Tempo from/ }).parentElement as HTMLElement;
    await fireEvent.pointerMove(lane, { clientX: 0 });
    await expect(await c.findByRole('tooltip')).toHaveTextContent(/\d+ BPM/);
    await userEvent.unhover(lane);
    await expect(c.queryByRole('tooltip')).not.toBeInTheDocument();
  },
};
