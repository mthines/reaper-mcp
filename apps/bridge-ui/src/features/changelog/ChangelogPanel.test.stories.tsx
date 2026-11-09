import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { CommandProvider } from '../command/index.js';
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

/** Right after the Update available pill: never "up to date" while the releases load or when GitHub can't be reached */
export const ClaimsNothingBeforeTheReleasesLoad: Story = {
  args: { releases: { status: 'loading' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Loading releases from GitHub…')).toBeInTheDocument();
    await expect(canvas.queryByText('You’re up to date')).not.toBeInTheDocument();
  },
};

export const ClaimsNothingDuringARebuildBeforeTheReleasesLoad: Story = {
  args: { releases: { status: 'loading' }, update: { kind: 'rebuild', state: 'running', startedAt: 0, log: [] } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('You’re up to date')).not.toBeInTheDocument();
  },
};

export const ClaimsNothingWhenGitHubCantBeReached: Story = {
  args: { releases: { status: 'error' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Couldn’t reach GitHub/)).toBeInTheDocument();
    await expect(canvas.queryByText('You’re up to date')).not.toBeInTheDocument();
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

/** The betas toggle is in the palette too (⌘K → Show betas), and its label follows the state */
export const ShowsBetasFromThePalette: Story = {
  decorators: [
    (Story) => (
      <CommandProvider>
        <Story />
      </CommandProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.queryByText('Beta')).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await page.findByRole('combobox', { name: 'Search commands' }), 'betas');
    await userEvent.click(page.getByRole('option', { name: /Show betas/ }));
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());
    await expect(page.getByText('Beta')).toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await page.findByRole('combobox', { name: 'Search commands' }), 'betas');
    await expect(page.getByRole('option', { name: /Hide betas/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  },
};

/** Resizable like the other details drawers, and the width is the one they share */
export const ResizesLikeTheOtherDrawers: Story = {
  beforeEach: () => {
    localStorage.removeItem('mcp_bridge.drawer_width');
    return () => localStorage.removeItem('mcp_bridge.drawer_width');
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const drawer = canvas.getByRole('complementary', { name: 'What’s new' });
    const handle = canvas.getByRole('separator', { name: 'Resize sidebar' });
    const before = drawer.style.width;
    handle.focus();
    await userEvent.keyboard('{End}');
    await expect(drawer.style.width).not.toBe(before);
    await expect(localStorage.getItem('mcp_bridge.drawer_width')).not.toBeNull();
  },
};

/** Every release lists its changes, the oldest too: nothing to expand */
export const ListsEveryReleasesChangesWithoutAClick: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/align doubles to a guide/)).toBeVisible();
  },
};

/** Each version links to its GitHub release notes, from an icon next to the version number */
export const LinksEachVersionToItsReleaseNotes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole('link', { name: 'Release notes for v0.80.0' });
    await expect(link).toHaveAttribute('href', releases.find((r) => r.version === '0.80.0')?.url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(canvas.queryByRole('link', { name: 'Release notes' })).not.toBeInTheDocument();
  },
};

const releaseParam = () => new URLSearchParams(location.search).get('release');
const resetUrl = () => {
  history.replaceState(null, '', location.pathname);
  return () => history.replaceState(null, '', location.pathname);
};

/** A version click links to that release: the URL names it and the release is marked as the one linked */
export const LinksToAReleaseFromItsVersion: Story = {
  beforeEach: resetUrl,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Link to v0.79.0' }));
    await expect(releaseParam()).toBe('0.79.0');
    await expect(canvas.getByRole('button', { name: 'Link to v0.79.0' }).closest('li')).toHaveAttribute('aria-current', 'location');
    await expect(canvas.getByRole('button', { name: 'Link to v0.80.0' }).closest('li')).not.toHaveAttribute('aria-current');
  },
};

/** Opening a link to a beta shows that beta with betas hidden, highlighted; closing the drawer drops the link */
export const OpensALinkToABetaAndDropsItOnClose: Story = {
  beforeEach: () => {
    const beta = releases.find((r) => r.prerelease)?.version;
    history.replaceState(null, '', `${location.pathname}?release=${beta}`);
    return () => history.replaceState(null, '', location.pathname);
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const beta = releases.find((r) => r.prerelease)?.version;
    await expect(canvas.getByRole('button', { name: `Link to v${beta}` }).closest('li')).toHaveAttribute('aria-current', 'location');
    await expect(canvas.getAllByText('Beta')).toHaveLength(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Close what’s new' }));
    await waitFor(() => expect(releaseParam()).toBeNull());
    await expect(args.onClose).toHaveBeenCalled();
  },
};
