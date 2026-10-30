import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { EDIT_EXAMPLES } from '../../demo/examples.js';
import type { CommandEntry } from '../../lib/commands.js';
import { EditViewSection } from './EditViews.js';

const example = (title: string) => (EDIT_EXAMPLES.find((x) => x.title === title) ?? EDIT_EXAMPLES[0]).entry;
const entry = (c: string, r: Record<string, unknown>, ok = true): CommandEntry => ({ n: 1, t: 0, c, ms: 1, ok, r });
const markers = [[8, 'Drop', '', 1], [40, 'Outro', '', 2]];
const tempo = [[0, 120, 4, 4, 0]];

const meta = {
  title: 'Features/Edit views/EditViewSection/Tests',
  component: EditViewSection,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { entry: example('Track volume') },
} satisfies Meta<typeof EditViewSection>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsAWriteAsBeforeAndAfter: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('region', { name: 'Change' });
    await expect(card.textContent).toMatch(/Kick\s*Volume\s*−6\.0 dB\s*→\s*−4\.5 dB/);
  },
};

export const ShowsAListingAsAResult: Story = {
  args: { entry: example('Mixer') },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('region', { name: 'Result' });
    await expect(within(card).getByText('Kick')).toBeInTheDocument();
  },
};

export const DrawsNothingForAFailedCallOrAnotherCommand: Story = {
  args: { entry: { ...example('Track volume'), ok: false, e: 'Track 9 not found' } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent?.trim()).toBe('');
  },
};

export const LabelsMarkersWhenTheyAreWhatTheCallIsAbout: Story = {
  args: { entry: entry('list_markers', { regions: [], markers, tempo, len: 60 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Drop')).toBeVisible();
    await expect(canvas.getByText('Outro')).toBeVisible();
  },
};

/** Markers are only context on an items view: their names wait for hover (a tooltip), leaving room for the items */
export const KeepsMarkerNamesForHoverOnAnItemsView: Story = {
  args: { entry: entry('list_media_items', { regions: [], markers, tempo, len: 60, lanes: [{ t: 'Keys', items: [[0, 4, 0, 0, 1, 0]] }] }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Drop')).not.toBeVisible();
    await expect(canvas.getByTitle(/^Drop at/)).toBeInTheDocument();
  },
};

export const MarksWhatAStructureEditAddedMovedAndRemoved: Story = {
  args: { entry: example('Tracks changed') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Vox Bus')).toBeInTheDocument();
    await expect(canvas.getByText('Old Vox')).toBeInTheDocument();
    await expect(canvas.getAllByText('removed').length).toBeGreaterThan(0);
  },
};

export const SaysADryRunPlanWroteNothing: Story = {
  args: { entry: example('Plan') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/A dry run: checked, nothing written\./)).toBeInTheDocument();
  },
};
