import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Sidecar } from './index.js';

const meta = {
  title: 'Features/Sidecar/Fix/Tests',
  component: Sidecar.Fix,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { command: 'reaper-mcp setup-sidecar --with-separation' },
} satisfies Meta<typeof Sidecar.Fix>;
export default meta;
type Story = StoryObj<typeof meta>;

const control = { token: 'demo', canRestart: true, canUpdate: true, canInstallSidecar: true };

const request = fn();

export const InstallAsksForTheMissingPart: Story = {
  render: (args) => (
    <Sidecar.Provider value={{ control, request }}>
      <Sidecar.Fix {...args} />
    </Sidecar.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Install' }));
    await expect(request).toHaveBeenCalledWith('sidecarsep');
    await expect(canvas.getByText(/reaper-mcp setup-sidecar --with-separation/)).toBeVisible();
  },
};

export const WithoutABridgeItGivesTheCommand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Install' })).toBeNull();
    await expect(canvas.getByText(/reaper-mcp setup-sidecar --with-separation/)).toBeVisible();
  },
};

export const InstallingShowsProgressNotAButton: Story = {
  render: (args) => (
    <Sidecar.Provider value={{ control: { ...control, sidecar: { kind: 'sidecarsep', state: 'running', startedAt: 0, log: ['Downloading htdemucs'] } }, request: fn() }}>
      <Sidecar.Fix {...args} />
    </Sidecar.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Installing…')).toBeVisible();
    await expect(canvas.getByText('Downloading htdemucs')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Install' })).toBeNull();
  },
};
