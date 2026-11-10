import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { EXAMPLE_NOW, MEASUREMENT_EXAMPLES } from '../../demo/examples.js';
import type { CommandEntry } from '../../lib/commands.js';
import { Measurement } from './index.js';

const example = (title: string) => MEASUREMENT_EXAMPLES.find((x) => x.title === title) ?? MEASUREMENT_EXAMPLES[0];
const of = (title: string) => ({ entry: example(title).entry, history: example(title).history });
const entry = (c: string, r: Record<string, unknown>): CommandEntry => ({ n: 1, t: EXAMPLE_NOW, c, ms: 2400, ok: true, r });

const meta = {
  title: 'Features/Measurements/MeasurementView/Tests',
  component: Measurement,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { ...of('Loudness · over target'), now: EXAMPLE_NOW, onPick: fn() },
} satisfies Meta<typeof Measurement>;
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
    await expect(within(canvasElement).getByText(/Fix: play offset/).textContent).toMatch(/−0\.84 ms, polarity inverted/);
  },
};

export const SaysWhenAnAlignmentIsTooUnsure: Story = {
  args: of('Alignment · unsure'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/no fix suggested/)).toBeInTheDocument();
    await expect(canvas.queryByText(/Fix: play offset/)).toBeNull();
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

const keyCall = (n: number, conf: number): CommandEntry =>
  ({ n, t: EXAMPLE_NOW - (2 - n) * 60_000, c: 'detect_key', ms: 1, ok: true, r: { key: 'A minor', tonic: 'A', mode: 'minor', r: 0.8, conf, chroma: [1, 0, 0, 0, 0.5, 0, 0, 0.6, 0, 0.9, 0, 0] } });

/** A key's headline is a percentage, so the previous call reads in whole percent like the readout */
export const ShowsTheKeysPreviousConfidenceInPercent: Story = {
  args: { entry: keyCall(2, 0.6), history: [keyCall(2, 0.6), keyCall(1, 0.45)] },
  play: async ({ canvasElement }) => {
    const previous = within(canvasElement).getByRole('button', { name: /Previous call/ });
    await expect(previous.textContent).toMatch(/Confidence 45 → 60 %\s*▲ 15 %/);
    await expect(previous.textContent).not.toMatch(/0\.45/);
  },
};

export const ShowsThePreviousAndNewLoudnessOnHover: Story = {
  args: of('Loudness · on target'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByRole('img', { name: /^Integrated/ }));
    await expect((await canvas.findByRole('tooltip')).textContent).toMatch(/Integrated −[\d.]+ → −[\d.]+ LUFS [▲▼] [\d.]+ LU/);
  },
};

export const ShowsABandsShareOnHover: Story = {
  args: {
    entry: entry('analyze_track_offline', { name: 'Master', lufs: -10.4, sections: [[0, 15, -11], [15, 30, -10]], bands: [-15, -6] }),
    history: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByText('Bass'));
    await expect((await canvas.findByRole('tooltip')).textContent).toMatch(/Bass · 60–250 Hz\s*−6\.0 dB of the energy/);
    await userEvent.unhover(canvas.getByText('Bass'));
    await waitFor(() => expect(canvas.queryByRole('tooltip')).toBeNull());
  },
};

export const DrawsOneWaveformPerRenderedTrackAndNamesClipping: Story = {
  args: of('Waveforms · clipped, more tracks'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('img', { name: /^Waveform of / })).toHaveLength(8);
    await expect(canvas.getByRole('img', { name: /^Waveform of Drums, peak .* 41 clipped samples$/ })).toBeInTheDocument();
    await expect(canvas.getByText('+4 more tracks rendered, not drawn')).toBeInTheDocument();
    await expect(canvas.getByText(/Clipping/)).toBeInTheDocument();
  },
};

export const ShowsATracksPeakAndTheOneBeforeOnHover: Story = {
  args: of('Waveforms'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByText('Kick'));
    const tip = (await canvas.findByRole('tooltip')).textContent ?? '';
    await expect(tip).toMatch(/Peak −?[\d.]+ dBFS · RMS −[\d.]+ dBFS/);
    await expect(tip).toMatch(/Previous call: peak/);
  },
};

const lanes = (peak: number) => [{ name: 'Kick', hi: Array(60).fill(peak), lo: Array(60).fill(-peak), peakDb: -6, rmsDb: -12, clipped: 0 }];
const waves = (n: number, r: Record<string, unknown>): CommandEntry => ({ ...entry('render_tracks_to_wav', { durationSeconds: 5, tracks: lanes(0.5), ...r }), n, p: '{"startTime":30}' });

export const MarksAClippedCountFromALongRenderAsAnEstimate: Story = {
  args: { entry: waves(2, { start: 30, approx: 1, tracks: [{ ...lanes(1)[0], clipped: 400 }] }), history: [] },
  play: async ({ canvasElement }) => {
    const readout = within(canvasElement).getByText('Clipped').parentElement as HTMLElement;
    await expect(readout).toHaveTextContent('~400');
    await expect(readout.getAttribute('title')).toMatch(/estimate/);
  },
};

export const OnlyDrawsThePreviousCallOverTheSameRange: Story = {
  args: { entry: waves(2, { start: 30 }), history: [waves(2, { start: 30 }), waves(1, { start: 90 })] },
  play: async ({ canvasElement }) => {
    // An earlier render of other seconds is other audio: no ghost, no legend entry for one
    await expect(within(canvasElement).queryByText('Previous call', { selector: 'span' })).toBeNull();
  },
};
