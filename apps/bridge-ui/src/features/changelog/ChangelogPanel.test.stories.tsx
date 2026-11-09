import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { exampleReleaseJson } from '../../demo/examples.js';
import { BETAS_KEY } from './changelog.js';
import { Changelog, parseReleases } from './index.js';
import { EXAMPLE_HIGHLIGHTS } from './highlight-examples.js';

const CURRENT = '0.79.0';
const releases = parseReleases(exampleReleaseJson(CURRENT));

const meta = {
  title: 'Features/Changelog/ChangelogPanel/Tests',
  component: Changelog,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { releases: { status: 'ready', releases }, current: CURRENT, canUpdate: true, onUpdate: fn(), onClose: fn() },
  beforeEach: () => {
    localStorage.removeItem(BETAS_KEY);
    return () => localStorage.removeItem(BETAS_KEY);
  },
} satisfies Meta<typeof Changelog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OffersTheNewReleaseAndUpdates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('v0.80.0 is available')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Update' }));
    await expect(args.onUpdate).toHaveBeenCalled();
  },
};

export const GroupsChangesLikeTheReleaseNotes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Update pill in the header')).toBeInTheDocument();
    await expect(canvas.getAllByRole('heading', { name: 'New' }).length).toBeGreaterThan(0);
    await expect(canvas.getAllByRole('heading', { name: 'Fixes' }).length).toBeGreaterThan(0);
    await expect(canvas.getByRole('link', { name: '#101' })).toHaveAttribute('href', 'https://github.com/mthines/reaper-mcp/pull/101');
    // The release commit itself is never listed
    await expect(canvas.queryByText(/^chore\(release\)/)).not.toBeInTheDocument();
    await expect(canvas.getByText('Installed')).toBeInTheDocument();
  },
};

export const BetasStayHiddenUntilAskedFor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Beta')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByText('Show betas'));
    await expect(canvas.getByText('Beta')).toBeInTheDocument();
    await expect(localStorage.getItem(BETAS_KEY)).toBe('1');
  },
};

export const ShowsTheCommandsWhenTheBridgeCantUpdate: Story = {
  args: { canUpdate: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
    await expect(canvas.getByText('git pull && ./scripts/install.sh')).toBeInTheDocument();
  },
};

export const SaysWhenUpToDate: Story = {
  args: { current: '0.80.0' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('You’re up to date')).toBeInTheDocument();
  },
};

export const ClosesOnEscape: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const ShowsHighlightsOnTheReleaseThatShippedThem: Story = {
  args: { highlights: EXAMPLE_HIGHLIGHTS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // v0.80.0 lists #100 and #102 and is the version the first one names: all three show there
    const release = canvas.getByText('v0.80.0').closest('li') as HTMLElement;
    await expect(within(release).getByText('What’s new, right on the bridge page')).toBeInTheDocument();
    await expect(within(release).getByText('Sends render in one pass')).toBeInTheDocument();
    await expect(within(release).getByText('Links open the right view')).toBeInTheDocument();
  },
};
