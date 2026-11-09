import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { exampleReleaseJson } from '../../demo/examples.js';
import { BETAS_KEY } from './changelog.js';
import { Changelog, parseReleases } from './index.js';

const releases = parseReleases(exampleReleaseJson('0.79.0'));

const meta = {
  title: 'Features/Changelog/ChangelogPage/Tests',
  component: Changelog.Page,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { releases: { status: 'ready', releases }, demoHref: '/demo-here' },
  beforeEach: () => {
    localStorage.removeItem(BETAS_KEY);
    return () => localStorage.removeItem(BETAS_KEY);
  },
} satisfies Meta<typeof Changelog.Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEveryReleaseAndLinksToTheDemo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1 })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Try the live demo' })).toHaveAttribute('href', '/demo-here');
    await expect(canvas.getByRole('button', { name: 'Link to v0.80.0' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Link to v0.79.0' })).toBeInTheDocument();
  },
};

/** There is no install behind a public link, so nothing is "New" or "Installed" */
export const MarksNoReleaseAsInstalled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Installed')).not.toBeInTheDocument();
    await expect(canvas.queryByText('New', { selector: 'span' })).not.toBeInTheDocument();
  },
};

export const BetasStayHiddenUntilAskedFor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Beta')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByText('Show betas'));
    await expect(canvas.getByText('Beta')).toBeInTheDocument();
  },
};

export const SaysSoWhenTheReleasesCantBeLoaded: Story = {
  args: { releases: { status: 'error' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'releases page on GitHub' })).toBeInTheDocument();
  },
};
