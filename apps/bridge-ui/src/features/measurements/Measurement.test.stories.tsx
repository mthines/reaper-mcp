import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EXAMPLE_NOW, MEASUREMENT_EXAMPLES } from '../../demo/examples.js';
import type { CommandEntry } from '../../lib/commands.js';
import { MeasurementView } from './Measurement.js';

const example = (title: string) => MEASUREMENT_EXAMPLES.find((x) => x.title === title) ?? MEASUREMENT_EXAMPLES[0];
const of = (title: string) => ({ entry: example(title).entry, history: example(title).history });
const entry = (c: string, r: Record<string, unknown>): CommandEntry => ({ n: 1, t: EXAMPLE_NOW, c, ms: 2400, ok: true, r });

const meta = {
  title: 'Features/Measurements/MeasurementView/Tests',
  component: MeasurementView,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { ...of('Loudness · over target'), now: EXAMPLE_NOW, onPick: fn() },
} satisfies Meta<typeof MeasurementView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NamesHowFarLoudnessIsFromTheTarget: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/4\.8 over/)).toBeInTheDocument();
    await expect(canvas.getByText(/over 0/)).toBeInTheDocument();
  },
};

export const OpensThePreviousCallOnTheSameTrack: Story = {
  args: of('Loudness · on target'),
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Previous call · 1m ago/ }));
    await expect(args.onPick).toHaveBeenCalledWith(args.history.find((h) => h.n < args.entry.n));
  },
};

export const ComparesAnOfflineAnalysisWithItsReference: Story = {
  args: of('Offline · against a reference'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/1\.8 LU quieter than the reference/)).toBeInTheDocument();
  },
};

export const KeepsWellFormedSectionsAndSilentBandsOfAnOfflineAnalysis: Story = {
  args: {
    entry: entry('analyze_track_offline', { name: 'Master', lufs: -10.4, lra: 6.8, sections: [[0, 15, -16.2], [15, 30]], bands: [-15, null, -6], res: [[315, 6.2]] }),
    history: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/−10\.4/)).toBeInTheDocument();
    await expect(canvas.getByText(/315 Hz/)).toBeInTheDocument();
  },
};

export const DrawsNothingForAnAnalysisWithoutLoudness: Story = {
  args: { entry: entry('analyze_audio_file', { name: 'x' }), history: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent?.trim()).toBe('');
  },
};

export const SuggestsTheAlignmentFixOnlyWhenSure: Story = {
  args: of('Alignment'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/playOffsetMs −0\.84 · phase inverted/)).toBeInTheDocument();
  },
};

export const SaysWhenAnAlignmentIsTooUnsure: Story = {
  args: of('Alignment · unsure'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/no fix suggested/)).toBeInTheDocument();
    await expect(canvas.queryByText(/playOffsetMs/)).toBeNull();
  },
};

export const ScoresTheFourAestheticsAxes: Story = {
  args: of('Aesthetics'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const axis of ['Production quality', 'Production complexity', 'Content enjoyment', 'Content usefulness']) {
      await expect(canvas.getByText(axis)).toBeInTheDocument();
    }
  },
};
