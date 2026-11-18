import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StoryCard } from '../../demo/StoryCard.js';
import type { BridgeControl } from '../../lib/status.js';
import { Sidecar } from './index.js';

const CMD = 'reaper-mcp setup-sidecar';
const control = (extra: Partial<BridgeControl> = {}): BridgeControl => ({ token: 'demo', canRestart: true, canUpdate: true, canInstallSidecar: true, ...extra });
const job = (state: 'running' | 'done' | 'failed', log: string[] = []) => ({ kind: 'sidecar' as const, state, startedAt: 0, log });

const meta = {
  title: 'Features/Sidecar/Fix',
  component: Sidecar.Fix,
  args: { command: CMD },
} satisfies Meta<typeof Sidecar.Fix>;
export default meta;
type Story = StoryObj<typeof meta>;

const inPage = (c: BridgeControl | undefined, command = CMD) => (
  <Sidecar.Provider value={{ control: c, request: fn() }}>
    <Sidecar.Fix command={command} />
  </Sidecar.Provider>
);

/** Every state: the bridge can install (Install button), it is installing, done, failed, and the bridge can't (the command alone) */
export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <StoryCard title="Can install" note="The button runs reaper-mcp setup-sidecar through the bridge">{inPage(control())}</StoryCard>
      <StoryCard title="A missing part" note="Stem separation: the button installs that part">{inPage(control(), 'reaper-mcp setup-sidecar --with-separation')}</StoryCard>
      <StoryCard title="Installing">{inPage(control({ sidecar: job('running', ['Creating virtual environment', 'Installing numpy…']) }))}</StoryCard>
      <StoryCard title="Installed">{inPage(control({ sidecar: job('done') }))}</StoryCard>
      <StoryCard title="Failed" note="The log tail, and Try again">{inPage(control({ sidecar: job('failed', ['ERROR: No matching distribution found', 'Python 3.10+ is required']) }))}</StoryCard>
      <StoryCard title="The bridge can't install" note="Windows, ReaPack-only, or an old bridge: the command to run by hand">{inPage(control({ canInstallSidecar: false }))}</StoryCard>
    </div>
  ),
};

export const Playground: Story = { render: () => inPage(control()) };
