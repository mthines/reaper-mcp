import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { InstallBanner, INSTALL_COMMANDS, INSTALL_GUIDE_URL } from './InstallBanner.js';

const meta = {
  title: 'Components/InstallBanner/Tests',
  component: InstallBanner,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
} satisfies Meta<typeof InstallBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SaysItIsADemoAndShowsHowToGetStarted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Demo')).toBeInTheDocument();
    await expect(canvas.getByText(/example data/)).toBeInTheDocument();
    for (const c of INSTALL_COMMANDS) await expect(canvas.getByText(c)).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Install guide' })).toHaveAttribute('href', INSTALL_GUIDE_URL);
  },
};

export const CopiesTheCommands: Story = {
  play: async ({ canvasElement }) => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => (written.push(t), Promise.resolve()) } });
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Copy the install commands' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Copy the install commands' })).toHaveTextContent('Copied'));
    await expect(written).toEqual([INSTALL_COMMANDS.join('\n')]);
  },
};
