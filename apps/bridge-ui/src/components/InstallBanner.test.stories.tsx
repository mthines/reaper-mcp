import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { REPO_URL } from '../lib/links.js';
import { InstallBanner, INSTALL_GUIDE_URL } from './InstallBanner.js';

const meta = {
  title: 'Components/InstallBanner/Tests',
  component: InstallBanner,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
} satisfies Meta<typeof InstallBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SaysItIsADemoAndLinksToTheInstallGuide: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Demo')).toBeInTheDocument();
    await expect(canvas.getByText(/example data/)).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Install guide' })).toHaveAttribute('href', INSTALL_GUIDE_URL);
    await expect(canvas.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', REPO_URL);
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};
