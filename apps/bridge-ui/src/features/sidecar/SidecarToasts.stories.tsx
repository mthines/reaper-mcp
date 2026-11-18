import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toaster } from 'sonner';
import { exampleFeed } from '../../demo/feed.js';
import type { BridgeSidecarInstall, BridgeStatus } from '../../lib/status.js';
import { SidecarToasts } from './SidecarToasts.js';

const { status } = exampleFeed();
const withJob = (state: BridgeSidecarInstall['state'], log: string[], kind: BridgeSidecarInstall['kind'] = 'sidecar'): BridgeStatus => ({
  ...status,
  control: { token: 'demo', canRestart: true, canUpdate: true, canInstallSidecar: true, sidecar: { kind, state, startedAt: 1, log } },
});

const Host = ({ status }: { status: BridgeStatus | null }) => (
  <>
    <Toaster position="bottom-right" theme="dark" closeButton />
    <SidecarToasts status={status} />
  </>
);

const meta = {
  title: 'Features/Sidecar/Toasts',
  component: Host,
  args: { status },
} satisfies Meta<typeof Host>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No install running: nothing on screen */
export const Default: Story = {};

export const Playground: Story = {};

export const Installing: Story = { args: { status: withJob('running', ['Creating virtual environment', 'Installing numpy…']) } };

export const InstallingAPart: Story = { args: { status: withJob('running', ['Downloading htdemucs'], 'sidecarsep') } };

const STEPS: BridgeStatus[] = [
  withJob('running', ['Creating virtual environment']),
  withJob('running', ['Creating virtual environment', 'Installing numpy…']),
  withJob('running', ['Installing numpy…', 'Downloading the aesthetics model']),
  withJob('done', ['Done']),
];

function Steps() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((n) => Math.min(n + 1, STEPS.length - 1)), 2000);
    return () => clearInterval(id);
  }, []);
  return <Host status={STEPS[step]} />;
}

function Replay() {
  const [run, setRun] = useState(0);
  return (
    <>
      <button type="button" className="btn" onClick={() => setRun((n) => n + 1)}>Replay</button>
      <Steps key={run} />
    </>
  );
}

/** The whole install: the toast changes in place every 2 s, then says it is installed. Replay restarts it. */
export const StepByStep: Story = { render: () => <Replay /> };
