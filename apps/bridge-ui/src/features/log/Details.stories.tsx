import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DRAWER_EXAMPLES, EXAMPLE_NOW } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import type { Session } from '../../lib/sessions.js';
import { Sidecar } from '../sidecar/index.js';
import { Log } from './index.js';

const SESSION: Session = { id: 'story', dir: '/Users/you/Music/midnight-drive', client: 'claude-code', first: EXAMPLE_NOW - 3_600_000, last: EXAMPLE_NOW, commands: 214, errors: 3, label: 'midnight-drive' };
const [first] = DRAWER_EXAMPLES;

const meta = {
  title: 'Features/Log/Details',
  component: Log.Details,
  args: {
    entry: first.entry,
    history: first.history,
    session: SESSION,
    now: EXAMPLE_NOW,
    filtered: false,
    onFilter: fn(),
    onAddTerm: fn(),
    onClose: fn(),
    onPick: fn(),
  },
  decorators: [(Story) => <div className="story-drawer"><Story /></div>],
} satisfies Meta<typeof Log.Details>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The drawer for one call: every example, from a measurement to a refused request and a system error */
export const Default: Story = {
  decorators: [],
  render: (args) => (
    <div className="story-stack">
      {DRAWER_EXAMPLES.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className="story-drawer">
            <Log.Details {...args} entry={x.entry} history={x.history} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

const missing = (c: string, e: string) => ({ ...first.entry, n: first.entry.n + 1, c, ok: false, e }) as typeof first.entry;

/** The sidecar is not installed: the error, then what it means and the command to run */
export const SidecarMissing: Story = {
  args: { entry: missing('analyze_track_offline', 'Python sidecar not installed. Run in a terminal: reaper-mcp setup-sidecar'), history: [] },
  decorators: [(Story) => <div className="story-drawer story-drawer-wide"><Story /></div>],
};

/** One sidecar part is missing: the fix names its flag */
export const SidecarPartMissing: Story = {
  args: { entry: missing('separate_stems', 'Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation'), history: [] },
  decorators: [(Story) => <div className="story-drawer story-drawer-wide"><Story /></div>],
};

const control = { token: 'demo', canRestart: true, canUpdate: true, canInstallSidecar: true };
/** The failed tool's drawer with the bridge able to install: the error, why, and an Install button */
export const SidecarMissingInstallable: Story = {
  args: { entry: missing('analyze_track_offline', 'Python sidecar not installed. Run in a terminal: reaper-mcp setup-sidecar'), history: [] },
  decorators: [(Story) => <Sidecar.Provider value={{ control, request: fn() }}><div className="story-drawer story-drawer-wide"><Story /></div></Sidecar.Provider>],
};

export const SidecarPartInstalling: Story = {
  args: { entry: missing('separate_stems', 'Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation'), history: [] },
  decorators: [(Story) => (
    <Sidecar.Provider value={{ control: { ...control, sidecar: { kind: 'sidecarsep', state: 'running', startedAt: 0, log: ['Downloading htdemucs'] } }, request: fn() }}>
      <div className="story-drawer story-drawer-wide"><Story /></div>
    </Sidecar.Provider>
  )],
};
