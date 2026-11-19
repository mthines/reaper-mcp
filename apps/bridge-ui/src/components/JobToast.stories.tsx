import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Toaster } from 'sonner';
import { JOB_TOAST_THEME, JobFailure, jobToast } from './JobToast.js';

const ID = 'story-job';

function Demo({ onReload }: { onReload: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Toaster position="bottom-right" theme="dark" style={JOB_TOAST_THEME} closeButton />
      <button className="btn" onClick={() => jobToast.running(ID, 'Installing audio analysis…', 'Downloading what it needs. You can keep working.')}>Running</button>
      <button className="btn" onClick={() => jobToast.info(ID, 'Already up to date', 'There is no newer version to install yet.')}>Info</button>
      <button className="btn" onClick={() => jobToast.done(ID, 'Audio analysis is installed', 'Ask the agent to try again.')}>Done</button>
      <button className="btn" onClick={() => jobToast.done(ID, 'reaper-mcp is up to date', 'Reload this page to use the new version.', { label: 'Reload', onClick: onReload })}>Done with an action</button>
      <button className="btn" onClick={() => jobToast.failed(ID, 'The install failed', <JobFailure>Python 3.10+ is required. <span>Run reaper-mcp setup-sidecar in a terminal to see why.</span></JobFailure>)}>Failed</button>
    </div>
  );
}

const meta = {
  title: 'Components/JobToast',
  component: Demo,
  args: { onReload: fn() },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every toast a background job (the update, the sidecar install) can show; each button replaces the one before, as a job's toast does */
export const Default: Story = {};

export const Playground: Story = {};
