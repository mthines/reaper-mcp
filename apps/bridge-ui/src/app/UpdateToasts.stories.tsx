import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleFeed } from '../demo/feed.js';
import type { BridgeStatus } from '../lib/status.js';
import { UpdateToasts } from './UpdateToasts.js';

const { status } = exampleFeed();
const withUpdate = (state: 'running' | 'failed' | 'done', log: string[]): BridgeStatus => ({
  ...status,
  control: { token: 'demo', canRestart: true, canUpdate: true, updateSource: 'npm', update: { kind: 'update', state, startedAt: 1, log } },
});

const meta = {
  title: 'App/UpdateToasts',
  component: UpdateToasts,
  args: { status, onReload: fn() },
} satisfies Meta<typeof UpdateToasts>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No update running: nothing on screen */
export const Default: Story = {};

export const Playground: Story = {};

/** The download is running in the background: a loading toast naming the step */
export const Downloading: Story = { args: { status: withUpdate('running', ['==> Checking for a new version', '==> Downloading the new version']) } };


const STEPS: BridgeStatus[] = [
  withUpdate('running', ['==> Downloading the new version']),
  withUpdate('running', ['==> Downloading the new version', 'npm warn deprecated glob@10.5.0: Old versions of glob are not supported']),
  withUpdate('running', ['==> Downloading the new version', '==> Installing into REAPER']),
  withUpdate('running', ['==> Installing into REAPER', 'Try: /mixer "Please gain stage my tracks"']),
  withUpdate('done', ['==> Done']),
];

function Steps({ onReload }: { onReload: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((n) => Math.min(n + 1, STEPS.length - 1)), 2000);
    return () => clearInterval(id);
  }, []);
  return <UpdateToasts status={STEPS[step]} onReload={onReload} />;
}

function StepByStepDemo({ onReload }: { onReload: () => void }) {
  const [run, setRun] = useState(0);
  return (
    <>
      <button type="button" className="btn" onClick={() => setRun((n) => n + 1)}>Replay</button>
      <Steps key={run} onReload={onReload} />
    </>
  );
}

/** The whole update as the recording shows it: the text changes in place every 2 s, each line entering on a rise + fade. Replay restarts it. */
export const StepByStep: Story = {
  render: (args) => <StepByStepDemo onReload={args.onReload ?? (() => undefined)} />,
};
